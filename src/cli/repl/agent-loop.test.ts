/**
 * Tests for the agentic loop
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type {
  LLMProvider,
  ChatWithToolsResponse,
  Message,
} from "../../providers/types.js";
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
  createConfirmationState: vi.fn(() => ({ allowAll: false })),
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

    const mockResponse: ChatWithToolsResponse = {
      id: "msg-1",
      content: "Hello! How can I help you?",
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [],
    };

    (mockProvider.chatWithTools as Mock).mockResolvedValue(mockResponse);

    const result = await executeAgentTurn(
      mockSession,
      "Hello",
      mockProvider,
      mockToolRegistry
    );

    expect(result.content).toBe("Hello! How can I help you?");
    expect(result.toolCalls).toEqual([]);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
    expect(result.aborted).toBe(false);
    expect(addMessage).toHaveBeenCalledTimes(2); // user message + assistant response
  });

  it("should execute a single tool call", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");
    const { addMessage } = await import("./session.js");

    // First response with tool call
    const firstResponse: ChatWithToolsResponse = {
      id: "msg-1",
      content: "Let me read that file for you.",
      stopReason: "tool_use",
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [
        { id: "tool-1", name: "read_file", input: { path: "/test/file.ts" } },
      ],
    };

    // Second response after tool result
    const secondResponse: ChatWithToolsResponse = {
      id: "msg-2",
      content: "The file contains your code.",
      stopReason: "end_turn",
      usage: { inputTokens: 150, outputTokens: 75 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [],
    };

    (mockProvider.chatWithTools as Mock)
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse);

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
      mockToolRegistry
    );

    expect(result.content).toBe("Let me read that file for you.The file contains your code.");
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.name).toBe("read_file");
    expect(result.toolCalls[0]?.result.success).toBe(true);
    expect(result.usage.inputTokens).toBe(250); // 100 + 150
    expect(result.usage.outputTokens).toBe(125); // 50 + 75
    expect(mockToolRegistry.execute).toHaveBeenCalledWith("read_file", { path: "/test/file.ts" });
    expect(addMessage).toHaveBeenCalled();
  });

  it("should handle tool execution errors", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const firstResponse: ChatWithToolsResponse = {
      id: "msg-1",
      content: "",
      stopReason: "tool_use",
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [
        { id: "tool-1", name: "read_file", input: { path: "/nonexistent" } },
      ],
    };

    const secondResponse: ChatWithToolsResponse = {
      id: "msg-2",
      content: "The file does not exist.",
      stopReason: "end_turn",
      usage: { inputTokens: 150, outputTokens: 75 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [],
    };

    (mockProvider.chatWithTools as Mock)
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse);

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
      mockToolRegistry
    );

    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.result.success).toBe(false);
    expect(result.toolCalls[0]?.result.error).toBe("File not found");
  });

  it("should call onStream callback when content is received", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const mockResponse: ChatWithToolsResponse = {
      id: "msg-1",
      content: "Hello!",
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [],
    };

    (mockProvider.chatWithTools as Mock).mockResolvedValue(mockResponse);

    const onStream = vi.fn();

    await executeAgentTurn(
      mockSession,
      "Hello",
      mockProvider,
      mockToolRegistry,
      { onStream }
    );

    expect(onStream).toHaveBeenCalledWith({ type: "text", text: "Hello!" });
    expect(onStream).toHaveBeenCalledWith({ type: "done" });
  });

  it("should call onToolStart and onToolEnd callbacks", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const firstResponse: ChatWithToolsResponse = {
      id: "msg-1",
      content: "",
      stopReason: "tool_use",
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [
        { id: "tool-1", name: "read_file", input: { path: "/test.ts" } },
      ],
    };

    const secondResponse: ChatWithToolsResponse = {
      id: "msg-2",
      content: "Done",
      stopReason: "end_turn",
      usage: { inputTokens: 150, outputTokens: 75 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [],
    };

    (mockProvider.chatWithTools as Mock)
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse);

    (mockToolRegistry.execute as Mock).mockResolvedValue({
      success: true,
      data: "content",
      duration: 10,
    });

    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();

    await executeAgentTurn(
      mockSession,
      "Read file",
      mockProvider,
      mockToolRegistry,
      { onToolStart, onToolEnd }
    );

    // onToolStart now receives (toolCall, index, total)
    expect(onToolStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tool-1", name: "read_file" }),
      1, // index
      1  // total
    );
    expect(onToolEnd).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tool-1", name: "read_file", result: expect.any(Object) })
    );
  });

  it("should call onThinkingStart and onThinkingEnd callbacks", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const mockResponse: ChatWithToolsResponse = {
      id: "msg-1",
      content: "Response",
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [],
    };

    (mockProvider.chatWithTools as Mock).mockResolvedValue(mockResponse);

    const onThinkingStart = vi.fn();
    const onThinkingEnd = vi.fn();

    await executeAgentTurn(
      mockSession,
      "Think",
      mockProvider,
      mockToolRegistry,
      { onThinkingStart, onThinkingEnd }
    );

    expect(onThinkingStart).toHaveBeenCalled();
    expect(onThinkingEnd).toHaveBeenCalled();
  });

  it("should abort early when signal is aborted before LLM call", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const abortController = new AbortController();
    abortController.abort();

    const result = await executeAgentTurn(
      mockSession,
      "Hello",
      mockProvider,
      mockToolRegistry,
      { signal: abortController.signal }
    );

    expect(result.aborted).toBe(true);
    expect(mockProvider.chatWithTools).not.toHaveBeenCalled();
  });

  it("should abort when signal is aborted during tool execution loop", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const firstResponse: ChatWithToolsResponse = {
      id: "msg-1",
      content: "",
      stopReason: "tool_use",
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [
        { id: "tool-1", name: "read_file", input: { path: "/file1.ts" } },
        { id: "tool-2", name: "read_file", input: { path: "/file2.ts" } },
      ],
    };

    (mockProvider.chatWithTools as Mock).mockResolvedValue(firstResponse);

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
      { signal: abortController.signal }
    );

    // Should have executed only 1 tool before abort was detected
    expect(result.toolCalls.length).toBe(1);
  });

  it("should respect maxToolIterations limit", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    // Always return tool calls to force loop
    const infiniteToolResponse: ChatWithToolsResponse = {
      id: "msg-1",
      content: "",
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [
        { id: "tool-1", name: "read_file", input: { path: "/file.ts" } },
      ],
    };

    (mockProvider.chatWithTools as Mock).mockResolvedValue(infiniteToolResponse);
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
      mockToolRegistry
    );

    // Should stop after 3 iterations
    expect(result.toolCalls.length).toBe(3);
    expect(mockProvider.chatWithTools).toHaveBeenCalledTimes(3);
  });

  it("should handle multiple tool calls in one response", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const firstResponse: ChatWithToolsResponse = {
      id: "msg-1",
      content: "Reading files...",
      stopReason: "tool_use",
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [
        { id: "tool-1", name: "read_file", input: { path: "/file1.ts" } },
        { id: "tool-2", name: "read_file", input: { path: "/file2.ts" } },
        { id: "tool-3", name: "read_file", input: { path: "/file3.ts" } },
      ],
    };

    const secondResponse: ChatWithToolsResponse = {
      id: "msg-2",
      content: "Done reading all files.",
      stopReason: "end_turn",
      usage: { inputTokens: 150, outputTokens: 75 },
      model: "claude-sonnet-4-20250514",
      toolCalls: [],
    };

    (mockProvider.chatWithTools as Mock)
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse);

    (mockToolRegistry.execute as Mock).mockResolvedValue({
      success: true,
      data: "content",
      duration: 5,
    });

    const result = await executeAgentTurn(
      mockSession,
      "Read all files",
      mockProvider,
      mockToolRegistry
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

      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "",
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "write_file", input: { path: "/test.ts", content: "code" } },
        ],
      };

      const secondResponse: ChatWithToolsResponse = {
        id: "msg-2",
        content: "File written.",
        stopReason: "end_turn",
        usage: { inputTokens: 150, outputTokens: 75 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: {},
        duration: 10,
      });

      await executeAgentTurn(
        mockSession,
        "Write file",
        mockProvider,
        mockToolRegistry
      );

      // Should not prompt for confirmation
      expect(confirmToolExecution).not.toHaveBeenCalled();
    });

    it("should skip confirmation when skipConfirmation option is true", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);

      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "",
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "write_file", input: { path: "/test.ts", content: "code" } },
        ],
      };

      const secondResponse: ChatWithToolsResponse = {
        id: "msg-2",
        content: "Done.",
        stopReason: "end_turn",
        usage: { inputTokens: 150, outputTokens: 75 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: {},
        duration: 10,
      });

      await executeAgentTurn(
        mockSession,
        "Write file",
        mockProvider,
        mockToolRegistry,
        { skipConfirmation: true }
      );

      expect(confirmToolExecution).not.toHaveBeenCalled();
    });

    it("should prompt for confirmation for destructive tools", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("yes");

      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "",
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "write_file", input: { path: "/test.ts", content: "code" } },
        ],
      };

      const secondResponse: ChatWithToolsResponse = {
        id: "msg-2",
        content: "Done.",
        stopReason: "end_turn",
        usage: { inputTokens: 150, outputTokens: 75 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: {},
        duration: 10,
      });

      await executeAgentTurn(
        mockSession,
        "Write file",
        mockProvider,
        mockToolRegistry
      );

      expect(confirmToolExecution).toHaveBeenCalled();
      expect(mockToolRegistry.execute).toHaveBeenCalled();
    });

    it("should skip tool when user declines confirmation", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("no");

      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "",
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "write_file", input: { path: "/test.ts", content: "code" } },
        ],
      };

      const secondResponse: ChatWithToolsResponse = {
        id: "msg-2",
        content: "Skipped.",
        stopReason: "end_turn",
        usage: { inputTokens: 150, outputTokens: 75 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      const onToolSkipped = vi.fn();

      await executeAgentTurn(
        mockSession,
        "Write file",
        mockProvider,
        mockToolRegistry,
        { onToolSkipped }
      );

      expect(onToolSkipped).toHaveBeenCalledWith(
        expect.objectContaining({ name: "write_file" }),
        "User declined"
      );
      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    });

    it("should abort turn when user chooses abort", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("abort");

      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Starting...",
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "write_file", input: { path: "/test.ts", content: "code" } },
        ],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(firstResponse);

      const result = await executeAgentTurn(
        mockSession,
        "Write file",
        mockProvider,
        mockToolRegistry
      );

      expect(result.aborted).toBe(true);
      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    });

    it("should allow all subsequent tools when user chooses yes_all", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution, createConfirmationState } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("yes_all");

      // Need to reset confirmation state for each test
      (createConfirmationState as Mock).mockReturnValue({ allowAll: false });

      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "",
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "write_file", input: { path: "/file1.ts", content: "code1" } },
          { id: "tool-2", name: "write_file", input: { path: "/file2.ts", content: "code2" } },
        ],
      };

      const secondResponse: ChatWithToolsResponse = {
        id: "msg-2",
        content: "Done.",
        stopReason: "end_turn",
        usage: { inputTokens: 150, outputTokens: 75 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: {},
        duration: 10,
      });

      await executeAgentTurn(
        mockSession,
        "Write files",
        mockProvider,
        mockToolRegistry
      );

      // Should only prompt once (for first tool), then allow all
      expect(confirmToolExecution).toHaveBeenCalledTimes(1);
      expect(mockToolRegistry.execute).toHaveBeenCalledTimes(2);
    });

    it("should trust tool for session when user chooses trust_session", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("trust_session");

      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "",
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "bash_exec", input: { command: "ls" } },
        ],
      };

      const secondResponse: ChatWithToolsResponse = {
        id: "msg-2",
        content: "Done.",
        stopReason: "end_turn",
        usage: { inputTokens: 150, outputTokens: 75 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: {},
        duration: 10,
      });

      await executeAgentTurn(
        mockSession,
        "Run command",
        mockProvider,
        mockToolRegistry
      );

      expect(mockSession.trustedTools.has("bash_exec")).toBe(true);
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
