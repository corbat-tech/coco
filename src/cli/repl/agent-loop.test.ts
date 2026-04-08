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
function createTextStreamMock(
  content: string,
  stopReason?: StreamChunk["stopReason"],
): () => AsyncIterable<StreamChunk> {
  return () =>
    toAsyncIterable(
      (function* (): Generator<StreamChunk> {
        if (content) {
          yield { type: "text", text: content };
        }
        yield { type: "done", stopReason };
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
  removeTrustedTool: vi.fn(() => Promise.resolve(undefined)),
  saveDeniedTool: vi.fn(() => Promise.resolve(undefined)),
  removeDeniedTool: vi.fn(() => Promise.resolve(undefined)),
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
    expect(result.quality?.score).toBeGreaterThanOrEqual(0);
    expect(result.quality?.score).toBeLessThanOrEqual(100);
    expect(result.aborted).toBe(false);
    expect(addMessage).toHaveBeenCalledTimes(2); // user message + assistant response
  });

  it("blocks bash_exec with `coco mcp` when user asked to use MCP", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const toolCall: ToolCall = {
      id: "tool-mcp-cli",
      name: "bash_exec",
      input: { command: "coco mcp list" },
    };

    (mockToolRegistry.getToolDefinitionsForLLM as Mock).mockReturnValue([
      { name: "bash_exec", description: "Run shell", input_schema: { type: "object" } },
      {
        name: "mcp_list_servers",
        description: "Inspect MCP runtime",
        input_schema: { type: "object" },
      },
      {
        name: "mcp_atlassian_browse_issue",
        description: "Browse Jira issue",
        input_schema: { type: "object" },
      },
    ]);

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolStreamMock("Checking MCP.", [toolCall])();
      }
      return createTextStreamMock("I will inspect the MCP runtime directly instead.")();
    });

    const result = await executeAgentTurn(
      mockSession,
      "Busca la tarea CDOCK-435 y usa el MCP",
      mockProvider,
      mockToolRegistry,
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(result.content).toContain("inspect the MCP runtime directly");
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

    // Should stop after 3 iterations + 1 final summary turn
    expect(result.toolCalls.length).toBe(3);
    // 3 agent iterations + 1 final text-only summary call = 4 total
    expect(mockProvider.streamWithTools).toHaveBeenCalledTimes(4);
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

  it("should force MCP usage when the user explicitly asks for MCP", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    mockToolRegistry = {
      getToolDefinitionsForLLM: vi.fn(() => [
        {
          name: "mcp_atlassian_browse",
          description: "Browse Jira via MCP",
          input_schema: { type: "object" },
        },
        { name: "http_fetch", description: "Fetch URL", input_schema: { type: "object" } },
      ]),
      execute: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      getAll: vi.fn(),
      getByCategory: vi.fn(),
    } as unknown as ToolRegistry;

    const genericFetch: ToolCall = {
      id: "tool-1",
      name: "http_fetch",
      input: { url: "https://decathlon.atlassian.net/rest/api/3/issue/CDOCK-435" },
    };

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolStreamMock("", [genericFetch])();
      }
      return createTextStreamMock("Usaré la tool MCP en vez de fetch genérico.")();
    });

    const result = await executeAgentTurn(
      mockSession,
      "Busca la tarea CDOCK-435 y usa el MCP",
      mockProvider,
      mockToolRegistry,
    );

    expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    expect(result.content).toContain("Usaré la tool MCP");
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

      // Pattern-aware: bash_exec + {command: "ls"} → "bash:ls"
      expect(mockSession.trustedTools.has("bash:ls")).toBe(true);
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

describe("Error loop recovery: final LLM turn", () => {
  let mockProvider: LLMProvider;
  let mockToolRegistry: ToolRegistry;
  let mockSession: ReplSession;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockProvider = {
      id: "mock",
      name: "Mock Provider",
      initialize: vi.fn(),
      chat: vi.fn(),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn(() => 10),
      getContextWindow: vi.fn(() => 100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    mockToolRegistry = {
      getToolDefinitionsForLLM: vi.fn(() => [
        { name: "read_file", description: "Read a file", input_schema: { type: "object" } },
      ]),
      execute: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      getAll: vi.fn(),
      getByCategory: vi.fn(),
    } as unknown as ToolRegistry;

    mockSession = {
      id: "test-session-error-loop",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      config: {
        provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
        ui: { theme: "auto" as const, showTimestamps: false, maxHistorySize: 100 },
        agent: {
          systemPrompt: "You are a helpful assistant",
          maxToolIterations: 25,
          confirmDestructive: false,
        },
      },
      trustedTools: new Set<string>(),
    };

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

  it("should give the LLM a final text-only turn after 3 consecutive identical errors", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const toolCall: ToolCall = { id: "tool-1", name: "read_file", input: { path: "/missing.ts" } };

    // Track call count to detect the final text-only call
    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(
      (_messages: unknown, opts: { tools: unknown[] }) => {
        callCount++;
        // After error loop detection, the agent-loop calls with tools=[] for the final explanation turn.
        // The normal tool definitions have length > 0 (we mocked 1 tool above).
        if (Array.isArray(opts?.tools) && opts.tools.length === 0) {
          return createTextStreamMock("I was unable to find the file. Let me explain...")();
        }
        // Normal calls: always return a tool call with unique ID
        return createToolStreamMock("", [{ ...toolCall, id: `tool-${callCount}` }])();
      },
    );

    // Tool always fails with the same error
    (mockToolRegistry.execute as Mock).mockResolvedValue({
      success: false,
      error: "File not found: /missing.ts",
      data: undefined,
      duration: 5,
    });

    const onStream = vi.fn();
    const result = await executeAgentTurn(
      mockSession,
      "Read missing file",
      mockProvider,
      mockToolRegistry,
      { onStream },
    );

    // The LLM should have been called 3 times:
    // 2 tool iterations (each failing, but error counter accumulates over all executedTools
    // per iteration — so after 2 iterations the count reaches 3) + 1 final text-only turn
    expect(callCount).toBe(3);

    // The final content should include the explanation
    expect(result.content).toContain("I was unable to find the file");

    // The final call should have been made with empty tools array
    const lastCallArgs = (mockProvider.streamWithTools as Mock).mock.calls.at(-1);
    expect(lastCallArgs?.[1]?.tools).toEqual([]);
  });
});

describe("Safety net: placeholder injection for missing tool results", () => {
  // Regression test for: if a tool_use block is in the assistant message but
  // parallel execution drops the result (e.g. ID mismatch, internal error), the
  // API would reject the next request with Error 400 because tool_result is absent.
  // The fix injects a placeholder tool_result with is_error=true and logs a warning.

  let mockProvider: LLMProvider;
  let mockToolRegistry: ToolRegistry;
  let mockSession: ReplSession;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockProvider = {
      id: "mock",
      name: "Mock Provider",
      initialize: vi.fn(),
      chat: vi.fn(),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn().mockImplementation(createTextStreamMock("Done.")),
      countTokens: vi.fn(() => 10),
      getContextWindow: vi.fn(() => 100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    mockToolRegistry = {
      getToolDefinitionsForLLM: vi.fn(() => []),
      execute: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      getAll: vi.fn(),
      getByCategory: vi.fn(),
    } as unknown as ToolRegistry;

    mockSession = {
      id: "test-session-safety",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      config: {
        provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
        ui: { theme: "auto" as const, showTimestamps: false, maxHistorySize: 100 },
        agent: {
          systemPrompt: "You are a helpful assistant",
          maxToolIterations: 25,
          confirmDestructive: false,
        },
      },
      trustedTools: new Set<string>(),
    };

    const { getConversationContext } = await import("./session.js");
    (getConversationContext as Mock).mockReturnValue([
      { role: "system", content: "System prompt" },
    ]);

    const { requiresConfirmation } = await import("./confirmation.js");
    (requiresConfirmation as Mock).mockReturnValue(false);
  });

  it("should inject is_error placeholder when parallel executor returns no result for a streamed tool call", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");
    const { ParallelToolExecutor } = await import("./parallel-executor.js");

    const toolCall: ToolCall = { id: "tool-missing", name: "read_file", input: { path: "/x.ts" } };

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolStreamMock("", [toolCall])();
      }
      return createTextStreamMock("Recovered.")();
    });

    // Force the parallel executor to return no results (simulates a dropped execution)
    vi.spyOn(ParallelToolExecutor.prototype, "executeParallel").mockResolvedValueOnce({
      executed: [],
      skipped: [],
      aborted: false,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Should not throw — safety net must handle the missing result gracefully
    const result = await executeAgentTurn(mockSession, "Read file", mockProvider, mockToolRegistry);

    expect(result.aborted).toBe(false);

    // The safety net must have emitted a warning
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[AgentLoop] No result found for tool call"),
    );

    // The LLM must have been called a second time (the placeholder allowed the loop to continue)
    expect(mockProvider.streamWithTools).toHaveBeenCalledTimes(2);
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

describe("max_tokens auto-continue", () => {
  let mockProvider: LLMProvider;
  let mockToolRegistry: ToolRegistry;
  let mockSession: ReplSession;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockProvider = {
      id: "mock",
      name: "Mock Provider",
      initialize: vi.fn(),
      chat: vi.fn(),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn(() => 10),
      getContextWindow: vi.fn(() => 100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    mockToolRegistry = {
      getToolDefinitionsForLLM: vi.fn(() => [
        { name: "read_file", description: "Read a file", input_schema: { type: "object" } },
      ]),
      execute: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      getAll: vi.fn(),
      getByCategory: vi.fn(),
    } as unknown as ToolRegistry;

    mockSession = {
      id: "test-session-max-tokens",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      config: {
        provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
        ui: { theme: "auto" as const, showTimestamps: false, maxHistorySize: 100 },
        agent: {
          systemPrompt: "You are a helpful assistant",
          maxToolIterations: 25,
          confirmDestructive: false,
        },
      },
      trustedTools: new Set<string>(),
    };

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

  it("should auto-continue when max_tokens with no tool calls", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");
    const { addMessage } = await import("./session.js");

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: partial text cut off by max_tokens
        return createTextStreamMock("This is a partial respon", "max_tokens")();
      }
      // Second call: continuation completes normally
      return createTextStreamMock("se that is now complete.")();
    });

    const result = await executeAgentTurn(
      mockSession,
      "Write something long",
      mockProvider,
      mockToolRegistry,
    );

    // Should have called LLM twice (original + continuation)
    expect(callCount).toBe(2);
    // Content should include both parts
    expect(result.content).toContain("This is a partial respon");
    expect(result.content).toContain("se that is now complete.");
    expect(result.aborted).toBe(false);

    // Should have injected continuation prompt via addMessage
    expect(addMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("cut off due to the output token limit"),
      }),
    );
  });

  it("should auto-continue when max_tokens fires with empty content", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: done(max_tokens) with no text content
        return createTextStreamMock("", "max_tokens")();
      }
      // Second call: continuation produces content
      return createTextStreamMock("Recovered after empty max_tokens.")();
    });

    const result = await executeAgentTurn(
      mockSession,
      "Write something",
      mockProvider,
      mockToolRegistry,
    );

    expect(callCount).toBe(2);
    expect(result.content).toContain("Recovered after empty max_tokens.");
    expect(result.aborted).toBe(false);
  });

  it("should recover when stopReason is tool_use but no tool calls were reconstructed", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Simulates provider drift: announces tool_use but no tool events arrive
        return createTextStreamMock("Voy a ejecutar los pasos ahora.", "tool_use")();
      }
      // Next attempt actually emits a tool call
      return createToolStreamMock("", [{ id: "t1", name: "read_file", input: { path: "a.ts" } }])();
    });

    (mockToolRegistry.execute as Mock).mockResolvedValue({
      success: true,
      data: "ok",
      duration: 1,
    } as ToolResult);

    const result = await executeAgentTurn(mockSession, "Hazlo", mockProvider, mockToolRegistry);

    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(result.toolCalls.length).toBeGreaterThan(0);
    expect(result.aborted).toBe(false);
  });

  it("should respect iteration limit during max_tokens continuation", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    // Always return max_tokens — should not loop forever
    (mockProvider.streamWithTools as Mock).mockImplementation(
      createTextStreamMock("partial...", "max_tokens"),
    );

    mockSession.config.agent.maxToolIterations = 3;

    const onStream = vi.fn();
    const result = await executeAgentTurn(
      mockSession,
      "Write something",
      mockProvider,
      mockToolRegistry,
      { onStream },
    );

    // max_tokens auto-continue path exits via collectedToolCalls.length === 0 (no tools),
    // so the isLastIteration handler (which requires toolResults.length > 0) does NOT fire.
    // The loop exits naturally after 3 max_tokens continuations.
    // No extra summary call is made because there were no tool calls on the last iteration.
    expect(mockProvider.streamWithTools).toHaveBeenCalledTimes(3);

    // Content is the accumulated partial responses
    expect(result.content).toContain("partial...");
  });
});

describe("iteration limit notice", () => {
  let mockProvider: LLMProvider;
  let mockToolRegistry: ToolRegistry;
  let mockSession: ReplSession;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockProvider = {
      id: "mock",
      name: "Mock Provider",
      initialize: vi.fn(),
      chat: vi.fn(),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn(() => 10),
      getContextWindow: vi.fn(() => 100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    mockToolRegistry = {
      getToolDefinitionsForLLM: vi.fn(() => [
        { name: "read_file", description: "Read a file", input_schema: { type: "object" } },
      ]),
      execute: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      getAll: vi.fn(),
      getByCategory: vi.fn(),
    } as unknown as ToolRegistry;

    mockSession = {
      id: "test-session-iter-limit",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      config: {
        provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
        ui: { theme: "auto" as const, showTimestamps: false, maxHistorySize: 100 },
        agent: {
          systemPrompt: "You are a helpful assistant",
          maxToolIterations: 3,
          confirmDestructive: false,
        },
      },
      trustedTools: new Set<string>(),
    };

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

  it("should give LLM a final summary turn when tool loop exhausts iterations", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const toolCall: ToolCall = { id: "tool-1", name: "read_file", input: { path: "/file.ts" } };

    // maxToolIterations = 3 in the mock session config
    // Calls 1–3: LLM keeps making tool calls (hitting the limit)
    // Call 4: final text-only summary turn (tools=[])
    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        return createToolStreamMock("", [toolCall])();
      }
      // Final summary turn — LLM summarises what happened
      return createTextStreamMock(
        "Task incomplete. The file was read 3 times. Type continue to proceed.",
      )();
    });

    (mockToolRegistry.execute as Mock).mockResolvedValue({
      success: true,
      data: "content",
      duration: 1,
    });

    const onStream = vi.fn();
    const result = await executeAgentTurn(
      mockSession,
      "Keep reading",
      mockProvider,
      mockToolRegistry,
      { onStream },
    );

    // The final summary from the LLM should appear in the result
    expect(result.content).toContain("Task incomplete");
    expect(result.content).toContain("continue");

    // The summary text should have been streamed (not a static notice)
    const streamCalls = onStream.mock.calls.map((c: [StreamChunk]) => c[0]);
    const summaryChunks = streamCalls.filter(
      (c: StreamChunk) => c.type === "text" && c.text?.includes("Task incomplete"),
    );
    expect(summaryChunks.length).toBeGreaterThan(0);

    // streamWithTools should have been called 4 times (3 iterations + 1 final summary)
    expect(callCount).toBe(4);
  });

  it("should auto-extend iteration budget when tools are still making progress", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    mockSession.config.agent.maxToolIterations = 2;
    const toolCall: ToolCall = { id: "tool-progress", name: "read_file", input: { path: "/x.ts" } };

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return createToolStreamMock("", [toolCall])();
      }
      // After auto-extension, model can finish normally without explicit handoff
      return createTextStreamMock("Completed after auto-extension.")();
    });

    (mockToolRegistry.execute as Mock).mockResolvedValue({
      success: true,
      data: "ok",
      duration: 1,
    });

    const result = await executeAgentTurn(
      mockSession,
      "continue work",
      mockProvider,
      mockToolRegistry,
    );

    expect(callCount).toBe(3);
    expect(result.content).toContain("Completed after auto-extension.");
    expect(result.content).not.toContain('Type "continue"');
  });

  it("should NOT show iteration limit notice when loop ends normally", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    // Normal response — no tool calls, ends after 1 iteration
    (mockProvider.streamWithTools as Mock).mockImplementation(createTextStreamMock("All done!"));

    const result = await executeAgentTurn(mockSession, "Hello", mockProvider, mockToolRegistry);

    expect(result.content).toBe("All done!");
    expect(result.content).not.toContain("iteration limit");
  });

  it("should inject steering messages between iterations via onSteeringCheck", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");
    const { addMessage } = await import("./session.js");

    const toolCall: ToolCall = { id: "tool-steer-1", name: "read_file", input: { path: "/a.ts" } };

    // First call returns a tool call, second call returns text (no more tools)
    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolStreamMock("Reading file...", [toolCall])();
      }
      return createTextStreamMock("Done with adjustments.")();
    });

    const toolResult: ToolResult = {
      success: true,
      data: { content: "file content" },
      duration: 5,
    };
    (mockToolRegistry.execute as Mock).mockResolvedValue(toolResult);

    // Steering: return a message on first check, empty on second
    let steerCallCount = 0;
    const onSteeringCheck = vi.fn(() => {
      steerCallCount++;
      if (steerCallCount === 1) {
        return ["use camelCase for variable names"];
      }
      return [];
    });

    const result = await executeAgentTurn(
      mockSession,
      "Fix the code",
      mockProvider,
      mockToolRegistry,
      {
        onSteeringCheck,
      },
    );

    // Steering check should have been called at least once (between iterations)
    expect(onSteeringCheck).toHaveBeenCalled();

    // Steering message should have been injected via addMessage
    expect(addMessage).toHaveBeenCalledWith(
      mockSession,
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("use camelCase for variable names"),
      }),
    );

    // Agent should NOT be aborted — steering doesn't abort
    expect(result.aborted).toBe(false);
  });

  it("should not inject steering when onSteeringCheck returns empty", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");
    const { addMessage } = await import("./session.js");

    const toolCall: ToolCall = { id: "tool-steer-2", name: "read_file", input: { path: "/b.ts" } };

    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolStreamMock("", [toolCall])();
      }
      return createTextStreamMock("Done.")();
    });

    const toolResult: ToolResult = { success: true, data: { content: "ok" }, duration: 5 };
    (mockToolRegistry.execute as Mock).mockResolvedValue(toolResult);

    const onSteeringCheck = vi.fn(() => []);

    await executeAgentTurn(mockSession, "Do something", mockProvider, mockToolRegistry, {
      onSteeringCheck,
    });

    // Should have been called, but no steering message injected
    expect(onSteeringCheck).toHaveBeenCalled();

    // addMessage should NOT have been called with steering content
    const steeringCalls = (addMessage as Mock).mock.calls.filter((call: unknown[]) => {
      const msg = call[1] as { content: string };
      return typeof msg.content === "string" && msg.content.includes("Mid-task steering");
    });
    expect(steeringCalls).toHaveLength(0);
  });
});

describe("streaming text suppression during tool iterations", () => {
  let mockProvider: LLMProvider;
  let mockToolRegistry: ToolRegistry;
  let mockSession: ReplSession;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockProvider = {
      id: "mock",
      name: "Mock Provider",
      initialize: vi.fn(),
      chat: vi.fn(),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn(() => 10),
      getContextWindow: vi.fn(() => 100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    mockToolRegistry = {
      getToolDefinitionsForLLM: vi.fn(() => [
        { name: "read_file", description: "Read a file", input_schema: { type: "object" } },
      ]),
      execute: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      getAll: vi.fn(),
      getByCategory: vi.fn(),
    } as unknown as ToolRegistry;

    mockSession = {
      id: "test-session-suppression",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      config: {
        provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
        ui: { theme: "auto", showTimestamps: false, maxHistorySize: 100 },
        agent: {
          systemPrompt: "You are a helpful assistant",
          maxToolIterations: 25,
          confirmDestructive: true,
        },
      },
      trustedTools: new Set<string>(),
    };

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

  it("shows text normally when the turn has no tool calls (final response)", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    (mockProvider.streamWithTools as Mock).mockImplementation(
      createTextStreamMock("Here is a direct answer."),
    );

    const streamedChunks: StreamChunk[] = [];
    await executeAgentTurn(mockSession, "What is 2+2?", mockProvider, mockToolRegistry, {
      onStream: (chunk) => streamedChunks.push(chunk),
    });

    const text = streamedChunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(text).toContain("direct answer");
  });

  it("suppresses intermediate text when the turn ends with tool calls", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const toolCall: ToolCall = { id: "t1", name: "read_file", input: { path: "/f.ts" } };
    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createToolStreamMock("I will read the file now.", [toolCall])();
      return createTextStreamMock("The file is empty.")();
    });

    (mockToolRegistry.execute as Mock).mockResolvedValue({ success: true, data: {}, duration: 1 });

    const streamedChunks: StreamChunk[] = [];
    await executeAgentTurn(mockSession, "Read the file", mockProvider, mockToolRegistry, {
      onStream: (chunk) => streamedChunks.push(chunk),
    });

    const allText = streamedChunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    // Intermediate reasoning must NOT appear
    expect(allText).not.toContain("I will read the file now");
    // Final response must appear
    expect(allText).toContain("The file is empty");
  });

  it("suppresses text across multiple tool iterations but flushes the final response", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    const tc1: ToolCall = { id: "t1", name: "read_file", input: { path: "/a.ts" } };
    const tc2: ToolCall = { id: "t2", name: "read_file", input: { path: "/b.ts" } };
    let callCount = 0;
    (mockProvider.streamWithTools as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createToolStreamMock("Step 1 reasoning.", [tc1])();
      if (callCount === 2) return createToolStreamMock("Step 2 reasoning.", [tc2])();
      return createTextStreamMock("Done! Both files processed.")();
    });

    (mockToolRegistry.execute as Mock).mockResolvedValue({ success: true, data: {}, duration: 1 });

    const streamedChunks: StreamChunk[] = [];
    await executeAgentTurn(mockSession, "Process files", mockProvider, mockToolRegistry, {
      onStream: (chunk) => streamedChunks.push(chunk),
    });

    const allText = streamedChunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    expect(allText).not.toContain("Step 1 reasoning");
    expect(allText).not.toContain("Step 2 reasoning");
    expect(allText).toContain("Done! Both files processed");
  });

  it("still passes done chunk through to onStream on final turn", async () => {
    const { executeAgentTurn } = await import("./agent-loop.js");

    (mockProvider.streamWithTools as Mock).mockImplementation(
      createTextStreamMock("Final answer."),
    );

    const doneChunks: StreamChunk[] = [];
    await executeAgentTurn(mockSession, "Hi", mockProvider, mockToolRegistry, {
      onStream: (chunk) => {
        if (chunk.type === "done") doneChunks.push(chunk);
      },
    });

    expect(doneChunks.length).toBeGreaterThan(0);
  });
});
