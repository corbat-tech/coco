import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./headless-stdin.js", () => ({ readHeadlessStdin: vi.fn(async () => "") }));

// Mock dependencies
vi.mock("./repl/session.js", () => ({
  createSession: vi.fn(() => ({
    id: "test-session",
    startedAt: new Date(),
    messages: [],
    projectPath: "/test",
    config: {
      provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
      ui: { theme: "auto", showTimestamps: false, maxHistorySize: 100 },
      agent: { systemPrompt: "", maxToolIterations: 20, confirmDestructive: true },
    },
    trustedTools: new Set(),
  })),
  initializeSessionTrust: vi.fn().mockResolvedValue(undefined),
  initializeContextManager: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./repl/agent-loop.js", () => ({
  executeAgentTurn: vi.fn().mockResolvedValue({
    content: "Here is my analysis of the code.",
    toolCalls: [
      { id: "t1", name: "read_file", input: {}, result: { success: true, output: "ok" } },
    ],
    usage: { inputTokens: 100, outputTokens: 50 },
    aborted: false,
  }),
}));

vi.mock("../providers/index.js", () => ({
  createProvider: vi.fn(() => ({
    id: "mock",
    name: "Mock",
    initialize: vi.fn().mockResolvedValue(undefined),
    chat: vi.fn(),
    chatWithTools: vi.fn(),
    stream: vi.fn(),
    streamWithTools: vi.fn(),
    countTokens: vi.fn(() => 10),
    getContextWindow: vi.fn(() => 100000),
    isAvailable: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock("../tools/index.js", () => ({
  createFullToolRegistry: vi.fn(() => ({
    getToolDefinitionsForLLM: vi.fn(() => []),
    execute: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    getAll: vi.fn(() => []),
    getByCategory: vi.fn(),
  })),
}));

vi.mock("../agents/provider-bridge.js", () => ({
  setAgentProvider: vi.fn(),
  setAgentToolRegistry: vi.fn(),
}));

vi.mock("../tools/allowed-paths.js", () => ({
  loadAllowedPaths: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/subprocess-registry.js", () => ({
  registerGlobalCleanup: vi.fn(),
}));

import { runHeadless } from "./headless.js";

describe("runHeadless", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return error when no task is provided and stdin is TTY", async () => {
    const result = await runHeadless({
      projectPath: "/test",
      outputFormat: "text",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No task provided");
  });

  it("should execute task and return result", async () => {
    const result = await runHeadless({
      task: "analyze this code",
      projectPath: "/test",
      outputFormat: "text",
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("Here is my analysis of the code.");
    expect(result.toolsExecuted).toBe(1);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });

  it("should handle errors gracefully", async () => {
    const { executeAgentTurn } = await import("./repl/agent-loop.js");
    vi.mocked(executeAgentTurn).mockRejectedValueOnce(new Error("Provider unavailable"));

    const result = await runHeadless({
      task: "do something",
      projectPath: "/test",
      outputFormat: "text",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Provider unavailable");
  });

  it("should skip confirmation in headless mode", async () => {
    const { executeAgentTurn } = await import("./repl/agent-loop.js");

    await runHeadless({
      task: "fix the bug",
      projectPath: "/test",
      outputFormat: "text",
    });

    expect(executeAgentTurn).toHaveBeenCalledWith(
      expect.anything(), // session
      "fix the bug", // task
      expect.anything(), // provider
      expect.anything(), // toolRegistry
      expect.objectContaining({ skipConfirmation: true }),
    );
  });

  it("can run direct tasks through the experimental runtime runner", async () => {
    const { createProvider } = await import("../providers/index.js");
    const { executeAgentTurn } = await import("./repl/agent-loop.js");
    vi.mocked(createProvider).mockResolvedValueOnce({
      id: "mock",
      name: "Mock",
      initialize: vi.fn().mockResolvedValue(undefined),
      chat: vi.fn(),
      chatWithTools: vi.fn().mockResolvedValue({
        id: "runtime-1",
        content: "Runtime runner response",
        stopReason: "end_turn",
        usage: { inputTokens: 11, outputTokens: 7 },
        model: "mock-model",
        toolCalls: [],
      }),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn(() => 10),
      getContextWindow: vi.fn(() => 100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    });

    const result = await runHeadless({
      task: "analyze this code",
      projectPath: "/test",
      outputFormat: "text",
      useRuntimeRunner: true,
    });

    expect(result).toMatchObject({
      success: true,
      output: "Runtime runner response",
      toolsExecuted: 0,
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    expect(executeAgentTurn).not.toHaveBeenCalled();
  });
});

describe("headless result contract", () => {
  let output: string;
  let diagnostics: string;
  beforeEach(() => {
    vi.clearAllMocks();
    output = "";
    diagnostics = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += chunk.toString();
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      diagnostics += chunk.toString();
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const options = { projectPath: "/test", outputFormat: "json" as const, task: "fix code" };
  it("prints exactly one JSON failure for a missing task", async () => {
    const result = await runHeadless({ ...options, task: "   " });
    expect(JSON.parse(output)).toEqual(result);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No task");
  });
  it("prints JSON for setup and stdin failures", async () => {
    const { createSession } = await import("./repl/session.js");
    vi.mocked(createSession).mockRejectedValueOnce(new Error("configuration unavailable"));
    const result = await runHeadless(options);
    expect(JSON.parse(output)).toEqual(result);
    expect(result.error).toBe("configuration unavailable");
  });
  it("routes incidental stdout diagnostics away from the JSON result", async () => {
    const { executeAgentTurn } = await import("./repl/agent-loop.js");
    vi.mocked(executeAgentTurn).mockImplementationOnce(async () => {
      console.log("tool diagnostic");
      process.stdout.write("\u001b[31mtool progress\u001b[0m");
      return {
        content: "done",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        aborted: false,
      };
    });
    const result = await runHeadless(options);
    expect(JSON.parse(output)).toEqual(result);
    expect(output).not.toContain("tool diagnostic");
    expect(diagnostics).toContain("tool progress");
  });
  it("closes the runtime after context setup fails", async () => {
    const { AgentRuntime } = await import("../runtime/index.js");
    const { initializeContextManager } = await import("./repl/session.js");
    const close = vi.spyOn(AgentRuntime.prototype, "close");
    vi.mocked(initializeContextManager).mockRejectedValueOnce(new Error("context failed"));
    const result = await runHeadless(options);
    expect(result.success).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(output)).toEqual(result);
  });
  it("handles host cancellation and restores signal listeners", async () => {
    const beforeInt = process.listenerCount("SIGINT");
    const beforeTerm = process.listenerCount("SIGTERM");
    const result = await runHeadless({ ...options, signal: AbortSignal.abort() });
    expect(result.success).toBe(false);
    expect(result.error).toContain("cancelled");
    expect(process.listenerCount("SIGINT")).toBe(beforeInt);
    expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
    expect(JSON.parse(output)).toEqual(result);
  });
});

describe("experimental headless incomplete runtime responses", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(["max_tokens", "tool_use", "budget"])(
    "returns one JSON failure and closes after %s",
    async (reason) => {
      const { createProvider } = await import("../providers/index.js");
      const { AgentRuntime } = await import("../runtime/index.js");
      const provider = await createProvider("ollama");
      const chat = vi.mocked(provider.chatWithTools).mockResolvedValue({
        id: "incomplete",
        content: "Let me run one more check",
        model: "fixture",
        stopReason: reason === "max_tokens" ? "max_tokens" : "tool_use",
        toolCalls: reason === "budget" ? [{ id: "pending", name: "missing_tool", input: {} }] : [],
        usage: { inputTokens: 1, outputTokens: 1 },
      });
      vi.mocked(createProvider).mockResolvedValueOnce(provider);
      const close = vi.spyOn(AgentRuntime.prototype, "close");
      let output = "";
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output += chunk.toString();
        return true;
      });
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = await runHeadless({
        task: "fix code",
        projectPath: "/test",
        outputFormat: "json",
        useRuntimeRunner: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Runtime turn incomplete");
      expect(JSON.parse(output)).toEqual(result);
      expect(chat).toHaveBeenCalledTimes(reason === "budget" ? 10 : 1);
      expect(close).toHaveBeenCalledOnce();
    },
  );
});
