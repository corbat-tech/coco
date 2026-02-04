/**
 * Integration tests for REPL components
 *
 * Tests multiple components working together:
 * - Session initialization
 * - Message handling flow
 * - Tool execution flow
 * - Context management integration
 * - Progress tracking integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type {
  LLMProvider,
  ChatWithToolsResponse,
  ChatResponse,
  Message,
  ToolDefinition,
  StreamChunk,
  ToolCall,
} from "../../providers/types.js";
import type { ToolRegistry, ToolResult } from "../../tools/registry.js";
import type { ReplSession, ExecutedToolCall } from "./types.js";
import { ContextManager, createContextManager } from "./context/manager.js";
import { ProgressTracker, createProgressTracker } from "./progress/tracker.js";

// Mock chalk to simplify output testing
vi.mock("chalk", () => ({
  default: {
    yellow: (s: string) => `[yellow]${s}[/yellow]`,
    dim: (s: string) => `[dim]${s}[/dim]`,
    red: (s: string) => `[red]${s}[/red]`,
    green: (s: string) => `[green]${s}[/green]`,
    blue: (s: string) => `[blue]${s}[/blue]`,
    cyan: (s: string) => `[cyan]${s}[/cyan]`,
  },
}));

// Mock session functions
vi.mock("./session.js", () => ({
  createSession: vi.fn(),
  createDefaultReplConfig: vi.fn(() => ({
    provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
    ui: { theme: "auto", showTimestamps: false, maxHistorySize: 100 },
    agent: {
      systemPrompt: "You are a helpful assistant",
      maxToolIterations: 25,
      confirmDestructive: true,
    },
  })),
  getConversationContext: vi.fn(),
  addMessage: vi.fn(),
  clearSession: vi.fn(),
  saveTrustedTool: vi.fn(() => Promise.resolve(undefined)),
  loadTrustedTools: vi.fn(() => Promise.resolve(new Set<string>())),
  initializeSessionTrust: vi.fn(() => Promise.resolve(undefined)),
  initializeContextManager: vi.fn(),
  updateContextTokens: vi.fn(),
  checkAndCompactContext: vi.fn(() => Promise.resolve(null)),
  getContextUsagePercent: vi.fn(() => 50),
  getContextUsageFormatted: vi.fn(() => "50k/100k tokens (50%)"),
}));

// Mock confirmation module
vi.mock("./confirmation.js", () => ({
  requiresConfirmation: vi.fn(),
  confirmToolExecution: vi.fn(),
  createConfirmationState: vi.fn(() => ({ allowAll: false })),
}));

/**
 * Helper to create a mock async generator for streaming responses
 */
function createMockStreamWithTools(
  content: string,
  toolCalls: ToolCall[] = []
): () => AsyncIterable<StreamChunk> {
  return function* mockStream(): Generator<StreamChunk> {
    // Yield text content character by character (or in chunks)
    if (content) {
      yield { type: "text", text: content };
    }

    // Yield tool calls
    for (const tc of toolCalls) {
      yield { type: "tool_use_start", toolCall: { id: tc.id, name: tc.name } };
      yield { type: "tool_use_end", toolCall: tc };
    }

    yield { type: "done" };
  } as unknown as () => AsyncIterable<StreamChunk>;
}

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
 * Create a mock LLM provider for testing
 */
function createMockProvider(): LLMProvider {
  return {
    id: "mock",
    name: "Mock Provider",
    initialize: vi.fn().mockResolvedValue(undefined),
    chat: vi.fn(),
    chatWithTools: vi.fn(),
    stream: vi.fn(),
    streamWithTools: vi.fn().mockImplementation(() => toAsyncIterable(
      (function* (): Generator<StreamChunk> {
        yield { type: "text", text: "Mock response" };
        yield { type: "done" };
      })()
    )),
    countTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
    getContextWindow: vi.fn(() => 200000),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

/**
 * Create a mock tool registry for testing
 */
function createMockToolRegistry(): ToolRegistry {
  return {
    getToolDefinitionsForLLM: vi.fn(() => [
      { name: "read_file", description: "Read a file", input_schema: { type: "object" } },
      { name: "write_file", description: "Write a file", input_schema: { type: "object" } },
      { name: "bash_exec", description: "Execute a bash command", input_schema: { type: "object" } },
    ]),
    execute: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    getAll: vi.fn(),
    getByCategory: vi.fn(),
  } as unknown as ToolRegistry;
}

/**
 * Create a mock session for testing
 */
function createMockSession(overrides: Partial<ReplSession> = {}): ReplSession {
  return {
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
    ...overrides,
  };
}

describe("REPL Integration Tests", () => {
  let mockProvider: LLMProvider;
  let mockToolRegistry: ToolRegistry;
  let mockSession: ReplSession;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockProvider = createMockProvider();
    mockToolRegistry = createMockToolRegistry();
    mockSession = createMockSession();

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

  describe("Session Initialization Flow", () => {
    it("should initialize session with default configuration", async () => {
      const { createSession, createDefaultReplConfig } = await import("./session.js");

      (createSession as Mock).mockReturnValue(mockSession);

      const config = (createDefaultReplConfig as Mock)();
      expect(config.provider.type).toBe("anthropic");
      expect(config.agent.maxToolIterations).toBe(25);
      expect(config.agent.confirmDestructive).toBe(true);
    });

    it("should initialize session trust from persisted storage", async () => {
      const { loadTrustedTools, initializeSessionTrust } = await import("./session.js");

      const trustedTools = new Set(["read_file", "bash_exec"]);
      (loadTrustedTools as Mock).mockResolvedValue(trustedTools);

      await initializeSessionTrust(mockSession);

      expect(initializeSessionTrust).toHaveBeenCalledWith(mockSession);
    });

    it("should initialize context manager with provider context window", () => {
      const contextManager = createContextManager(200000, {
        compactionThreshold: 0.8,
        reservedTokens: 4096,
      });

      expect(contextManager.getUsedTokens()).toBe(0);
      expect(contextManager.getAvailableTokens()).toBe(200000 - 4096);
      expect(contextManager.shouldCompact()).toBe(false);
    });

    it("should initialize progress tracker for session", () => {
      const tracker = createProgressTracker();

      expect(tracker.getTodos()).toHaveLength(0);
      expect(tracker.hasTodos()).toBe(false);
      expect(tracker.isComplete()).toBe(true);
    });
  });

  describe("Message Handling Flow", () => {
    it("should add user message to session and get conversation context", async () => {
      const { addMessage, getConversationContext } = await import("./session.js");

      const userMessage: Message = { role: "user", content: "Hello" };
      addMessage(mockSession, userMessage);

      expect(addMessage).toHaveBeenCalledWith(mockSession, userMessage);

      const context = getConversationContext(mockSession);
      expect(context).toBeDefined();
      expect(context[0].role).toBe("system");
    });

    it("should handle multi-turn conversation flow", async () => {
      const { addMessage, getConversationContext } = await import("./session.js");

      // Simulate multi-turn conversation
      const messages: Message[] = [
        { role: "user", content: "What is TypeScript?" },
        { role: "assistant", content: "TypeScript is a typed superset of JavaScript." },
        { role: "user", content: "How do I install it?" },
        { role: "assistant", content: "You can install it with npm install typescript." },
      ];

      (getConversationContext as Mock).mockReturnValue([
        { role: "system", content: "You are a helpful assistant" },
        ...messages,
      ]);

      for (const msg of messages) {
        addMessage(mockSession, msg);
      }

      const context = getConversationContext(mockSession);
      expect(context).toHaveLength(5); // system + 4 messages
    });

    it("should clear session messages", async () => {
      const { clearSession } = await import("./session.js");

      mockSession.messages = [
        { role: "user", content: "test" },
        { role: "assistant", content: "response" },
      ];

      clearSession(mockSession);

      expect(clearSession).toHaveBeenCalledWith(mockSession);
    });
  });

  describe("Tool Execution Flow", () => {
    it("should execute tool and get result", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");

      // Setup streaming responses with tool call first iteration, then final response
      const toolCall: ToolCall = { id: "tool-1", name: "read_file", input: { path: "/test.ts" } };

      let callCount = 0;
      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: return tool call
          return toAsyncIterable(
            (function* (): Generator<StreamChunk> {
              yield { type: "text", text: "Let me read that file." };
              yield { type: "tool_use_start", toolCall: { id: toolCall.id, name: toolCall.name } };
              yield { type: "tool_use_end", toolCall };
              yield { type: "done" };
            })()
          );
        }
        // Second call: return final response
        return toAsyncIterable(
          (function* (): Generator<StreamChunk> {
            yield { type: "text", text: "The file contains TypeScript code." };
            yield { type: "done" };
          })()
        );
      });

      const toolResult: ToolResult = {
        success: true,
        data: { content: "export function test() {}" },
        duration: 10,
      };
      (mockToolRegistry.execute as Mock).mockResolvedValue(toolResult);

      const result = await executeAgentTurn(
        mockSession,
        "Read test.ts",
        mockProvider,
        mockToolRegistry
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe("read_file");
      expect(result.toolCalls[0]?.result.success).toBe(true);
      expect(mockToolRegistry.execute).toHaveBeenCalledWith("read_file", { path: "/test.ts" }, expect.anything());
    });

    it("should handle multiple parallel tool calls", async () => {
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
          return toAsyncIterable(
            (function* (): Generator<StreamChunk> {
              yield { type: "text", text: "Reading multiple files..." };
              for (const tc of toolCalls) {
                yield { type: "tool_use_start", toolCall: { id: tc.id, name: tc.name } };
                yield { type: "tool_use_end", toolCall: tc };
              }
              yield { type: "done" };
            })()
          );
        }
        return toAsyncIterable(
          (function* (): Generator<StreamChunk> {
            yield { type: "text", text: "All files read successfully." };
            yield { type: "done" };
          })()
        );
      });

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: { content: "file content" },
        duration: 5,
      });

      const result = await executeAgentTurn(
        mockSession,
        "Read all files",
        mockProvider,
        mockToolRegistry
      );

      expect(result.toolCalls).toHaveLength(3);
      expect(mockToolRegistry.execute).toHaveBeenCalledTimes(3);
    });

    it("should handle tool execution errors gracefully", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");

      const toolCall: ToolCall = { id: "tool-1", name: "read_file", input: { path: "/nonexistent.ts" } };

      let callCount = 0;
      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return toAsyncIterable(
            (function* (): Generator<StreamChunk> {
              yield { type: "tool_use_start", toolCall: { id: toolCall.id, name: toolCall.name } };
              yield { type: "tool_use_end", toolCall };
              yield { type: "done" };
            })()
          );
        }
        return toAsyncIterable(
          (function* (): Generator<StreamChunk> {
            yield { type: "text", text: "The file does not exist." };
            yield { type: "done" };
          })()
        );
      });

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: false,
        error: "ENOENT: File not found",
        duration: 2,
      });

      const result = await executeAgentTurn(
        mockSession,
        "Read nonexistent.ts",
        mockProvider,
        mockToolRegistry
      );

      expect(result.toolCalls[0]?.result.success).toBe(false);
      expect(result.toolCalls[0]?.result.error).toContain("ENOENT");
    });

    it("should skip tool when confirmation is denied", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { requiresConfirmation, confirmToolExecution } = await import("./confirmation.js");

      (requiresConfirmation as Mock).mockReturnValue(true);
      (confirmToolExecution as Mock).mockResolvedValue("no");

      const toolCall: ToolCall = { id: "tool-1", name: "write_file", input: { path: "/test.ts", content: "code" } };

      let callCount = 0;
      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return toAsyncIterable(
            (function* (): Generator<StreamChunk> {
              yield { type: "tool_use_start", toolCall: { id: toolCall.id, name: toolCall.name } };
              yield { type: "tool_use_end", toolCall };
              yield { type: "done" };
            })()
          );
        }
        return toAsyncIterable(
          (function* (): Generator<StreamChunk> {
            yield { type: "text", text: "Skipped writing file." };
            yield { type: "done" };
          })()
        );
      });

      const onToolSkipped = vi.fn();

      await executeAgentTurn(
        mockSession,
        "Write file",
        mockProvider,
        mockToolRegistry,
        { onToolSkipped }
      );

      expect(onToolSkipped).toHaveBeenCalled();
      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    });
  });

  describe("Context Management Integration", () => {
    it("should track token usage across turns", () => {
      const contextManager = createContextManager(200000, {
        compactionThreshold: 0.8,
        reservedTokens: 4096,
      });

      // Simulate adding tokens for each turn
      contextManager.addTokens(5000); // Turn 1
      expect(contextManager.getUsedTokens()).toBe(5000);

      contextManager.addTokens(3000); // Turn 2
      expect(contextManager.getUsedTokens()).toBe(8000);

      contextManager.addTokens(2000); // Turn 3
      expect(contextManager.getUsedTokens()).toBe(10000);

      expect(contextManager.getUsagePercent()).toBeCloseTo(5.1, 1);
    });

    it("should detect when compaction is needed", () => {
      const contextManager = createContextManager(100000, {
        compactionThreshold: 0.8,
        reservedTokens: 4096,
      });

      // Add tokens to exceed 80% threshold
      // Available: 100000 - 4096 = 95904
      // 80% threshold: 76723.2
      contextManager.addTokens(75000);
      expect(contextManager.shouldCompact()).toBe(false);

      contextManager.addTokens(5000);
      expect(contextManager.shouldCompact()).toBe(true);
    });

    it("should update token count after compaction", () => {
      const contextManager = createContextManager(100000, {
        compactionThreshold: 0.8,
        reservedTokens: 4096,
      });

      // Fill context
      contextManager.setUsedTokens(80000);
      expect(contextManager.shouldCompact()).toBe(true);

      // Simulate compaction
      contextManager.setUsedTokens(40000);
      expect(contextManager.shouldCompact()).toBe(false);
      expect(contextManager.getUsedTokens()).toBe(40000);
    });

    it("should format usage for display", () => {
      const contextManager = createContextManager(200000, {
        compactionThreshold: 0.8,
        reservedTokens: 4096,
      });

      contextManager.setUsedTokens(50000);
      const formatted = contextManager.formatUsage();

      expect(formatted).toContain("50.0k");
      expect(formatted).toContain("tokens");
      expect(formatted).toContain("%");
    });
  });

  describe("Progress Tracking Integration", () => {
    it("should track task progress through lifecycle", () => {
      const tracker = createProgressTracker();

      // Add tasks
      const task1 = tracker.addTodo("Implement feature", "Implementing feature");
      const task2 = tracker.addTodo("Write tests", "Writing tests");
      const task3 = tracker.addTodo("Update docs", "Updating docs");

      expect(tracker.getTodos()).toHaveLength(3);
      expect(tracker.getStats().pending).toBe(3);

      // Start first task
      tracker.startTodo(task1.id);
      expect(tracker.getCurrentTask()?.id).toBe(task1.id);
      expect(tracker.getStats().inProgress).toBe(1);

      // Complete first task
      tracker.completeTodo(task1.id);
      expect(tracker.getStats().completed).toBe(1);
      expect(tracker.getStats().inProgress).toBe(0);

      // Start and fail second task
      tracker.startTodo(task2.id);
      tracker.failTodo(task2.id);
      expect(tracker.getStats().failed).toBe(1);

      // Complete third task
      tracker.startTodo(task3.id);
      tracker.completeTodo(task3.id);

      expect(tracker.getStats().completed).toBe(2);
      expect(tracker.getStats().failed).toBe(1);
      expect(tracker.isComplete()).toBe(true);
    });

    it("should support nested todos", () => {
      const tracker = createProgressTracker();

      const parent = tracker.addTodo("Build module", "Building module");
      const child1 = tracker.addTodo("Create types", "Creating types", parent.id);
      const child2 = tracker.addTodo("Implement logic", "Implementing logic", parent.id);

      expect(tracker.getChildTodos(parent.id)).toHaveLength(2);
      expect(child1.parentId).toBe(parent.id);
      expect(child2.parentId).toBe(parent.id);
    });

    it("should serialize and restore state", () => {
      const tracker = createProgressTracker();

      tracker.addTodo("Task 1", "Doing task 1");
      const task2 = tracker.addTodo("Task 2", "Doing task 2");
      tracker.startTodo(task2.id);

      // Serialize
      const state = tracker.toJSON();
      expect(state.todos).toHaveLength(2);
      expect(state.currentTask).toBe(task2.id);

      // Restore in new tracker
      const restoredTracker = createProgressTracker(state);
      expect(restoredTracker.getTodos()).toHaveLength(2);
      expect(restoredTracker.getCurrentTask()?.id).toBe(task2.id);
    });

    it("should format progress for display", () => {
      const tracker = createProgressTracker();

      // No tasks
      expect(tracker.formatProgress()).toBe("No tasks");

      // Add and complete tasks
      const task1 = tracker.addTodo("Task 1", "Doing task 1");
      const task2 = tracker.addTodo("Task 2", "Doing task 2");
      tracker.completeTodo(task1.id);
      tracker.startTodo(task2.id);

      const progress = tracker.formatProgress();
      expect(progress).toContain("1/2 completed");
      expect(progress).toContain("1 in progress");
      expect(progress).toContain("50%");
    });
  });

  describe("Full Integration Flow", () => {
    it("should handle complete agent turn with context and progress tracking", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");

      // Initialize session with context manager and progress tracker
      const contextManager = createContextManager(200000);
      const progressTracker = createProgressTracker();

      const sessionWithTracking: ReplSession = {
        ...mockSession,
        contextManager,
        progressTracker,
      };

      // Add progress tracking
      const task = progressTracker.addTodo("Read and analyze file", "Reading and analyzing file");
      progressTracker.startTodo(task.id);

      const toolCall: ToolCall = { id: "tool-1", name: "read_file", input: { path: "/test.ts" } };

      let callCount = 0;
      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return toAsyncIterable(
            (function* (): Generator<StreamChunk> {
              yield { type: "text", text: "Reading the file..." };
              yield { type: "tool_use_start", toolCall: { id: toolCall.id, name: toolCall.name } };
              yield { type: "tool_use_end", toolCall };
              yield { type: "done" };
            })()
          );
        }
        return toAsyncIterable(
          (function* (): Generator<StreamChunk> {
            yield { type: "text", text: "File analyzed successfully." };
            yield { type: "done" };
          })()
        );
      });

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: { content: "export const test = 1;" },
        duration: 10,
      });

      // Execute turn
      const result = await executeAgentTurn(
        sessionWithTracking,
        "Analyze test.ts",
        mockProvider,
        mockToolRegistry
      );

      // Verify result
      expect(result.content).toContain("analyzed");
      // Token usage is now estimated by countTokens, so don't check exact values
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);

      // Complete task
      progressTracker.completeTodo(task.id);
      expect(progressTracker.isComplete()).toBe(true);
    });

    it("should handle abort with partial progress", async () => {
      const { executeAgentTurn } = await import("./agent-loop.js");

      const progressTracker = createProgressTracker();
      const sessionWithTracking: ReplSession = {
        ...mockSession,
        progressTracker,
      };

      const task = progressTracker.addTodo("Long running task", "Running long task");
      progressTracker.startTodo(task.id);

      const toolCalls: ToolCall[] = [
        { id: "tool-1", name: "read_file", input: { path: "/file1.ts" } },
        { id: "tool-2", name: "read_file", input: { path: "/file2.ts" } },
      ];

      (mockProvider.streamWithTools as Mock).mockImplementation(() => {
        return toAsyncIterable(
          (function* (): Generator<StreamChunk> {
            for (const tc of toolCalls) {
              yield { type: "tool_use_start", toolCall: { id: tc.id, name: tc.name } };
              yield { type: "tool_use_end", toolCall: tc };
            }
            yield { type: "done" };
          })()
        );
      });

      const abortController = new AbortController();

      // Abort after first tool
      (mockToolRegistry.execute as Mock).mockImplementation(async () => {
        abortController.abort();
        return { success: true, data: "content", duration: 10 };
      });

      const result = await executeAgentTurn(
        sessionWithTracking,
        "Read files",
        mockProvider,
        mockToolRegistry,
        { signal: abortController.signal }
      );

      expect(result.toolCalls.length).toBeLessThanOrEqual(2);

      // Task should still be in progress (not completed due to abort)
      expect(progressTracker.getCurrentTask()?.status).toBe("in_progress");
    });
  });
});
