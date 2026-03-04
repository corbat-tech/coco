import { describe, it, expect, vi, beforeEach } from "vitest";

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
    toolCalls: [{ id: "t1", name: "read_file", input: {}, result: { success: true, output: "ok" } }],
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
    getAll: vi.fn(),
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
      "fix the bug",     // task
      expect.anything(), // provider
      expect.anything(), // toolRegistry
      expect.objectContaining({ skipConfirmation: true }),
    );
  });
});
