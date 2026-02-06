/**
 * Tests for the agentic loop
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { LLMProvider, StreamChunk, ToolCall } from "../../providers/types.js";

/**
 * Create async iterable from generator
 */
function toAsyncIterable<T>(gen: Generator<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const result = gen.next();
          return result;
        },
      };
    },
  };
}

/**
 * Create a streaming mock for a simple text response (no tools)
 */
function createTextStreamMock(content: string): () => AsyncIterable<StreamChunk> {
  return () =>
    toAsyncIterable(
      (function* (): Generator<StreamChunk> {
        if (content) {
          yield { type: "text", text: content };
        }
        yield { type: "done" };
      })(),
    );
}

/**
 * Create a streaming mock that includes tool calls
 */
function createToolStreamMock(
  content: string,
  toolCalls: ToolCall[],
): () => AsyncIterable<StreamChunk> {
  return () =>
    toAsyncIterable(
      (function* (): Generator<StreamChunk> {
        if (content) {
          yield { type: "text", text: content };
        }
        for (const tc of toolCalls) {
          yield { type: "tool_use_start", toolCall: { id: tc.id, name: tc.name } };
          yield { type: "tool_use_end", toolCall: tc };
        }
        yield { type: "done" };
      })(),
    );
}
import type { ToolRegistry, ToolResult } from "../../tools/registry.js";
import type { ReplSession, ExecutedToolCall } from "./types.js";

// Mock chalk to simplify output testing
vi.mock("chalk", () => ({
  default: {
    yellow: (s: string) => `[yellow]${s}[/yellow]`,
    dim: (s: string) => `[dim]${s}[/dim]`,
    red: (s: string) => `[red]${s}[/red]`,
  },
}));

// Mock session functions
vi.mock("./session.js", () => ({
  getConversationContext: vi.fn(),
  addMessage: vi.fn(),
  saveTrustedTool: vi.fn(() => Promise.resolve(undefined)),
}));

// Mock confirmation module
vi.mock("./confirmation.js", () => ({
  requiresConfirmation: vi.fn(),
  confirmToolExecution: vi.fn(),
}));

// Mock allow-path prompt
vi.mock("./allow-path-prompt.js", () => ({
  promptAllowPath: vi.fn().mockResolvedValue(false),
}));

describe("executeAgentTurn", () => {
  let mockProvider: LLMProvider;
  let mockToolRegistry: ToolRegistry;
  let mockSession: ReplSession;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock provider
    mockProvider = {
      id: "mock",
      name: "Mock Provider",
      initialize: vi.fn(),
      chat: vi.fn(),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn().mockImplementation(createTextStreamMock("Mock response")),
      countTokens: vi.fn(() => 10),
      getContextWindow: vi.fn(() => 100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    // Create mock tool registry
    mockToolRegistry = {
      getToolDefinitionsForLLM: vi.fn(() => [
        { name: "read_file", description: "Read a file", input_schema: { type: "object" } },
        { name: "write_file", description: "Write a file", input_schema: { type: "object" } },
      ]),
      execute: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      getAll: vi.fn(),
      getByCategory: vi.fn(),
    } as unknown as ToolRegistry;

    // Create mock session
    mockSession = {
      id: "test-session-123",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      config: {
        provider: {
          type: "anthropic",
          model: "claude-sonnet-4-20250514",
          maxTokens: 8192,
        },
        ui: {
          theme: "auto",
          showTimestamps: false,
          maxHistorySize: 100,
        },
        agent: {
          systemPrompt: "You are a helpful assistant",
          maxToolIterations: 25,
          confirmDestructive: true,
        },
      },
      trustedTools: new Set<string>(),
    };

    // Setup default mocks
    const { getConversationContext } = await import("./session.js");
    (getConversationContext as Mock).mockReturnValue([
      { role: "system", content: "System prompt" },
    ]);

    const { requiresConfirmation } = await import("./confirmation.js");
    (requiresConfirmation as Mock).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should process a simple message without tool calls", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");
    const { addMessage } = await import("./session.js");

    (mockProvider.streamWithTools as Mock).mockImplementation(
      createTextStreamMock("Hello! How can I help you?"),
    );

    const result = await executeAgentTurn(mockSession, "Hello", mockProvider, mockToolRegistry);

    expect(result.content).toBe("Hello! How can I help you?");
    expect(result.toolCalls).toEqual([]);
    // Token usage is now estimated, so just check they're > 0
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.aborted).toBe(false);
    expect(addMessage).toHaveBeenCalledTimes(2); // user message + assistant response
  });

  it("should execute a single tool call", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");
    const { addMessage } = await import("./session.js");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "read_file",
      input: { path: "/test/file.ts" },
    };

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolStreamMock("Let me read that file for you.", [toolCall])();
      }
      return createTextStreamMock("The file contains your code.")();
    });

    const toolResult: ToolResult = {
      success: true,
      data: { content: "file content here" },
      duration: 10,
    };
    (mockToolRegistry.execute as Mock).mockResolvedValue(toolResult);

    const result = await executeAgentTurn(
      mockSession,
      "Read file.ts",
      mockProvider,
      mockToolRegistry,
    );

    expect(result.content).toBe("Let me read that file for you.The file contains your code.");
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.name).toBe("read_file");
    expect(result.toolCalls[0]?.result.success).toBe(true);
    // Token usage is estimated now
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(mockToolRegistry.execute).toHaveBeenCalledWith(
      "read_file",
      { path: "/test/file.ts" },
      expect.anything(),
    );
    expect(addMessage).toHaveBeenCalled();
  });

  it("should handle tool execution errors", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const toolCall: ToolCall = { id: "tool-1", name: "read_file", input: { path: "/nonexistent" } };

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolStreamMock("", [toolCall])();
      }
      return createTextStreamMock("The file does not exist.")();
    });

    const toolResult: ToolResult = {
      success: false,
      error: "File not found",
      duration: 5,
    };
    (mockToolRegistry.execute as Mock).mockResolvedValue(toolResult);

    const result = await executeAgentTurn(
      mockSession,
      "Read nonexistent file",
      mockProvider,
      mockToolRegistry,
    );

    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.result.success).toBe(false);
    expect(result.toolCalls[0]?.result.error).toBe("File not found");
  });

  it("should call onStream callback when content is received", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    (mockProvider.streamWithTools as Mock).mockImplementation(createTextStreamMock("Hello!"));

    const onStream = vi.fn();

    await executeAgentTurn(mockSession, "Hello", mockProvider, mockToolRegistry, { onStream });

    expect(onStream).toHaveBeenCalledWith({ type: "text", text: "Hello!" });
    expect(onStream).toHaveBeenCalledWith({ type: "done" });
  });

  it("should call onToolStart and onToolEnd callbacks", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const toolCall: ToolCall = { id: "tool-1", name: "read_file", input: { path: "/test.ts" } };

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolStreamMock("", [toolCall])();
      }
      return createTextStreamMock("Done")();
    });

    (mockToolRegistry.execute as Mock).mockResolvedValue({
      success: true,
      data: "content",
      duration: 10,
    });

    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();

    await executeAgentTurn(mockSession, "Read file", mockProvider, mockToolRegistry, {
      onToolStart,
      onToolEnd,
    });

    // onToolStart now receives (toolCall, index, total)
    expect(onToolStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tool-1", name: "read_file" }),
      1, // index
      1, // total
    );
    expect(onToolEnd).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tool-1", name: "read_file", result: expect.any(Object) }),
    );
  });

  it("should call onThinkingStart and onThinkingEnd callbacks", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    (mockProvider.streamWithTools as Mock).mockImplementation(createTextStreamMock("Response"));

    const onThinkingStart = vi.fn();
    const onThinkingEnd = vi.fn();

    await executeAgentTurn(mockSession, "Think", mockProvider, mockToolRegistry, {
      onThinkingStart,
      onThinkingEnd,
    });

    expect(onThinkingStart).toHaveBeenCalled();
    expect(onThinkingEnd).toHaveBeenCalled();
  });

  it("should abort early when signal is aborted before LLM call", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const abortController = new AbortController();
    abortController.abort();

    const result = await executeAgentTurn(mockSession, "Hello", mockProvider, mockToolRegistry, {
      signal: abortController.signal,
    });

    expect(result.aborted).toBe(true);
    expect(mockProvider.streamWithTools).not.toHaveBeenCalled();
  });

  it("should abort when signal is aborted during tool execution loop", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const toolCalls: ToolCall[] = [
      { id: "tool-1", name: "read_file", input: { path: "/file1.ts" } },
      { id: "tool-2", name: "read_file", input: { path: "/file2.ts" } },
    ];

    (mockProvider.streamWithTools as Mock).mockImplementation(createToolStreamMock("", toolCalls));

    const abortController = new AbortController();

    // Abort after first tool execution
    (mockToolRegistry.execute as Mock).mockImplementation(async () => {
      abortController.abort();
      return { success: true, data: "content", duration: 10 };
    });

    const result = await executeAgentTurn(
      mockSession,
      "Read files",
      mockProvider,
      mockToolRegistry,
      { signal: abortController.signal },
    );

    // Should have executed only 1 tool before abort was detected
    expect(result.toolCalls.length).toBe(1);
  });

  it("should respect maxToolIterations limit", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    // Always return tool calls to force loop
    const toolCall: ToolCall = { id: "tool-1", name: "read_file", input: { path: "/file.ts" } };

    (mockProvider.streamWithTools as Mock).mockImplementation(createToolStreamMock("", [toolCall]));
    (mockToolRegistry.execute as Mock).mockResolvedValue({
      success: true,
      data: "content",
      duration: 1,
    });

    // Set low iteration limit
    mockSession.config.agent.maxToolIterations = 3;

    const result = await executeAgentTurn(
      mockSession,
      "Keep going",
      mockProvider,
      mockToolRegistry,
    );

    // Should stop after 3 iterations
    expect(result.toolCalls.length).toBe(3);
    expect(mockProvider.streamWithTools).toHaveBeenCalledTimes(3);
  });

  it("should handle multiple tool calls in one response", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const toolCalls: ToolCall[] = [
      { id: "tool-1", name: "read_file", input: { path: "/file1.ts" } },
      { id: "tool-2", name: "read_file", input: { path: "/file2.ts" } },
      { id: "tool-3", name: "read_file", input: { path: "/file3.ts" } },
    ];

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolStreamMock("Reading files...", toolCalls)();
      }
      return createTextStreamMock("Done reading all files.")();
    });

    (mockToolRegistry.execute as Mock).mockResolvedValue({
      success: true,
      data: "content",
      duration: 5,
    });

    const result = await executeAgentTurn(
      mockSession,
      "Read all files",
      mockProvider,
      mockToolRegistry,
    );

    expect(result.toolCalls.length).toBe(3);
    expect(mockToolRegistry.execute).toHaveBeenCalledTimes(3);
  });

  describe("confirmation handling", () => {
    it("should skip confirmation for trusted tools", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);

      // Trust the write_file tool
      mockSession.trustedTools.add("write_file");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { path: "/test.ts", content: "code" },
      };

      let callCount = 0;
      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createToolStreamMock("", [toolCall])();
        }
        return createTextStreamMock("File written.")();
      });

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: {},
        duration: 10,
      });

      await executeAgentTurn(mockSession, "Write file", mockProvider, mockToolRegistry);

      // Should not prompt for confirmation
      expect(confirmToolExecution).not.toHaveBeenCalled();
    });

    it("should skip confirmation when skipConfirmation option is true", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { path: "/test.ts", content: "code" },
      };

      let callCount = 0;
      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createToolStreamMock("", [toolCall])();
        }
        return createTextStreamMock("Done.")();
      });

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: {},
        duration: 10,
      });

      await executeAgentTurn(mockSession, "Write file", mockProvider, mockToolRegistry, {
        skipConfirmation: true,
      });

      expect(confirmToolExecution).not.toHaveBeenCalled();
    });

    it("should prompt for confirmation for destructive tools", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("yes");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { path: "/test.ts", content: "code" },
      };

      let callCount = 0;
      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createToolStreamMock("", [toolCall])();
        }
        return createTextStreamMock("Done.")();
      });

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: {},
        duration: 10,
      });

      await executeAgentTurn(mockSession, "Write file", mockProvider, mockToolRegistry);

      expect(confirmToolExecution).toHaveBeenCalled();
      expect(mockToolRegistry.execute).toHaveBeenCalled();
    });

    it("should skip tool when user declines confirmation", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("no");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { path: "/test.ts", content: "code" },
      };

      let callCount = 0;
      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createToolStreamMock("", [toolCall])();
        }
        return createTextStreamMock("Skipped.")();
      });

      const onToolSkipped = vi.fn();

      await executeAgentTurn(mockSession, "Write file", mockProvider, mockToolRegistry, {
        onToolSkipped,
      });

      expect(onToolSkipped).toHaveBeenCalledWith(
        expect.objectContaining({ name: "write_file" }),
        "User declined",
      );
      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    });

    it("should abort turn when user chooses abort", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("abort");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { path: "/test.ts", content: "code" },
      };

      (mockProvider.streamWithTools as Mock).mockImplementation(
        createToolStreamMock("Starting...", [toolCall]),
      );

      const result = await executeAgentTurn(
        mockSession,
        "Write file",
        mockProvider,
        mockToolRegistry,
      );

      expect(result.aborted).toBe(true);
      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    });

    it("should trust tool for project when user chooses trust_project", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("trust_project");

      const toolCall: ToolCall = { id: "tool-1", name: "bash_exec", input: { command: "ls" } };

      let callCount = 0;
      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createToolStreamMock("", [toolCall])();
        }
        return createTextStreamMock("Done.")();
      });

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: {},
        duration: 10,
      });

      await executeAgentTurn(mockSession, "Run command", mockProvider, mockToolRegistry);

      expect(mockSession.trustedTools.has("bash_exec")).toBe(true);
    });

    it("should trust tool globally when user chooses trust_global", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("trust_global");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { path: "/test.ts", content: "code" },
      };

      let callCount = 0;
      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createToolStreamMock("", [toolCall])();
        }
        return createTextStreamMock("Done.")();
      });

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: {},
        duration: 10,
      });

      await executeAgentTurn(mockSession, "Write file", mockProvider, mockToolRegistry);

      expect(mockSession.trustedTools.has("write_file")).toBe(true);
    });
  });
});

describe("formatAbortSummary", () => {
  it("should return null for empty tool list", async () => {
    const { formatAbortSummary } = await import("./agent-loop.js");

    const result = formatAbortSummary([]);

    expect(result).toBeNull();
  });

  it("should format summary for successful tools", async () => {
    const { formatAbortSummary } = await import("./agent-loop.js");

    const executedTools: ExecutedToolCall[] = [
      {
        id: "1",
        name: "read_file",
        input: { path: "/test.ts" },
        result: { success: true, output: "content" },
        duration: 10,
      },
      {
        id: "2",
        name: "write_file",
        input: { path: "/out.ts", content: "code" },
        result: { success: true, output: "{}" },
        duration: 15,
      },
    ];

    const result = formatAbortSummary(executedTools);

    expect(result).toContain("2 tools");
    expect(result).toContain("read_file");
    expect(result).toContain("write_file");
  });

  it("should format summary for single successful tool", async () => {
    const { formatAbortSummary } = await import("./agent-loop.js");

    const executedTools: ExecutedToolCall[] = [
      {
        id: "1",
        name: "read_file",
        input: { path: "/test.ts" },
        result: { success: true, output: "content" },
        duration: 10,
      },
    ];

    const result = formatAbortSummary(executedTools);

    expect(result).toContain("1 tool");
    expect(result).not.toContain("1 tools");
  });

  it("should indicate failed tools", async () => {
    const { formatAbortSummary } = await import("./agent-loop.js");

    const executedTools: ExecutedToolCall[] = [
      {
        id: "1",
        name: "read_file",
        input: { path: "/test.ts" },
        result: { success: true, output: "content" },
        duration: 10,
      },
      {
        id: "2",
        name: "write_file",
        input: { path: "/readonly.ts", content: "code" },
        result: { success: false, output: "", error: "Permission denied" },
        duration: 5,
      },
    ];

    const result = formatAbortSummary(executedTools);

    expect(result).toContain("1 failed");
  });

  it("should truncate long tool lists", async () => {
    const { formatAbortSummary } = await import("./agent-loop.js");

    const executedTools: ExecutedToolCall[] = [
      { id: "1", name: "tool1", input: {}, result: { success: true, output: "" }, duration: 1 },
      { id: "2", name: "tool2", input: {}, result: { success: true, output: "" }, duration: 1 },
      { id: "3", name: "tool3", input: {}, result: { success: true, output: "" }, duration: 1 },
      { id: "4", name: "tool4", input: {}, result: { success: true, output: "" }, duration: 1 },
      { id: "5", name: "tool5", input: {}, result: { success: true, output: "" }, duration: 1 },
      { id: "6", name: "tool6", input: {}, result: { success: true, output: "" }, duration: 1 },
    ];

    const result = formatAbortSummary(executedTools);

    expect(result).toContain("+2 more");
  });

  it("should deduplicate tool names", async () => {
    const { formatAbortSummary } = await import("./agent-loop.js");

    const executedTools: ExecutedToolCall[] = [
      { id: "1", name: "read_file", input: {}, result: { success: true, output: "" }, duration: 1 },
      { id: "2", name: "read_file", input: {}, result: { success: true, output: "" }, duration: 1 },
      { id: "3", name: "read_file", input: {}, result: { success: true, output: "" }, duration: 1 },
    ];

    const result = formatAbortSummary(executedTools);

    // Should show "3 tools" but only list "read_file" once
    expect(result).toContain("3 tools");
    // The tool name should appear just once in the list portion
    const matches = result?.match(/read_file/g) || [];
    expect(matches.length).toBe(1);
  });
});
