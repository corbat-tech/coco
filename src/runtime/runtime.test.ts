import { describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { LLMProvider } from "../providers/types.js";
import { defineTool, ToolRegistry } from "../tools/registry.js";
import { createAgentRuntime } from "./agent-runtime.js";
import { createEventLog, createFileEventLog } from "./event-log.js";
import { createMcpToolPolicy } from "./extension-manifests.js";
import { createRuntimeHttpServer } from "./http-server.js";
import { createPermissionPolicy } from "./permission-policy.js";
import { RuntimePolicyViolation } from "./context.js";
import {
  createPostgresEventLog,
  createPostgresRuntimeSessionQueries,
  createPostgresRuntimeSessionStore,
  listPostgresRuntimeEvents,
  type PostgresQueryClient,
} from "./postgres.js";
import { createProviderRegistry } from "./provider-registry.js";
import { createFileRuntimeSessionStore } from "./runtime-session-store.js";
import { createToolCallingRuntimeTurnRunner } from "./tool-calling-turn-runner.js";
import { createWorkflowEngine } from "./workflow-engine.js";
import { createWorkflowCatalog } from "./workflow-registry.js";
import type { RuntimeSession, RuntimeSessionCreateOptions, RuntimeSessionStore } from "./types.js";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as T;
}

async function withRuntimeHttpServer<T>(
  callback: (baseUrl: string) => Promise<T>,
  options: { maxBodyBytes?: number } = {},
): Promise<T> {
  const runtime = await createAgentRuntime({
    providerType: "openai",
    model: "gpt-5.4",
    provider: createMockProvider(),
    toolRegistry: createRegistry(),
  });
  const server = createRuntimeHttpServer(runtime, options);
  server.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP server address");
    }
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function createMockProvider(): LLMProvider {
  return {
    id: "mock",
    name: "Mock",
    initialize: vi.fn(),
    chat: vi.fn(async () => ({
      id: "chat-1",
      content: "runtime reply",
      stopReason: "end_turn",
      usage: { inputTokens: 2, outputTokens: 3 },
      model: "mock-model",
    })),
    chatWithTools: vi.fn(),
    stream: vi.fn(async function* () {
      yield { type: "text", text: "stream " };
      yield { type: "text", text: "reply" };
      yield { type: "done", stopReason: "end_turn" };
    }),
    streamWithTools: vi.fn(),
    countTokens: vi.fn((text: string) => text.length),
    getContextWindow: vi.fn(() => 128000),
    isAvailable: vi.fn(async () => true),
  } as unknown as LLMProvider;
}

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: "read_file",
      description: "Read a file",
      category: "file",
      parameters: z.object({ path: z.string().optional() }),
      execute: async ({ path }) => ({ content: `read:${path ?? "default"}` }),
    }),
  );
  registry.register(
    defineTool({
      name: "write_file",
      description: "Write a file",
      category: "file",
      parameters: z.object({ path: z.string().optional(), content: z.string().optional() }),
      execute: async ({ path }) => ({ written: path ?? "default" }),
    }),
  );
  registry.register(
    defineTool({
      name: "authorize_path",
      description: "Authorize a filesystem path",
      category: "config",
      parameters: z.object({}),
      execute: async () => "ok",
    }),
  );
  registry.register(
    defineTool({
      name: "run_linter",
      description: "Run linter, optionally with fixes",
      category: "quality",
      parameters: z.object({ fix: z.boolean().optional() }),
      execute: async ({ fix }) => ({ fixed: fix === true }),
    }),
  );
  return registry;
}

function createMutableRuntimeSessionStore(sessions: RuntimeSession[] = []): RuntimeSessionStore {
  const byId = new Map(sessions.map((session) => [session.id, structuredClone(session)]));
  return {
    create(options: RuntimeSessionCreateOptions = {}) {
      const now = new Date().toISOString();
      const session: RuntimeSession = {
        id: options.id ?? `rt_${byId.size + 1}`,
        createdAt: now,
        updatedAt: now,
        mode: options.mode ?? "ask",
        messages: options.messages ?? [],
        instructions: options.instructions,
        metadata: { ...options.metadata },
      };
      byId.set(session.id, structuredClone(session));
      return structuredClone(session);
    },
    get(id) {
      const session = byId.get(id);
      return session ? structuredClone(session) : undefined;
    },
    update(session) {
      byId.set(session.id, structuredClone(session));
      return structuredClone(session);
    },
    list() {
      return [...byId.values()].map((session) => structuredClone(session));
    },
    delete(id) {
      return byId.delete(id);
    },
  };
}

describe("reusable agent runtime", () => {
  it("exposes provider catalog capabilities through the provider registry", () => {
    const registry = createProviderRegistry();
    const cap = registry.getCapability("openai", "gpt-5.4");

    expect(registry.getDefaultModel("openai")).toBeTruthy();
    expect(cap.endpoint).toBe("openai-responses");
    expect(cap.supportsReasoning).toBe(true);
    expect(registry.listModels("openai").some((model) => model.id === "gpt-5.4")).toBe(true);
  });

  it("records runtime initialization and exposes a reusable snapshot", async () => {
    const eventLog = createEventLog();
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
      eventLog,
    });

    const snapshot = runtime.snapshot();

    expect(snapshot.provider.capability.endpoint).toBe("openai-responses");
    expect(snapshot.tools.names).toEqual([
      "authorize_path",
      "read_file",
      "run_linter",
      "write_file",
    ]);
    expect(snapshot.modes.map((mode) => mode.id)).toContain("architect");
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "provider.attached",
      "runtime.initialized",
    ]);
  });

  it("starts embeddable runtimes with no tools unless a registry is injected", async () => {
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
    });

    expect(runtime.snapshot().tools).toEqual({ count: 0, names: [] });
  });

  it("propagates runtime tenant context into snapshots, sessions, and events", async () => {
    const eventLog = createEventLog();
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      eventLog,
      runtimeContext: {
        surface: "whatsapp",
        tenant: { id: "acme", name: "Acme" },
        user: { id: "user-1", roles: ["support"] },
        correlationId: "corr-1",
        policy: { dataBoundary: { classification: "confidential" } },
      },
      runtimePolicy: { costBudget: { maxTurns: 4 } },
    });

    const session = runtime.createSession({ metadata: { conversationId: "wa-1" } });

    expect(runtime.snapshot()).toMatchObject({
      hostMode: "local",
      context: { surface: "whatsapp", tenant: { id: "acme" } },
      policy: {
        dataBoundary: { classification: "confidential" },
        costBudget: { maxTurns: 4 },
      },
    });
    expect(session.metadata).toMatchObject({
      surface: "whatsapp",
      tenantId: "acme",
      tenantName: "Acme",
      userId: "user-1",
      userRoles: ["support"],
      correlationId: "corr-1",
      conversationId: "wa-1",
    });
    expect(eventLog.list().find((event) => event.type === "session.created")?.data).toMatchObject({
      tenantId: "acme",
      surface: "whatsapp",
      correlationId: "corr-1",
    });
  });

  it("requires tenant context for hosted product surfaces while allowing local CLI", async () => {
    await expect(
      createAgentRuntime({
        providerType: "openai",
        model: "gpt-5.4",
        provider: createMockProvider(),
        runtimeHostMode: "hosted",
        runtimeContext: { surface: "web" },
      }),
    ).rejects.toThrow(RuntimePolicyViolation);

    const hosted = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      runtimeHostMode: "hosted",
      runtimeContext: { surface: "api", tenant: { id: "tenant-a" } },
    });
    const localCli = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      runtimeHostMode: "hosted",
      runtimeContext: { surface: "cli" },
    });

    expect(hosted.createSession().metadata).toMatchObject({ tenantId: "tenant-a" });
    expect(localCli.createSession().mode).toBe("ask");
    expect(hosted.snapshot().hostMode).toBe("hosted");
  });

  it("does not publish to the global bridge by default", async () => {
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
    });

    expect(runtime.snapshot().provider.model).toBe("gpt-5.4");
  });

  it("enforces read-only mode permissions without blocking build mode writes", async () => {
    const runtime = await createAgentRuntime({
      providerType: "anthropic",
      model: "claude-sonnet-4-6",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
    });

    expect(runtime.assertToolAllowed("plan", "read_file")).toBe(true);
    expect(runtime.assertToolAllowed("plan", "write_file")).toBe(false);
    expect(runtime.assertToolAllowed("plan", "authorize_path")).toBe(false);
    expect(runtime.assertToolAllowed("plan", "run_linter")).toBe(false);
    expect(runtime.assertToolAllowed("plan", "run_linter", { fix: false })).toBe(true);
    expect(runtime.assertToolAllowed("plan", "run_linter", { fix: true })).toBe(false);
    expect(runtime.assertToolAllowed("build", "write_file")).toBe(true);
    expect(runtime.assertToolAllowed("build", "run_linter")).toBe(true);
    expect(runtime.assertToolAllowed("build", "run_linter", { fix: true })).toBe(true);
  });

  it("runs chat turns through runtime sessions without the CLI REPL", async () => {
    const eventLog = createEventLog();
    const provider = createMockProvider();
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider,
      toolRegistry: createRegistry(),
      eventLog,
    });

    const session = runtime.createSession({
      mode: "ask",
      instructions: "Answer as a support assistant.",
      metadata: { surface: "web" },
    });
    const result = await runtime.runTurn({
      sessionId: session.id,
      content: "hello",
    });
    const updated = runtime.getSession(session.id);

    expect(result).toMatchObject({
      sessionId: session.id,
      content: "runtime reply",
      model: "mock-model",
      mode: "ask",
    });
    expect(updated?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(provider.chat).toHaveBeenCalledWith(
      [{ role: "user", content: "hello" }],
      expect.objectContaining({ system: "Answer as a support assistant." }),
    );
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "provider.attached",
      "runtime.initialized",
      "session.created",
      "turn.started",
      "session.updated",
      "turn.completed",
    ]);
    expect(eventLog.list().find((event) => event.type === "session.created")?.data).toEqual({
      sessionId: session.id,
      mode: "ask",
      surface: "web",
      metadataKeys: ["surface"],
    });
  });

  it("defaults runtime-created sessions to ask mode", async () => {
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
    });

    const direct = runtime.createSession();
    const turn = await runtime.runTurn({ content: "hello" });

    expect(direct.mode).toBe("ask");
    expect(turn.mode).toBe("ask");
    expect(runtime.getSession(turn.sessionId)?.mode).toBe("ask");
  });

  it("enforces runtime turn, cost, rate, and concurrency budgets", async () => {
    const maxTurnsRuntime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      runtimePolicy: { costBudget: { maxTurns: 1 } },
    });
    const maxTurnsSession = maxTurnsRuntime.createSession();
    await maxTurnsRuntime.runTurn({ sessionId: maxTurnsSession.id, content: "one" });
    await expect(
      maxTurnsRuntime.runTurn({ sessionId: maxTurnsSession.id, content: "two" }),
    ).rejects.toMatchObject({ code: "max_turns_exceeded" });

    const maxCostRuntime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      runtimePolicy: { costBudget: { maxEstimatedCostUsd: 0 } },
    });
    const maxCostSession = maxCostRuntime.createSession();
    await expect(
      maxCostRuntime.runTurn({ sessionId: maxCostSession.id, content: "hello" }),
    ).rejects.toMatchObject({ code: "estimated_cost_exceeded" });
    expect(maxCostRuntime.getSession(maxCostSession.id)?.messages).toEqual([]);

    const rateLimitedRuntime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      runtimePolicy: { rateLimit: { maxRequestsPerMinute: 1 } },
    });
    const rateSession = rateLimitedRuntime.createSession();
    await rateLimitedRuntime.runTurn({ sessionId: rateSession.id, content: "one" });
    await expect(
      rateLimitedRuntime.runTurn({ sessionId: rateSession.id, content: "two" }),
    ).rejects.toMatchObject({ code: "rate_limit_exceeded" });

    let resolveChat: ((value: Awaited<ReturnType<LLMProvider["chat"]>>) => void) | undefined;
    const slowProvider = createMockProvider();
    slowProvider.chat = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveChat = resolve;
        }),
    ) as LLMProvider["chat"];
    const concurrencyRuntime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: slowProvider,
      runtimePolicy: { rateLimit: { maxConcurrentRuns: 1 } },
    });
    const concurrencySession = concurrencyRuntime.createSession();
    const firstRun = concurrencyRuntime.runTurn({
      sessionId: concurrencySession.id,
      content: "one",
    });
    await vi.waitFor(() => expect(slowProvider.chat).toHaveBeenCalledTimes(1));
    await expect(
      concurrencyRuntime.runTurn({ sessionId: concurrencySession.id, content: "two" }),
    ).rejects.toMatchObject({ code: "concurrency_limit_exceeded" });
    resolveChat?.({
      id: "chat-slow",
      content: "done",
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "mock-model",
    });
    await expect(firstRun).resolves.toMatchObject({ content: "done" });
  });

  it("plans and applies runtime retention cleanup by tenant-aware policy", async () => {
    const eventLog = createEventLog();
    const store = createMutableRuntimeSessionStore([
      {
        id: "rt_old",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        mode: "ask",
        messages: [],
        metadata: {},
      },
      {
        id: "rt_new",
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
        mode: "ask",
        messages: [],
        metadata: {},
      },
    ]);
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      runtimeSessionStore: store,
      eventLog,
      runtimePolicy: { retention: { conversationDays: 30 } },
    });

    const dryRun = runtime.cleanupRetention({
      dryRun: true,
      now: new Date("2026-06-20T12:00:00.000Z"),
    });
    const applied = runtime.cleanupRetention({
      dryRun: false,
      now: new Date("2026-06-20T12:00:00.000Z"),
    });

    expect(dryRun).toMatchObject({
      dryRun: true,
      expiredSessionIds: ["rt_old"],
      deletedSessionIds: [],
      cutoffs: { conversationBefore: "2026-05-21T12:00:00.000Z" },
    });
    expect(applied).toMatchObject({
      dryRun: false,
      expiredSessionIds: ["rt_old"],
      deletedSessionIds: ["rt_old"],
    });
    expect(runtime.listSessions().map((session) => session.id)).toEqual(["rt_new"]);
    expect(eventLog.list().filter((event) => event.type === "retention.cleanup")).toHaveLength(2);
  });

  it("runs tool-calling turns through runtime permissions and tool execution", async () => {
    const provider = createMockProvider();
    provider.chatWithTools = vi
      .fn()
      .mockResolvedValueOnce({
        id: "chat-tools-1",
        content: "I will read the file.",
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
        model: "mock-model",
        toolCalls: [
          {
            id: "tool-1",
            name: "read_file",
            input: { path: "README.md" },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "chat-tools-2",
        content: "The file says read:README.md",
        stopReason: "end_turn",
        usage: { inputTokens: 12, outputTokens: 7 },
        model: "mock-model",
        toolCalls: [],
      });
    const eventLog = createEventLog();
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider,
      toolRegistry: createRegistry(),
      eventLog,
      turnRunner: createToolCallingRuntimeTurnRunner(),
    });
    const session = runtime.createSession({ mode: "ask" });

    const result = await runtime.runTurn({
      sessionId: session.id,
      content: "Read README.md",
    });

    expect(result).toMatchObject({
      content: "The file says read:README.md",
      usage: { inputTokens: 22, outputTokens: 12 },
    });
    expect(provider.chatWithTools).toHaveBeenCalledTimes(2);
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "provider.attached",
      "runtime.initialized",
      "session.created",
      "turn.started",
      "tool.started",
      "tool.completed",
      "session.updated",
      "turn.completed",
    ]);
  });

  it("does not auto-confirm destructive tools in tool-calling runtime turns", async () => {
    const provider = createMockProvider();
    provider.chatWithTools = vi
      .fn()
      .mockResolvedValueOnce({
        id: "chat-tools-1",
        content: "I will write the file.",
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
        model: "mock-model",
        toolCalls: [
          {
            id: "tool-1",
            name: "write_file",
            input: { path: "README.md", content: "x" },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "chat-tools-2",
        content: "The write was blocked because it requires confirmation.",
        stopReason: "end_turn",
        usage: { inputTokens: 12, outputTokens: 7 },
        model: "mock-model",
        toolCalls: [],
      });
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider,
      toolRegistry: createRegistry(),
      turnRunner: createToolCallingRuntimeTurnRunner(),
    });
    const session = runtime.createSession({ mode: "build" });

    const result = await runtime.runTurn({
      sessionId: session.id,
      content: "Write README.md",
    });

    expect(result.content).toContain("blocked");
    expect(runtime.eventLog.list().map((event) => event.type)).toContain("tool.blocked");
  });

  it("defaults file-backed runtime sessions to ask mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coco-runtime-sessions-"));
    const store = createFileRuntimeSessionStore(join(dir, "sessions.json"));

    expect(store.create().mode).toBe("ask");
  });

  it("streams runtime turns and persists the completed assistant message", async () => {
    const eventLog = createEventLog();
    const provider = createMockProvider();
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider,
      toolRegistry: createRegistry(),
      eventLog,
    });
    const session = runtime.createSession({
      mode: "ask",
      instructions: "Stream as support assistant.",
    });

    const events = [];
    for await (const event of runtime.streamTurn({
      sessionId: session.id,
      content: "hello",
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text", sessionId: session.id, text: "stream " },
      { type: "text", sessionId: session.id, text: "reply" },
      {
        type: "done",
        sessionId: session.id,
        result: {
          sessionId: session.id,
          content: "stream reply",
          usage: { inputTokens: 5, outputTokens: 12, estimated: true },
          model: "gpt-5.4",
          mode: "ask",
        },
      },
    ]);
    expect(runtime.getSession(session.id)?.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "stream reply" },
    ]);
    expect(provider.stream).toHaveBeenCalledWith(
      [{ role: "user", content: "hello" }],
      expect.objectContaining({ system: "Stream as support assistant." }),
    );
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "provider.attached",
      "runtime.initialized",
      "session.created",
      "turn.started",
      "session.updated",
      "turn.completed",
    ]);
  });

  it("records cancelled streaming turns when consumers stop early", async () => {
    const eventLog = createEventLog();
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
      eventLog,
    });
    const session = runtime.createSession({ mode: "ask" });

    for await (const event of runtime.streamTurn({
      sessionId: session.id,
      content: "hello",
    })) {
      expect(event).toEqual({ type: "text", sessionId: session.id, text: "stream " });
      break;
    }

    expect(runtime.getSession(session.id)?.messages).toEqual([]);
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "provider.attached",
      "runtime.initialized",
      "session.created",
      "turn.started",
      "turn.cancelled",
    ]);
  });

  it("does not persist streaming output when runtime token policy is exceeded", async () => {
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
      runtimePolicy: { costBudget: { maxOutputTokens: 1 } },
    });
    const session = runtime.createSession({ mode: "ask" });

    const events = [];
    for await (const event of runtime.streamTurn({
      sessionId: session.id,
      content: "hello",
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "error",
      sessionId: session.id,
      error: "Runtime policy output token budget exceeded: 12/1",
    });
    expect(runtime.getSession(session.id)?.messages).toEqual([]);
  });

  it("executes runtime tools with permission events and confirmation gates", async () => {
    const eventLog = createEventLog();
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
      eventLog,
    });
    const session = runtime.createSession({ mode: "build" });

    const read = await runtime.executeTool({
      sessionId: session.id,
      toolName: "read_file",
      input: { path: "README.md" },
    });
    const blockedWrite = await runtime.executeTool({
      sessionId: session.id,
      toolName: "write_file",
      input: { path: "README.md", content: "x" },
    });
    const confirmedWrite = await runtime.executeTool({
      sessionId: session.id,
      toolName: "write_file",
      input: { path: "README.md", content: "x" },
      confirmed: true,
    });
    const blockedPlanFix = await runtime.executeTool({
      mode: "plan",
      toolName: "run_linter",
      input: { fix: true },
      confirmed: true,
    });
    const missingSession = await runtime.executeTool({
      sessionId: "rt_missing",
      toolName: "read_file",
      input: { path: "README.md" },
    });
    const defaultReadOnlyWrite = await runtime.executeTool({
      toolName: "write_file",
      input: { path: "README.md", content: "x" },
      confirmed: true,
    });

    expect(read).toMatchObject({
      toolName: "read_file",
      success: true,
      output: { content: "read:README.md" },
    });
    expect(blockedWrite).toMatchObject({
      toolName: "write_file",
      success: false,
      error: "write_file can change repository state and should be confirmed.",
    });
    expect(confirmedWrite).toMatchObject({
      toolName: "write_file",
      success: true,
      output: { written: "README.md" },
    });
    expect(blockedPlanFix).toMatchObject({
      toolName: "run_linter",
      success: false,
    });
    expect(missingSession).toMatchObject({
      toolName: "read_file",
      success: false,
      error: "Runtime session not found: rt_missing",
    });
    expect(defaultReadOnlyWrite).toMatchObject({
      toolName: "write_file",
      success: false,
      error: "Ask mode is read-only; write_file is a file tool.",
    });
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "provider.attached",
      "runtime.initialized",
      "session.created",
      "tool.started",
      "tool.completed",
      "tool.blocked",
      "tool.started",
      "tool.completed",
      "tool.blocked",
      "tool.blocked",
      "tool.blocked",
    ]);
  });

  it("enforces runtime policy allowlists during tool execution", async () => {
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
      runtimePolicy: { allowedTools: ["read_file"] },
    });

    const read = await runtime.executeTool({
      toolName: "read_file",
      input: { path: "README.md" },
    });
    const write = await runtime.executeTool({
      mode: "build",
      toolName: "write_file",
      input: { path: "README.md", content: "x" },
      confirmed: true,
    });

    expect(read.success).toBe(true);
    expect(write).toMatchObject({
      success: false,
      error: "Runtime policy does not allow tool: write_file",
      decision: { allowed: false, risk: "destructive" },
    });
    expect(runtime.assertToolAllowed("build", "write_file", { path: "README.md" })).toBe(false);
  });

  it("enforces runtime max tool risk and human approval policy", async () => {
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
      runtimePolicy: {
        maxToolRisk: "write",
        requireHumanApprovalFor: ["write"],
      },
    });

    const unconfirmedWrite = await runtime.executeTool({
      mode: "build",
      toolName: "run_linter",
      input: { fix: true },
    });
    const confirmedWrite = await runtime.executeTool({
      mode: "build",
      toolName: "run_linter",
      input: { fix: true },
      confirmed: true,
    });
    const destructive = await runtime.executeTool({
      mode: "build",
      toolName: "write_file",
      input: { path: "README.md", content: "x" },
      confirmed: true,
    });

    expect(unconfirmedWrite).toMatchObject({
      success: false,
      error: "Runtime policy requires human approval for write tools.",
    });
    expect(confirmedWrite.success).toBe(true);
    expect(destructive).toMatchObject({
      success: false,
      error: "Runtime policy allows tools up to write risk; write_file is destructive.",
    });
  });

  it("blocks graph workflows that require tools outside the runtime policy", async () => {
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      runtimePolicy: { allowedTools: ["read_file"] },
    });

    const result = await runtime.workflowEngine.run({
      workflowId: "enterprise-rag-answer",
      input: { question: "How do refunds work?" },
    });

    expect(result).toMatchObject({
      workflowId: "enterprise-rag-answer",
      status: "failed",
      error:
        "Workflow node retrieve is blocked by runtime policy: Runtime policy does not allow tool: knowledge_search",
    });
  });

  it("marks destructive tools as confirmation-worthy", () => {
    const registry = createRegistry();
    const tool = registry.get("write_file");
    const policy = createPermissionPolicy();

    expect(tool).toBeDefined();
    expect(policy.canExecuteTool("build", tool!).requiresConfirmation).toBe(true);
  });

  it("creates conservative MCP tool policies for sensitive tools", () => {
    const policy = createMcpToolPolicy("github", "delete_branch", "destructive");

    expect(policy.requiresConfirmation).toBe(true);
    expect(policy.allowedModes).toContain("review");
  });

  it("persists runtime events to jsonl when configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coco-runtime-"));
    const eventLogPath = join(dir, "events.jsonl");
    const log = createFileEventLog(eventLogPath);

    log.record("runtime.initialized", { provider: "openai" });
    log.record("tool.blocked", { tool: "write_file" });

    const raw = await readFile(eventLogPath, "utf-8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    expect(log.list().map((event) => event.type)).toEqual(["runtime.initialized", "tool.blocked"]);
  });

  it("persists runtime sessions to a JSON file store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coco-runtime-sessions-"));
    const filePath = join(dir, "sessions.json");
    const store = createFileRuntimeSessionStore(filePath);

    const created = store.create({
      id: "rt_test",
      mode: "ask",
      metadata: { surface: "web", nested: { tenant: "corbat" } },
      messages: [{ role: "user", content: "hello" }],
    });
    created.metadata["surface"] = "mutated";
    (created.metadata["nested"] as Record<string, unknown>)["tenant"] = "mutated";
    created.messages.push({ role: "assistant", content: "mutated" });

    const reloaded = createFileRuntimeSessionStore(filePath);
    const session = reloaded.get("rt_test");
    expect(session).toMatchObject({
      id: "rt_test",
      mode: "ask",
      metadata: { surface: "web", nested: { tenant: "corbat" } },
    });
    expect(session?.messages).toEqual([{ role: "user", content: "hello" }]);

    reloaded.update({
      ...session!,
      messages: [...session!.messages, { role: "assistant", content: "hi" }],
    });
    expect(createFileRuntimeSessionStore(filePath).get("rt_test")?.messages).toHaveLength(2);

    expect(reloaded.delete("rt_test")).toBe(true);
    expect(createFileRuntimeSessionStore(filePath).get("rt_test")).toBeUndefined();
  });

  it("merges file-backed runtime session writes from multiple store instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coco-runtime-sessions-"));
    const filePath = join(dir, "sessions.json");
    const first = createFileRuntimeSessionStore(filePath);
    const second = createFileRuntimeSessionStore(filePath);

    first.create({ id: "rt_first", mode: "ask" });
    second.create({ id: "rt_second", mode: "review" });

    const ids = createFileRuntimeSessionStore(filePath)
      .list()
      .map((session) => session.id)
      .sort();
    expect(ids).toEqual(["rt_first", "rt_second"]);

    expect(first.delete("rt_first")).toBe(true);
    expect(
      createFileRuntimeSessionStore(filePath)
        .list()
        .map((session) => session.id),
    ).toEqual(["rt_second"]);
  });

  it("falls back to in-memory events after file writes fail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coco-runtime-"));
    const eventLogPath = join(dir, "events.jsonl");
    const log = createFileEventLog(eventLogPath);

    log.record("runtime.initialized", { provider: "openai" });

    await chmod(eventLogPath, 0o444);
    try {
      log.record("tool.blocked", { tool: "write_file" });

      expect(log.list().map((event) => event.type)).toEqual([
        "runtime.initialized",
        "tool.blocked",
      ]);
      expect(log.count()).toBe(2);
    } finally {
      await chmod(eventLogPath, 0o644);
    }
  });

  it("provides Postgres-backed write-through session and event adapters", async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const client: PostgresQueryClient = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes("from coco_runtime_sessions")) {
          return {
            rows: [
              {
                id: "rt_pg",
                created_at: "2026-06-19T00:00:00.000Z",
                updated_at: "2026-06-19T00:00:00.000Z",
                mode: "ask",
                messages: JSON.stringify([{ role: "user", content: "hello" }]),
                instructions: null,
                metadata: JSON.stringify({ tenantId: "tenant-a" }),
              },
            ],
          };
        }
        if (sql.includes("from coco_runtime_events")) {
          return {
            rows: [
              {
                id: "evt_pg",
                type: "turn.completed",
                timestamp: "2026-06-19T00:00:00.000Z",
                data: JSON.stringify({ sessionId: "rt_pg" }),
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const store = createPostgresRuntimeSessionStore(client, { tenantId: "tenant-a" });
    const created = store.create({ id: "rt_pg", mode: "ask" });
    const updated = store.update({
      ...created,
      messages: [{ role: "user", content: "hello" }],
    });
    const log = createPostgresEventLog(client, { tenantId: "tenant-a" });
    log.record("turn.completed", { sessionId: "rt_pg" });

    expect(store.get("rt_pg")?.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(updated.messages).toHaveLength(1);
    expect(log.count()).toBe(1);
    expect(queries.some((query) => query.sql.includes("insert into coco_runtime_sessions"))).toBe(
      true,
    );
    expect(queries.some((query) => query.sql.includes("insert into coco_runtime_events"))).toBe(
      true,
    );

    const sessionQueries = createPostgresRuntimeSessionQueries(client, { tenantId: "tenant-a" });
    await expect(sessionQueries.get("rt_pg")).resolves.toMatchObject({
      id: "rt_pg",
      metadata: { tenantId: "tenant-a" },
    });
    await expect(listPostgresRuntimeEvents(client, { sessionId: "rt_pg" })).resolves.toMatchObject([
      { id: "evt_pg", type: "turn.completed", data: { sessionId: "rt_pg" } },
    ]);
  });

  it("exposes reusable workflow definitions and records planned plans", () => {
    const eventLog = createEventLog();
    const catalog = createWorkflowCatalog();

    expect(catalog.list().map((workflow) => workflow.id)).toContain("architect-editor-verifier");
    expect(catalog.get("release")?.checks).toContain("release.yml");
    expect(catalog.get("release")?.steps.find((step) => step.id === "publish")?.risk).toBe(
      "destructive",
    );
    expect(catalog.get("provider-diagnosis")?.steps[0]?.requiredTools).toEqual([]);

    const plan = catalog.createPlan("provider-diagnosis", { provider: "openai" }, eventLog);

    expect(plan.status).toBe("planned");
    expect(eventLog.list().map((event) => event.type)).toContain("workflow.planned");
  });

  it("returns defensive copies of workflow definitions", () => {
    const catalog = createWorkflowCatalog();
    const workflow = catalog.get("release")!;

    workflow.checks.push("mutated");
    workflow.steps[0]!.requiredTools.push("mutated_tool");

    expect(catalog.get("release")?.checks).not.toContain("mutated");
    expect(catalog.get("release")?.steps[0]?.requiredTools).not.toContain("mutated_tool");
  });

  it("executes registered workflow handlers with structured events", async () => {
    const eventLog = createEventLog();
    const engine = createWorkflowEngine(undefined, eventLog);

    engine.registerHandler("provider-diagnosis", async (input, context) => ({
      provider: input["provider"],
      steps: context.workflow.steps.map((step) => step.id),
      planId: context.plan.id,
    }));

    const result = await engine.run({
      workflowId: "provider-diagnosis",
      input: { provider: "openai" },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      provider: "openai",
      steps: ["capability", "fallbacks"],
    });
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "workflow.planned",
      "workflow.started",
      "workflow.completed",
    ]);
  });

  it("returns failed workflow results instead of throwing handler errors", async () => {
    const eventLog = createEventLog();
    const engine = createWorkflowEngine(undefined, eventLog);

    engine.registerHandler("provider-diagnosis", async () => {
      throw new Error("probe failed");
    });

    const result = await engine.run({
      workflowId: "provider-diagnosis",
      input: { provider: "openai" },
    });

    expect(result).toMatchObject({
      workflowId: "provider-diagnosis",
      status: "failed",
      error: "probe failed",
    });
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "workflow.planned",
      "workflow.started",
      "workflow.failed",
    ]);
  });

  it("exposes runtime sessions through the HTTP adapter", async () => {
    await withRuntimeHttpServer(async (baseUrl) => {
      const session = await postJson<{ id: string }>(`${baseUrl}/sessions`, {
        mode: "ask",
        instructions: "Answer as web assistant.",
      });
      const turn = await postJson<{ content: string; sessionId: string }>(
        `${baseUrl}/sessions/${session.id}/messages`,
        { content: "hello" },
      );
      const events = (await (await fetch(`${baseUrl}/sessions/${session.id}/events`)).json()) as {
        events: Array<{ type: string }>;
      };

      expect(turn).toMatchObject({ sessionId: session.id, content: "runtime reply" });
      expect(events.events.map((event) => event.type)).toContain("turn.completed");
    });
  });

  it("returns client errors for invalid HTTP adapter requests", async () => {
    await withRuntimeHttpServer(
      async (baseUrl) => {
        const invalidJson = await fetch(`${baseUrl}/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        });
        const oversized = await fetch(`${baseUrl}/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ metadata: { value: "x".repeat(128) } }),
        });
        const invalidMode = await fetch(`${baseUrl}/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "ship" }),
        });
        const missingSession = await fetch(`${baseUrl}/sessions/rt_missing/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "hello" }),
        });

        expect(invalidJson.status).toBe(400);
        expect(await invalidJson.json()).toMatchObject({ error: "Invalid JSON request body." });
        expect(oversized.status).toBe(413);
        expect(invalidMode.status).toBe(400);
        expect(await invalidMode.json()).toMatchObject({ error: "Invalid runtime mode." });
        expect(missingSession.status).toBe(404);
      },
      { maxBodyBytes: 32 },
    );
  });
});
