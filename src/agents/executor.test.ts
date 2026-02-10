/**
 * Tests for AgentExecutor
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMProvider } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { AgentExecutor } from "./executor.js";
import type { AgentDefinition, AgentTask } from "./executor.js";

const mockProvider = {
  chat: vi.fn(),
  chatWithTools: vi.fn(),
  name: "mock-provider",
  id: "mock-provider",
  initialize: vi.fn(),
  stream: vi.fn(),
  streamWithTools: vi.fn(),
  countTokens: vi.fn().mockReturnValue(10),
  getContextWindow: vi.fn().mockReturnValue(100000),
  isAvailable: vi.fn().mockResolvedValue(true),
} as unknown as LLMProvider;

const mockToolRegistry = {
  execute: vi.fn(),
  getToolDefinitionsForLLM: vi.fn().mockReturnValue([
    {
      name: "read_file",
      description: "Read a file",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "write_file",
      description: "Write a file",
      input_schema: { type: "object", properties: {} },
    },
  ]),
} as unknown as ToolRegistry;

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    role: "coder",
    systemPrompt: "You are a coding agent.",
    allowedTools: ["read_file", "write_file"],
    maxTurns: 5,
    ...overrides,
  };
}

function createTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1",
    description: "Implement a feature",
    ...overrides,
  };
}

function makeChatResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "resp-1",
    content: "Done",
    stopReason: "end_turn",
    toolCalls: [],
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "mock-model",
    ...overrides,
  };
}

describe("AgentExecutor", () => {
  let executor: AgentExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new AgentExecutor(mockProvider, mockToolRegistry);
  });

  describe("execute", () => {
    it("should complete on first turn when no tool calls are returned", async () => {
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Task completed without tools.",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      const result = await executor.execute(createAgent(), createTask());

      expect(result.success).toBe(true);
      expect(result.output).toBe("Task completed without tools.");
      expect(result.turns).toBe(1);
      expect(result.toolsUsed).toEqual([]);
      expect(result.tokensUsed).toBe(150);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(mockProvider.chatWithTools).toHaveBeenCalledTimes(1);
    });

    it("should handle multi-turn tool use loop", async () => {
      // Turn 1: LLM requests a tool call
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Let me read the file.",
          stopReason: "tool_use",
          toolCalls: [{ id: "call-1", name: "read_file", input: { path: "/src/main.ts" } }],
        }),
      );

      // Tool execution returns success
      vi.mocked(mockToolRegistry.execute).mockResolvedValueOnce({
        success: true,
        data: { result: "file content here" },
        duration: 10,
      });

      // Turn 2: LLM finishes
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "I have read the file and completed the task.",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      const result = await executor.execute(createAgent(), createTask());

      expect(result.success).toBe(true);
      expect(result.turns).toBe(2);
      expect(result.toolsUsed).toContain("read_file");
      expect(result.toolsUsed).toHaveLength(1);
      expect(result.output).toBe("I have read the file and completed the task.");
      expect(result.tokensUsed).toBe(300);
      expect(mockProvider.chatWithTools).toHaveBeenCalledTimes(2);
      expect(mockToolRegistry.execute).toHaveBeenCalledWith("read_file", { path: "/src/main.ts" });
    });

    it("should return failure when max turns is reached", async () => {
      // Both turns return tool_use to exhaust maxTurns
      vi.mocked(mockProvider.chatWithTools).mockResolvedValue(
        makeChatResponse({
          content: "Still working...",
          stopReason: "tool_use",
          toolCalls: [{ id: "call-loop", name: "read_file", input: { path: "/file.ts" } }],
        }),
      );

      vi.mocked(mockToolRegistry.execute).mockResolvedValue({
        success: true,
        data: { result: "some data" },
        duration: 5,
      });

      const result = await executor.execute(createAgent({ maxTurns: 2 }), createTask());

      expect(result.success).toBe(false);
      expect(result.turns).toBe(2);
      expect(result.output).toBe("Agent reached maximum turns without completing task");
      expect(mockProvider.chatWithTools).toHaveBeenCalledTimes(2);
    });

    it("should continue the loop with is_error tool_result when tool execution throws", async () => {
      // Turn 1: LLM requests a tool call
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            { id: "call-err", name: "write_file", input: { path: "/out.ts", content: "code" } },
          ],
        }),
      );

      // Tool execution throws an error
      vi.mocked(mockToolRegistry.execute).mockRejectedValueOnce(new Error("Permission denied"));

      // Turn 2: LLM recovers and finishes
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "The write failed, but I handled it.",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      const result = await executor.execute(createAgent(), createTask());

      expect(result.success).toBe(true);
      expect(result.turns).toBe(2);
      expect(result.toolsUsed).toContain("write_file");

      // Verify the error tool_result was sent back to the LLM
      const secondCallMessages = vi.mocked(mockProvider.chatWithTools).mock.calls[1][0];
      const lastMessage = secondCallMessages[secondCallMessages.length - 1];
      expect(lastMessage.role).toBe("user");

      const toolResults = lastMessage.content as Array<{
        type: string;
        tool_use_id: string;
        content: string;
        is_error: boolean;
      }>;
      expect(toolResults[0].type).toBe("tool_result");
      expect(toolResults[0].tool_use_id).toBe("call-err");
      expect(toolResults[0].is_error).toBe(true);
      expect(toolResults[0].content).toContain("Permission denied");
    });

    it("should return failure with error message when provider throws", async () => {
      vi.mocked(mockProvider.chatWithTools).mockRejectedValueOnce(
        new Error("API rate limit exceeded"),
      );

      const result = await executor.execute(createAgent(), createTask());

      expect(result.success).toBe(false);
      expect(result.turns).toBe(1);
      expect(result.output).toContain("Agent error on turn 1");
      expect(result.output).toContain("API rate limit exceeded");
      expect(result.toolsUsed).toEqual([]);
    });

    it("should handle provider error with non-Error thrown value", async () => {
      vi.mocked(mockProvider.chatWithTools).mockRejectedValueOnce("string error");

      const result = await executor.execute(createAgent(), createTask());

      expect(result.success).toBe(false);
      expect(result.output).toContain("string error");
    });

    it("should filter tool definitions by agent allowedTools", async () => {
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Done",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      // Agent only allows read_file
      await executor.execute(createAgent({ allowedTools: ["read_file"] }), createTask());

      expect(mockToolRegistry.getToolDefinitionsForLLM).toHaveBeenCalled();

      // Verify the tools passed to chatWithTools are filtered
      const callArgs = vi.mocked(mockProvider.chatWithTools).mock.calls[0];
      const options = callArgs[1];
      expect(options.tools).toHaveLength(1);
      expect(options.tools[0].name).toBe("read_file");
    });

    it("should pass all tool definitions when allowedTools is empty", async () => {
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Done",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      await executor.execute(createAgent({ allowedTools: [] }), createTask());

      const callArgs = vi.mocked(mockProvider.chatWithTools).mock.calls[0];
      const options = callArgs[1];
      expect(options.tools).toHaveLength(2);
      expect(options.tools.map((t: { name: string }) => t.name)).toEqual([
        "read_file",
        "write_file",
      ]);
    });

    it("should pass the system prompt to chatWithTools", async () => {
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Done",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      await executor.execute(createAgent({ systemPrompt: "You are a test agent." }), createTask());

      const callArgs = vi.mocked(mockProvider.chatWithTools).mock.calls[0];
      const options = callArgs[1];
      expect(options.system).toBe("You are a test agent.");
    });

    it("should build task prompt with context", async () => {
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Done",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      await executor.execute(
        createAgent(),
        createTask({
          description: "Fix the bug",
          context: { file: "main.ts", line: 42 },
        }),
      );

      const callArgs = vi.mocked(mockProvider.chatWithTools).mock.calls[0];
      const messages = callArgs[0];
      const userMessage = messages[0].content as string;

      expect(userMessage).toContain("Task: Fix the bug");
      expect(userMessage).toContain("Context:");
      expect(userMessage).toContain('"file": "main.ts"');
      expect(userMessage).toContain('"line": 42');
    });

    it("should build task prompt without context when not provided", async () => {
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Done",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      await executor.execute(createAgent(), createTask({ description: "Simple task" }));

      const callArgs = vi.mocked(mockProvider.chatWithTools).mock.calls[0];
      const messages = callArgs[0];
      const userMessage = messages[0].content as string;

      expect(userMessage).toContain("Task: Simple task");
      expect(userMessage).not.toContain("Context:");
    });

    it("should handle multiple tool calls in a single turn", async () => {
      // Turn 1: LLM requests two tool calls
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Reading two files.",
          stopReason: "tool_use",
          toolCalls: [
            { id: "call-a", name: "read_file", input: { path: "/a.ts" } },
            { id: "call-b", name: "write_file", input: { path: "/b.ts", content: "data" } },
          ],
        }),
      );

      vi.mocked(mockToolRegistry.execute)
        .mockResolvedValueOnce({ success: true, data: { result: "content-a" }, duration: 5 })
        .mockResolvedValueOnce({ success: true, data: { result: "content-b" }, duration: 5 });

      // Turn 2: LLM finishes
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Both files processed.",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      const result = await executor.execute(createAgent(), createTask());

      expect(result.success).toBe(true);
      expect(result.turns).toBe(2);
      expect(result.toolsUsed).toContain("read_file");
      expect(result.toolsUsed).toContain("write_file");
      expect(result.toolsUsed).toHaveLength(2);
      expect(mockToolRegistry.execute).toHaveBeenCalledTimes(2);
    });

    it("should handle tool returning a failure result (not throwing)", async () => {
      // Turn 1: LLM requests a tool call
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call-fail", name: "read_file", input: { path: "/missing.ts" } }],
        }),
      );

      // Tool returns a structured failure (not a throw)
      vi.mocked(mockToolRegistry.execute).mockResolvedValueOnce({
        success: false,
        error: "File not found",
        duration: 3,
      });

      // Turn 2: LLM finishes
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "File was not found, moving on.",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      const result = await executor.execute(createAgent(), createTask());

      expect(result.success).toBe(true);
      expect(result.turns).toBe(2);

      // Verify the error tool_result was sent back
      const secondCallMessages = vi.mocked(mockProvider.chatWithTools).mock.calls[1][0];
      const lastMessage = secondCallMessages[secondCallMessages.length - 1];
      const toolResults = lastMessage.content as Array<{
        type: string;
        content: string;
        is_error: boolean;
      }>;
      expect(toolResults[0].is_error).toBe(true);
      expect(toolResults[0].content).toContain("Error: File not found");
    });

    it("should deduplicate toolsUsed when same tool is called multiple turns", async () => {
      // Turn 1: read_file
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call-1", name: "read_file", input: { path: "/a.ts" } }],
        }),
      );
      vi.mocked(mockToolRegistry.execute).mockResolvedValueOnce({
        success: true,
        data: { result: "a" },
        duration: 5,
      });

      // Turn 2: read_file again
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call-2", name: "read_file", input: { path: "/b.ts" } }],
        }),
      );
      vi.mocked(mockToolRegistry.execute).mockResolvedValueOnce({
        success: true,
        data: { result: "b" },
        duration: 5,
      });

      // Turn 3: done
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Done reading both files.",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      const result = await executor.execute(createAgent(), createTask());

      expect(result.success).toBe(true);
      expect(result.turns).toBe(3);
      // read_file should appear only once (Set-based dedup)
      expect(result.toolsUsed).toEqual(["read_file"]);
    });

    it("should accumulate tokens across multiple turns", async () => {
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          stopReason: "tool_use",
          toolCalls: [{ id: "c1", name: "read_file", input: {} }],
          usage: { inputTokens: 200, outputTokens: 100 },
        }),
      );
      vi.mocked(mockToolRegistry.execute).mockResolvedValueOnce({
        success: true,
        data: {},
        duration: 1,
      });
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          stopReason: "end_turn",
          toolCalls: [],
          usage: { inputTokens: 300, outputTokens: 150 },
        }),
      );

      const result = await executor.execute(createAgent(), createTask());

      expect(result.tokensUsed).toBe(200 + 100 + 300 + 150);
    });

    it("should handle stopReason end_turn with empty toolCalls as completion", async () => {
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "All done.",
          stopReason: "end_turn",
          toolCalls: [],
        }),
      );

      const result = await executor.execute(createAgent(), createTask());

      expect(result.success).toBe(true);
      expect(result.output).toBe("All done.");
    });

    it("should treat tool_use stopReason with empty toolCalls as completion", async () => {
      // Edge case: stopReason is tool_use but toolCalls array is empty
      vi.mocked(mockProvider.chatWithTools).mockResolvedValueOnce(
        makeChatResponse({
          content: "Oddly done.",
          stopReason: "tool_use",
          toolCalls: [],
        }),
      );

      const result = await executor.execute(createAgent(), createTask());

      expect(result.success).toBe(true);
      expect(result.output).toBe("Oddly done.");
      expect(result.turns).toBe(1);
    });
  });
});
