import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { executeAgentTurn } from "./agent-loop.js";
import { agentsCommand } from "./commands/agents.js";
import { confirmToolExecutionWithFallback } from "./confirmation.js";
import {
  createSessionAgentRunner,
  delegationAllowedForTurn,
  getSessionAgentManager,
} from "./delegation.js";
import { SessionStore } from "./sessions/storage.js";
import { ToolRegistry } from "../../tools/registry.js";
import { spawnSimpleAgentTool } from "../../tools/simple-agent.js";
import type { ChatWithToolsResponse, LLMProvider, StreamChunk } from "../../providers/types.js";
import type { ReplSession } from "./types.js";

vi.mock("./output/renderer.js", () => ({ resetLineBuffer: vi.fn(), flushLineBuffer: vi.fn() }));
vi.mock("./confirmation.js", () => ({ confirmToolExecutionWithFallback: vi.fn(async () => "no") }));

const terminal: ChatWithToolsResponse = {
  id: "fixture",
  content: "Observed fixture file",
  stopReason: "end_turn",
  toolCalls: [],
  usage: { inputTokens: 3, outputTokens: 2 },
  model: "fixture",
};
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function fixture(): {
  session: ReplSession;
  provider: LLMProvider;
  chat: ReturnType<typeof vi.fn<LLMProvider["chatWithTools"]>>;
  registry: ToolRegistry;
  read: ReturnType<typeof vi.fn>;
} {
  const chat = vi
    .fn<LLMProvider["chatWithTools"]>()
    .mockResolvedValueOnce({
      ...terminal,
      stopReason: "tool_use",
      content: "",
      toolCalls: [{ id: "read", name: "read_file", input: { path: "fixture.txt" } }],
    })
    .mockResolvedValue(terminal);
  const provider = {
    id: "fixture",
    name: "fixture",
    chatWithTools: chat,
    streamWithTools: async function* (): AsyncIterable<StreamChunk> {
      yield { type: "text", text: "Direct answer" };
      yield { type: "done", stopReason: "end_turn" };
    },
    countTokens: (text: string) => Math.ceil(text.length / 4),
    getContextWindow: () => 200000,
  } as unknown as LLMProvider;
  const registry = new ToolRegistry();
  const read = vi.fn(async () => "observed fixture");
  registry.register({
    name: "read_file",
    description: "Read fixture",
    category: "file",
    parameters: z.object({ path: z.string() }),
    execute: read,
  });
  registry.register(spawnSimpleAgentTool);
  const session: ReplSession = {
    id: "fixture-session",
    startedAt: new Date(),
    projectPath: "/tmp/fixture",
    messages: [],
    trustedTools: new Set(),
    config: {
      provider: { type: "anthropic", model: "selected-model", maxTokens: 512, thinking: "high" },
      ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100, showDiff: "on_request" },
      agent: { systemPrompt: "Fixture host", maxToolIterations: 10, confirmDestructive: true },
    },
  };
  return { session, provider, chat, registry, read };
}

describe("session-owned explicit specialists", () => {
  it("executes a queued command through the actual worker and parent tool boundary", async () => {
    const f = fixture();
    await agentsCommand.execute(["run", "researcher", "Read the fixture file"], f.session);
    expect(f.session.messages).toHaveLength(0);
    const result = await executeAgentTurn(
      f.session,
      f.session.pendingDelegation!.task,
      f.provider,
      f.registry,
    );
    expect(result.error).toBeUndefined();
    expect(result.content).toBe(terminal.content);
    expect(f.chat).toHaveBeenCalledTimes(2);
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.session.pendingDelegation).toBeUndefined();
    expect(f.session.delegationHistory?.[0]?.status).toBe("completed");
    expect(f.session.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(f.chat.mock.calls[0]?.[1]).toMatchObject({
      model: "selected-model",
      thinking: "high",
      maxTokens: 512,
    });
  });

  it("routes natural explicit mention without a classification request", async () => {
    const f = fixture();
    await executeAgentTurn(f.session, "@researcher Read fixture.txt", f.provider, f.registry);
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.chat).toHaveBeenCalledTimes(2);
  });

  it("blocks a writing specialist in plan mode before any worker request", async () => {
    const f = fixture();
    f.session.planMode = true;
    f.session.pendingDelegation = { type: "docs", task: "Write a README" };
    const result = await executeAgentTurn(f.session, "Write a README", f.provider, f.registry);
    expect(result.error).toMatch(/read-only/i);
    expect(f.chat).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });

  it("requires exact host consent before a specialist can mutate a file", async () => {
    const f = fixture();
    const write = vi.fn(async () => "written fixture");
    f.registry.register({
      name: "write_file",
      description: "Write fixture",
      category: "file",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: write,
    });
    f.chat
      .mockReset()
      .mockResolvedValueOnce({
        ...terminal,
        content: "",
        stopReason: "tool_use",
        toolCalls: [
          { id: "write", name: "write_file", input: { path: "README.md", content: "fixture" } },
        ],
      })
      .mockResolvedValue(terminal);
    vi.mocked(confirmToolExecutionWithFallback).mockResolvedValueOnce("yes");
    await executeAgentTurn(f.session, "@docs Write README.md", f.provider, f.registry);
    expect(write).toHaveBeenCalledWith(
      { path: "README.md", content: "fixture" },
      expect.anything(),
    );
    expect(confirmToolExecutionWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "write_file",
        input: { path: "README.md", content: "fixture" },
      }),
    );
  });

  it("skipping interactive confirmation never grants child write consent", async () => {
    const f = fixture();
    const write = vi.fn(async () => "written fixture");
    f.registry.register({
      name: "write_file",
      description: "Write fixture",
      category: "file",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: write,
    });
    f.chat
      .mockReset()
      .mockResolvedValueOnce({
        ...terminal,
        content: "",
        stopReason: "tool_use",
        toolCalls: [
          { id: "write", name: "write_file", input: { path: "README.md", content: "fixture" } },
        ],
      })
      .mockResolvedValue(terminal);
    await executeAgentTurn(f.session, "@docs Write README.md", f.provider, f.registry, {
      skipConfirmation: true,
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("manual mode stays direct without an explicit request and off overrides a mention", () => {
    const { session } = fixture();
    expect(delegationAllowedForTurn(session, "Correct this typo")).toBe(false);
    expect(delegationAllowedForTurn(session, "Use an agent to review the diff")).toBe(true);
    expect(delegationAllowedForTurn(session, "Hazlo sin agentes")).toBe(false);
    session.config.agent.delegation = { mode: "off" };
    expect(delegationAllowedForTurn(session, "@review Inspect diff")).toBe(false);
  });

  it("never admits an unknown mention, even in automatic mode", async () => {
    const f = fixture();
    f.session.config.agent.delegation = { mode: "auto" };
    expect(delegationAllowedForTurn(f.session, "@nonexistent Investigate")).toBe(false);
    const run = createSessionAgentRunner(
      f.session,
      f.provider,
      f.registry,
      undefined,
      "@nonexistent Investigate",
    );
    await expect(
      run({ type: "explore", task: "Fallback", maxTurns: 1, validatedPlan: true }, {}),
    ).rejects.toThrow(/unknown/);
    expect(f.chat).not.toHaveBeenCalled();
  });

  it("immediately closes admission when the user cancels all workers", async () => {
    const f = fixture();
    const run = createSessionAgentRunner(f.session, f.provider, f.registry);
    await agentsCommand.execute(["cancel", "all"], f.session);
    await expect(run({ type: "explore", task: "Late worker", maxTurns: 1 }, {})).rejects.toThrow(
      /stopped worker admission/,
    );
    expect(f.chat).not.toHaveBeenCalled();
  });

  it("passes bounded prior user requirements with provenance, excluding tool output", async () => {
    const f = fixture();
    f.session.messages = [
      { role: "user", content: "Preserve the public API" },
      { role: "assistant", content: "Tool output must not become a user instruction" },
    ];
    await executeAgentTurn(f.session, "@review Inspect the diff", f.provider, f.registry);
    const system = f.chat.mock.calls[0]?.[1].system;
    expect(system).toContain("Preserve the public API");
    expect(system).toContain("conversation.user.0");
    expect(system).not.toContain("Tool output must not become a user instruction");
  });

  it("never shares worker ownership between sessions using the same provider", () => {
    const f = fixture();
    const other = { ...f.session, id: "other" };
    createSessionAgentRunner(f.session, f.provider, f.registry);
    createSessionAgentRunner(other, f.provider, f.registry);
    expect(getSessionAgentManager(other)).not.toBe(getSessionAgentManager(f.session));
  });

  it("shares the turn budget across workers instead of granting it to each one", async () => {
    const f = fixture();
    f.session.config.agent.maxToolIterations = 1;
    f.chat.mockReset().mockResolvedValue(terminal);
    const run = createSessionAgentRunner(f.session, f.provider, f.registry);
    expect((await run({ type: "review", task: "Review A", maxTurns: 1 }, {})).success).toBe(true);
    expect((await run({ type: "review", task: "Review B", maxTurns: 1 }, {})).success).toBe(false);
    expect(f.chat).toHaveBeenCalledOnce();
    expect(run.budget.snapshot().turns).toBe(1);
  });

  it("auto admits only a validated plan when the user did not explicitly request workers", async () => {
    const f = fixture();
    f.session.config.agent.delegation = { mode: "auto" };
    f.chat.mockReset().mockResolvedValue(terminal);
    const run = createSessionAgentRunner(
      f.session,
      f.provider,
      f.registry,
      undefined,
      "Implement the feature",
    );
    await expect(
      run({ type: "explore", task: "Unvalidated split", maxTurns: 1 }, {}),
    ).rejects.toThrow(/host-validated/);
    expect(f.chat).not.toHaveBeenCalled();
    expect(
      (
        await run(
          { type: "explore", task: "Validated split", maxTurns: 1, validatedPlan: true },
          {},
        )
      ).success,
    ).toBe(true);
    expect(run.projectRoot).toBe(f.session.projectPath);
  });

  it("does not admit another request after a provider fails with unknown usage", async () => {
    const f = fixture();
    f.chat.mockReset().mockRejectedValue(new Error("Backend disconnected"));
    const run = createSessionAgentRunner(f.session, f.provider, f.registry);
    expect((await run({ type: "review", task: "Review A", maxTurns: 2 }, {})).success).toBe(false);
    expect((await run({ type: "review", task: "Review B", maxTurns: 2 }, {})).success).toBe(false);
    expect(f.chat).toHaveBeenCalledOnce();
    expect(run.budget.snapshot().unknownRequests).toBe(1);
  });

  it("refuses conflicting raw workers while mutation ownership is active", async () => {
    const f = fixture();
    let complete!: (response: ChatWithToolsResponse) => void;
    f.chat.mockReset().mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const run = createSessionAgentRunner(f.session, f.provider, f.registry);
    const pending = run({ type: "docs", task: "Write docs", maxTurns: 1 }, {});
    await expect(
      run({ type: "explore", task: "Read changed docs", maxTurns: 1 }, {}),
    ).rejects.toThrow(/resources conflict/);
    complete(terminal);
    await pending;
    expect(f.chat).toHaveBeenCalledOnce();
  });

  it("allows independent read-only workers to overlap within the session ceiling", async () => {
    const f = fixture();
    const complete: Array<(response: ChatWithToolsResponse) => void> = [];
    f.chat.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          complete.push(resolve);
        }),
    );
    const run = createSessionAgentRunner(f.session, f.provider, f.registry);
    const first = run({ type: "explore", task: "Read A", maxTurns: 1 }, {});
    const second = run({ type: "review", task: "Review B", maxTurns: 1 }, {});
    await Promise.resolve();
    expect(getSessionAgentManager(f.session)?.getActiveCount()).toBe(2);
    complete.forEach((resolve) => resolve(terminal));
    expect((await Promise.all([first, second])).every((result) => result.success)).toBe(true);
  });

  it("persists the preference and history, projecting abandoned live work as interrupted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coco-worker-snapshot-"));
    temporary.push(directory);
    const store = new SessionStore({ storageDir: directory });
    const { session } = fixture();
    session.config.agent.delegation = { mode: "manual" };
    session.delegationHistory = [
      {
        id: "pending",
        type: "explore",
        task: "Inspect",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    ];
    await store.save(session);
    const restored = await store.load(session.id);
    expect(restored?.config.agent.delegation?.mode).toBe("manual");
    expect(restored?.delegationHistory?.[0]?.status).toBe("interrupted");
    expect(getSessionAgentManager(restored!)).toBeUndefined();
  });
});
