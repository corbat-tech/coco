import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectDirectories: string[] = [];
function temporaryProject(): string {
  const projectPath = mkdtempSync(join(tmpdir(), "coco-headless-"));
  projectDirectories.push(projectPath);
  return projectPath;
}
afterEach(() => {
  for (const project of projectDirectories.splice(0))
    rmSync(project, { recursive: true, force: true });
});

vi.mock("./headless-stdin.js", () => ({ readHeadlessStdin: vi.fn(async () => "") }));

// Mock dependencies
vi.mock("./repl/session.js", () => ({
  createSession: vi.fn(() => ({
    id: "test-session",
    startedAt: new Date(),
    messages: [],
    projectPath: temporaryProject(),
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
      projectPath: temporaryProject(),
      outputFormat: "text",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No task provided");
  });

  it("should execute task and return result", async () => {
    const result = await runHeadless({
      task: "analyze this code",
      projectPath: temporaryProject(),
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
      projectPath: temporaryProject(),
      outputFormat: "text",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Provider unavailable");
  });

  it("should skip confirmation in headless mode", async () => {
    const { executeAgentTurn } = await import("./repl/agent-loop.js");

    await runHeadless({
      task: "fix the bug",
      projectPath: temporaryProject(),
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
      projectPath: temporaryProject(),
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
    options.projectPath = temporaryProject();
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
  const options = {
    projectPath: temporaryProject(),
    outputFormat: "json" as const,
    task: "fix code",
  };
  it("prints exactly one JSON failure for a missing task", async () => {
    const result = await runHeadless({ ...options, task: "   " });
    expect(JSON.parse(output)).toEqual(result);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No task");
  });
  it.each(["json", "text"] as const)(
    "reports a non-aborted legacy context failure in %s without printing a success",
    async (outputFormat) => {
      const { executeAgentTurn } = await import("./repl/agent-loop.js");
      vi.mocked(executeAgentTurn).mockResolvedValueOnce({
        content: "Partial answer before context recovery failed",
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 3 },
        aborted: false,
        error: "Context recovery did not reduce history",
      });
      const result = await runHeadless({ ...options, outputFormat });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Context recovery did not reduce history");
      expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 3 });
      if (outputFormat === "json") expect(JSON.parse(output)).toEqual(result);
      else {
        expect(output).toBe("");
        expect(diagnostics).toContain("Context recovery did not reduce history");
      }
    },
  );
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
        projectPath: temporaryProject(),
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

describe("project-local headless recovery", () => {
  afterEach(() => vi.restoreAllMocks());
  function quietOutput() {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  }
  async function providerResponses() {
    const { createProvider } = await import("../providers/index.js");
    const provider = await createProvider("ollama");
    const chat = vi.mocked(provider.chatWithTools);
    chat.mockReset().mockResolvedValue({
      id: "ok",
      model: "fixture",
      content: "Recovered",
      stopReason: "end_turn",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    vi.mocked(createProvider).mockResolvedValue(provider);
    return chat;
  }
  it("returns a session ID and reopens its real transcript for the next task", async () => {
    quietOutput();
    const chat = await providerResponses();
    const projectPath = temporaryProject();
    const first = await runHeadless({
      projectPath,
      outputFormat: "json",
      useRuntimeRunner: true,
      task: "Inspect the project",
    });
    expect(first.success).toBe(true);
    expect(first.sessionId).toMatch(/^rt_/);
    const second = await runHeadless({
      projectPath,
      outputFormat: "json",
      sessionId: first.sessionId,
      task: "Explain previous work",
    });
    expect(second.success).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(chat.mock.calls[1]?.[0]).toEqual([
      { role: "user", content: "Inspect the project" },
      { role: "assistant", content: "Recovered" },
      { role: "user", content: "Explain previous work" },
    ]);
  });
  it("explicitly continues an interrupted turn without duplicating the input", async () => {
    quietOutput();
    const chat = await providerResponses();
    chat.mockRejectedValueOnce(new Error("provider offline"));
    const projectPath = temporaryProject();
    const first = await runHeadless({
      projectPath,
      outputFormat: "json",
      useRuntimeRunner: true,
      task: "Inspect the project",
    });
    expect(first.success).toBe(false);
    expect(first.sessionId).toMatch(/^rt_/);
    const resumed = await runHeadless({ projectPath, outputFormat: "json", continueSession: true });
    expect(resumed.success).toBe(true);
    expect(resumed.sessionId).toBe(first.sessionId);
    expect(chat.mock.calls[1]?.[0]).toEqual([{ role: "user", content: "Inspect the project" }]);
  });
  it("rejects traversal, project mismatch and uncertain calls without invoking the provider", async () => {
    quietOutput();
    const chat = await providerResponses();
    const projectPath = temporaryProject();
    const traversal = await runHeadless({
      projectPath,
      outputFormat: "json",
      sessionId: "../../other",
      task: "Inspect",
    });
    expect(traversal.error).toContain("identifier");
    const { createFileRuntimeSessionStore } = await import("../runtime/index.js");
    const { SessionTurnTranscript } = await import("../runtime/turn-transcript.js");
    const store = createFileRuntimeSessionStore(
      join(projectPath, ".coco", "runtime-sessions.json"),
    );
    const other = store.create({ metadata: { projectPath: "/another-project" } });
    const mismatch = await runHeadless({
      projectPath,
      outputFormat: "json",
      sessionId: other.id,
      task: "Inspect",
    });
    expect(mismatch.error).toContain("another project");
    const session = store.create({ metadata: { projectPath: realpathSync(projectPath) } });
    const transcript = SessionTurnTranscript.begin(store, session, "Edit a file");
    transcript.appendToolBatch({
      role: "assistant",
      content: [{ type: "tool_use", id: "uncertain", name: "write_file", input: {} }],
    });
    transcript.startTool("uncertain");
    const unknown = await runHeadless({ projectPath, outputFormat: "json", sessionId: session.id });
    expect(unknown.error).toContain("Uncertain");
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("headless working directory ownership", () => {
  afterEach(() => vi.restoreAllMocks());
  it("runs relative tools in the requested project and restores the caller directory", async () => {
    const originalDirectory = process.cwd();
    const projectPath = temporaryProject();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { executeAgentTurn } = await import("./repl/agent-loop.js");
    vi.mocked(executeAgentTurn).mockImplementationOnce(async () => {
      expect(process.cwd()).toBe(realpathSync(projectPath));
      throw new Error("fixture execution failure");
    });
    const result = await runHeadless({
      projectPath,
      task: "Inspect relative files",
      outputFormat: "json",
    });
    expect(result.error).toBe("fixture execution failure");
    expect(process.cwd()).toBe(originalDirectory);
  });
});

describe("headless runtime respects existing exact call approvals", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    [
      "native write",
      "write_file",
      { path: "fixture.txt", content: "ok" },
      { path: "fixture.txt", content: "ok" },
      true,
    ],
    [
      "exact shell",
      "bash_exec",
      { command: "node --test", cwd: "/fixture", env: { MODE: "test" } },
      { command: "node --test", cwd: "/fixture", env: { MODE: "test" } },
      true,
    ],
    [
      "changed command",
      "bash_exec",
      { command: "node --test" },
      { command: "node --test other" },
      false,
    ],
    [
      "changed cwd",
      "bash_exec",
      { command: "node --test", cwd: "/fixture" },
      { command: "node --test", cwd: "/elsewhere" },
      false,
    ],
    [
      "changed env",
      "bash_exec",
      { command: "node --test", env: { MODE: "test" } },
      { command: "node --test", env: { MODE: "other" } },
      false,
    ],
  ] as const)(
    "honors %s without broadening authority",
    async (_label, toolName, approvedInput, requestedInput, allowed) => {
      const { z } = await import("zod");
      const { ToolRegistry } = await import("../tools/registry.js");
      const { createFullToolRegistry } = await import("../tools/index.js");
      const { createProvider } = await import("../providers/index.js");
      const { initializeSessionTrust } = await import("./repl/session.js");
      const { getTrustPattern } = await import("./repl/bash-patterns.js");
      const registry = new ToolRegistry();
      const effect = vi.fn(async () => "effect completed");
      registry.register({
        name: toolName,
        description: "Trusted fixture",
        category: toolName === "write_file" ? "file" : "bash",
        parameters: z.record(z.string(), z.unknown()),
        execute: effect,
      });
      vi.mocked(createFullToolRegistry).mockReturnValueOnce(registry);
      vi.mocked(initializeSessionTrust).mockImplementationOnce(async (session) => {
        session.trustedTools.add(getTrustPattern(toolName, approvedInput));
      });
      const provider = await createProvider("ollama");
      const chat = vi
        .mocked(provider.chatWithTools)
        .mockReset()
        .mockResolvedValueOnce({
          id: "call",
          model: "fixture",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "tool-1", name: toolName, input: requestedInput }],
          usage: { inputTokens: 1, outputTokens: 1 },
        })
        .mockResolvedValue({
          id: "done",
          model: "fixture",
          content: "Done",
          stopReason: "end_turn",
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        });
      vi.mocked(createProvider).mockResolvedValueOnce(provider);
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = await runHeadless({
        projectPath: temporaryProject(),
        task: "Apply the fixture change",
        outputFormat: "json",
        useRuntimeRunner: true,
      });
      expect(result.success).toBe(true);
      expect(effect).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(JSON.stringify(chat.mock.calls[1]?.[0])).toContain(
        allowed ? "effect completed" : '"is_error":true',
      );
    },
  );
});
