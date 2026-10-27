import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ChatWithToolsResponse, LLMProvider, Message, ToolCall } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { createAgentRuntime } from "./agent-runtime.js";
import {
  createFileRuntimeSessionStore,
  createRuntimeSessionStore,
} from "./runtime-session-store.js";
import { createToolCallingRuntimeTurnRunner } from "./tool-calling-turn-runner.js";
import { getRuntimeTurn } from "./turn-transcript.js";
import { createSessionWorkLedgerAccess } from "./work-ledger.js";
import type { RuntimeSessionStore } from "./types.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function fileStore() {
  const directory = mkdtempSync(join(tmpdir(), "coco-transcript-"));
  directories.push(directory);
  const path = join(directory, "sessions.json");
  return { path, store: createFileRuntimeSessionStore(path) };
}
const call: ToolCall = {
  id: "write-1",
  name: "write_file",
  input: { value: "changed" },
  geminiThoughtSignature: "signature",
  providerState: { encrypted: "provider state" },
};
function response(calls: ToolCall[] = [], content = "Verified result"): ChatWithToolsResponse {
  return {
    id: "response",
    model: "fixture",
    content,
    toolCalls: calls,
    stopReason: calls.length ? "tool_use" : "end_turn",
    usage: { inputTokens: 1, outputTokens: 2 },
  };
}
async function fixture(store: RuntimeSessionStore, chat = vi.fn().mockResolvedValue(response())) {
  const registry = new ToolRegistry();
  const effect = vi.fn(async () => "changed once");
  registry.register({
    name: "write_file",
    category: "file",
    description: "Fixture write",
    parameters: z.object({ value: z.string() }),
    execute: effect,
  });
  const provider = {
    id: "ollama",
    name: "Fixture",
    chatWithTools: chat,
    countTokens: (text: string) => Math.ceil(text.length / 4),
    getContextWindow: () => 100000,
  } as unknown as LLMProvider;
  const runtime = await createAgentRuntime({
    providerType: "ollama",
    model: "fixture",
    provider,
    toolRegistry: registry,
    runtimeSessionStore: store,
    turnRunner: createToolCallingRuntimeTurnRunner({ maxToolIterations: 4 }),
  });
  return { runtime, chat, effect, provider };
}

describe("durable runtime turns", () => {
  it("checkpoints input, intent and each result before the next request, retaining ledger metadata", async () => {
    const { store, path } = fileStore();
    const chat = vi
      .fn()
      .mockResolvedValueOnce(response([call]))
      .mockResolvedValue(response());
    const f = await fixture(store, chat);
    const session = f.runtime.createSession({ mode: "build" });
    const ledger = createSessionWorkLedgerAccess(store).forSession(session.id);
    ledger.update({ steps: [{ id: "edit", description: "Edit", status: "in_progress" }] });
    f.effect.mockImplementation(async () => {
      expect(getRuntimeTurn(store.get(session.id)!)?.calls[0]?.status).toBe("running");
      ledger.update({ steps: [{ id: "next", description: "Verify", status: "pending" }] });
      return "changed once";
    });
    chat
      .mockReset()
      .mockResolvedValue(response())
      .mockImplementationOnce(async (messages: Message[]) => {
        const current = store.get(session.id)!;
        expect(current.messages).toEqual([{ role: "user", content: "Edit this file" }]);
        expect(getRuntimeTurn(current)?.status).toBe("running");
        expect(messages).toEqual(current.messages);
        return response([call]);
      })
      .mockImplementationOnce(async () => {
        const current = store.get(session.id)!;
        expect(getRuntimeTurn(current)?.calls[0]?.status).toBe("completed");
        expect(JSON.stringify(current.messages)).toContain("changed once");
        return response();
      });
    await f.runtime.runTurn({
      sessionId: session.id,
      content: "Edit this file",
      confirmedTools: ["write_file"],
    });
    const reopened = createFileRuntimeSessionStore(path).get(session.id)!;
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(reopened.messages).toHaveLength(4);
    expect(reopened.messages[1]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          geminiThoughtSignature: "signature",
          providerState: { encrypted: "provider state" },
        }),
      ]),
    );
    expect(getRuntimeTurn(reopened)?.status).toBe("completed");
    expect(ledger.read().items.map((item) => item.id)).toEqual(["edit", "next"]);
    await f.runtime.runTurn({ sessionId: session.id, content: "Explain your change" });
    expect(chat.mock.calls.at(-1)?.[0]).toEqual([
      ...reopened.messages,
      { role: "user", content: "Explain your change" },
    ]);
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it("reopens after a provider failure and resumes without repeating the effect or input", async () => {
    const { store, path } = fileStore();
    const f = await fixture(
      store,
      vi
        .fn()
        .mockResolvedValueOnce(response([call]))
        .mockRejectedValueOnce(new Error("provider unavailable")),
    );
    const session = f.runtime.createSession({ mode: "build" });
    await expect(
      f.runtime.runTurn({
        sessionId: session.id,
        content: "Edit this file",
        confirmedTools: ["write_file"],
      }),
    ).rejects.toThrow("provider unavailable");
    expect(f.effect).toHaveBeenCalledOnce();
    const g = await fixture(createFileRuntimeSessionStore(path));
    expect(g.runtime.inspectSessionRecovery(session.id).canResume).toBe(true);
    const resumed = await g.runtime.resumeTurn({ sessionId: session.id });
    expect(resumed.usage).toEqual({ inputTokens: 2, outputTokens: 4 });
    expect(g.effect).not.toHaveBeenCalled();
    expect(JSON.stringify(g.chat.mock.calls[0]?.[0])).toContain("changed once");
    expect(
      g.runtime.getSession(session.id)?.messages.filter((m) => m.content === "Edit this file"),
    ).toHaveLength(1);
  });

  it.each(["before", "after"])(
    "stops on persistence failure %s an effect and preserves uncertainty",
    async (phase) => {
      const { store, path } = fileStore();
      const update = store.update.bind(store);
      let armed = true;
      vi.spyOn(store, "update").mockImplementation((session) => {
        const state = getRuntimeTurn(session);
        const target = phase === "before" ? "running" : "completed";
        if (armed && state?.calls[0]?.status === target) {
          armed = false;
          throw new Error("disk full");
        }
        return update(session);
      });
      const f = await fixture(store, vi.fn().mockResolvedValue(response([call])));
      const session = f.runtime.createSession({ mode: "build" });
      await expect(
        f.runtime.runTurn({
          sessionId: session.id,
          content: "Edit this file",
          confirmedTools: ["write_file"],
        }),
      ).rejects.toThrow("disk full");
      expect(f.effect).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
      expect(f.chat).toHaveBeenCalledOnce();
      const g = await fixture(createFileRuntimeSessionStore(path));
      const inspection = g.runtime.inspectSessionRecovery(session.id);
      expect(inspection.uncertainCalls).toHaveLength(phase === "before" ? 0 : 1);
      if (phase === "after") {
        await expect(g.runtime.resumeTurn({ sessionId: session.id })).rejects.toThrow("Uncertain");
        const resolution = {
          turnId: inspection.turn!.id,
          callId: inspection.uncertainCalls[0]!.id,
          content: "Host inspected file: changed once",
          isError: false,
          reason: "Read the file externally",
        };
        expect(() =>
          g.runtime.resolveSessionToolCall(session.id, { ...resolution, turnId: "stale" }),
        ).toThrow("Stale");
        expect(() =>
          g.runtime.resolveSessionToolCall(session.id, { ...resolution, reason: " " }),
        ).toThrow("reason");
        g.runtime.resolveSessionToolCall(session.id, resolution);
        expect(() => g.runtime.resolveSessionToolCall(session.id, resolution)).toThrow("uncertain");
      }
      await g.runtime.resumeTurn({ sessionId: session.id });
      expect(g.effect).not.toHaveBeenCalled();
      expect(JSON.stringify(g.chat.mock.calls[0]?.[0])).toContain(
        phase === "before" ? "not executed" : "Host resolution",
      );
    },
  );

  it("keeps a partial cancelled batch and closes unstarted calls on explicit resume", async () => {
    const { store } = fileStore();
    const controller = new AbortController();
    const f = await fixture(
      store,
      vi
        .fn()
        .mockResolvedValueOnce(response([call, { ...call, id: "write-2" }]))
        .mockResolvedValue(response()),
    );
    const session = f.runtime.createSession({ mode: "build" });
    f.effect.mockImplementation(async () => {
      controller.abort(new Error("host stop"));
      return "finished first";
    });
    await expect(
      f.runtime.runTurn({
        sessionId: session.id,
        content: "Edit this file",
        confirmedTools: ["write_file"],
        options: { signal: controller.signal },
      }),
    ).rejects.toThrow("host stop");
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.runtime.inspectSessionRecovery(session.id).turn?.calls.map((c) => c.status)).toEqual([
      "completed",
      "planned",
    ]);
    await expect(f.runtime.runTurn({ sessionId: session.id, content: "New task" })).rejects.toThrow(
      "requires recovery",
    );
    await f.runtime.resumeTurn({ sessionId: session.id });
    expect(f.effect).toHaveBeenCalledOnce();
    const results = f.runtime.getSession(session.id)?.messages[2]?.content;
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool_use_id: "write-1", content: "finished first" }),
        expect.objectContaining({
          tool_use_id: "write-2",
          is_error: true,
          content: expect.stringContaining("not executed"),
        }),
      ]),
    );
  });

  it("retains denied calls as results without promoting their permissions on resume", async () => {
    const { store } = fileStore();
    const f = await fixture(
      store,
      vi
        .fn()
        .mockResolvedValueOnce(response([call]))
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(response()),
    );
    const session = f.runtime.createSession({ mode: "ask" });
    await expect(
      f.runtime.runTurn({ sessionId: session.id, content: "Edit this file" }),
    ).rejects.toThrow("offline");
    expect(f.effect).not.toHaveBeenCalled();
    expect(JSON.stringify(store.get(session.id)?.messages)).toContain('"is_error":true');
    await f.runtime.resumeTurn({ sessionId: session.id });
    expect(f.effect).not.toHaveBeenCalled();
  });

  it("guards simultaneous run, stream, resolve and close for the same session", async () => {
    const store = createRuntimeSessionStore();
    let release!: (value: ChatWithToolsResponse) => void;
    const f = await fixture(
      store,
      vi.fn(
        () =>
          new Promise<ChatWithToolsResponse>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const session = f.runtime.createSession();
    const active = f.runtime.runTurn({ sessionId: session.id, content: "Inspect this file" });
    await vi.waitFor(() => expect(f.chat).toHaveBeenCalled());
    await expect(f.runtime.runTurn({ sessionId: session.id, content: "Other" })).rejects.toThrow(
      "active turn",
    );
    await expect(
      f.runtime
        .streamTurn({ sessionId: session.id, content: "Other" })
        [Symbol.asyncIterator]()
        .next(),
    ).resolves.toMatchObject({
      value: { type: "error", error: expect.stringContaining("active turn") },
    });
    await expect(f.runtime.closeSession(session.id)).rejects.toThrow("active turn");
    expect(() =>
      f.runtime.resolveSessionToolCall(session.id, {
        turnId: "x",
        callId: "x",
        content: "",
        isError: true,
        reason: "host",
      }),
    ).toThrow("active turn");
    release(response());
    await active;
    expect(store.get(session.id)?.messages).toHaveLength(2);
  });

  it("supports fallback custom runners without duplicating user/final or overwriting fresh metadata", async () => {
    const store = createRuntimeSessionStore();
    const runtime = await createAgentRuntime({
      providerType: "ollama",
      provider: {} as LLMProvider,
      runtimeSessionStore: store,
      turnRunner: {
        async run(input, context) {
          expect(context.session.messages).toEqual([]);
          const latest = store.get(context.session.id)!;
          store.update({ ...latest, metadata: { ...latest.metadata, hostNote: "fresh" } });
          return {
            sessionId: context.session.id,
            content: "Done",
            usage: { inputTokens: 0, outputTokens: 0 },
            model: "fixture",
            mode: context.session.mode,
          };
        },
      },
    });
    const result = await runtime.runTurn({ content: "Custom input" });
    expect(store.get(result.sessionId)?.messages).toEqual([
      { role: "user", content: "Custom input" },
      { role: "assistant", content: "Done" },
    ]);
    expect(store.get(result.sessionId)?.metadata.hostNote).toBe("fresh");
  });

  it("rejects reserved metadata and corrupt store/state instead of overwriting evidence", async () => {
    const { store, path } = fileStore();
    const f = await fixture(store);
    expect(() => f.runtime.createSession({ metadata: { runtimeTurn: {} } })).toThrow("Reserved");
    const session = store.create({ metadata: { runtimeTurn: { version: 999 } } });
    expect(() => f.runtime.inspectSessionRecovery(session.id)).toThrow("Corrupt");
    expect(() => createFileRuntimeSessionStore(path)).toThrow("Corrupt");
    writeFileSync(path, '{"version":1,"sessions":[{"id":"x"}]}');
    expect(() => createFileRuntimeSessionStore(path)).toThrow("Corrupt");
    writeFileSync(path, "");
    expect(() => createFileRuntimeSessionStore(path)).toThrow();
  });
});

describe("buffered tool-aware runtime streams and budgets", () => {
  it("streams actions through the same durable tool cycle and emits exactly one terminal result", async () => {
    const { store, path } = fileStore();
    const f = await fixture(
      store,
      vi
        .fn()
        .mockResolvedValueOnce(response([call]))
        .mockResolvedValue(response()),
    );
    const events = [];
    for await (const event of f.runtime.streamTurn({
      content: "Edit this file",
      mode: "build",
      confirmedTools: ["write_file"],
    }))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual(["text", "done"]);
    expect(f.effect).toHaveBeenCalledOnce();
    const saved = createFileRuntimeSessionStore(path).get(events[0]!.sessionId)!;
    expect(getRuntimeTurn(saved)?.status).toBe("completed");
    expect(saved.messages).toHaveLength(4);
  });

  it("retains completed effects after a failed buffered stream and reopens without replay", async () => {
    const { store, path } = fileStore();
    const f = await fixture(
      store,
      vi
        .fn()
        .mockResolvedValueOnce(response([call]))
        .mockRejectedValueOnce(new Error("provider offline")),
    );
    const events = [];
    for await (const event of f.runtime.streamTurn({
      content: "Edit this file",
      mode: "build",
      confirmedTools: ["write_file"],
    }))
      events.push(event);
    expect(events).toEqual([expect.objectContaining({ type: "error", error: "provider offline" })]);
    expect(events[0]?.sessionId).not.toBe("");
    const g = await fixture(createFileRuntimeSessionStore(path));
    await g.runtime.resumeTurn({ sessionId: events[0]!.sessionId });
    expect(g.effect).not.toHaveBeenCalled();
  });

  it("cancels a tool-aware stream during its effect without emitting completion", async () => {
    const { store } = fileStore();
    const f = await fixture(store, vi.fn().mockResolvedValue(response([call])));
    const controller = new AbortController();
    f.effect.mockImplementation(async () => {
      controller.abort(new Error("host cancelled"));
      return "effect completed";
    });
    const events = [];
    for await (const event of f.runtime.streamTurn({
      content: "Edit this file",
      mode: "build",
      confirmedTools: ["write_file"],
      options: { signal: controller.signal },
    }))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual(["error"]);
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.runtime.inspectSessionRecovery(events[0]!.sessionId).turn?.status).toBe("cancelled");
    expect(JSON.stringify(store.get(events[0]!.sessionId)?.messages)).toContain("effect completed");
  });

  it("refuses fixed instructions and tool schemas that leave no output budget before provider/effects", async () => {
    const { store } = fileStore();
    const f = await fixture(store);
    f.provider.getContextWindow = () => 100;
    await expect(
      f.runtime.runTurn({
        content: "Edit this file",
        mode: "build",
        options: { maxTokens: 80, system: "rule ".repeat(100) },
      }),
    ).rejects.toMatchObject({ code: "fixed_context_exceeds_window" });
    expect(f.chat).not.toHaveBeenCalled();
    expect(f.effect).not.toHaveBeenCalled();
  });

  it("recovers one rejected overflow after an effect while preserving the full durable transcript", async () => {
    const { store } = fileStore();
    const chat = vi
      .fn()
      .mockResolvedValueOnce(response([call]))
      .mockRejectedValueOnce(
        Object.assign(new Error("context_length_exceeded"), { code: "context_length_exceeded" }),
      )
      .mockResolvedValue(response());
    const f = await fixture(store, chat);
    const summarize = vi.fn().mockResolvedValue({
      content: "Earlier work inspected; verify the edit.",
      stopReason: "end_turn",
    });
    f.provider.chat = summarize;
    const session = store.create({
      mode: "build",
      messages: Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: index === 1 ? "Durable old evidence ".repeat(1500) : "Continue",
      })) as Message[],
    });
    await f.runtime.runTurn({
      sessionId: session.id,
      content: "Edit this file",
      confirmedTools: ["write_file"],
    });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(f.effect).toHaveBeenCalledOnce();
    expect(summarize).toHaveBeenCalledOnce();
    expect(JSON.stringify(chat.mock.calls[2]?.[0])).toContain("Previous conversation summary");
    expect(store.get(session.id)?.messages[1]?.content).toContain("Durable old evidence");
    expect(store.get(session.id)?.messages).toHaveLength(14);
    expect(getRuntimeTurn(store.get(session.id)!)?.calls[0]?.status).toBe("completed");
  });

  it("does not retry an unrelated provider error", async () => {
    const { store } = fileStore();
    const f = await fixture(store, vi.fn().mockRejectedValue(new Error("rate limit 429")));
    f.provider.chat = vi.fn();
    await expect(f.runtime.runTurn({ content: "Inspect the project" })).rejects.toThrow("429");
    expect(f.chat).toHaveBeenCalledOnce();
    expect(f.provider.chat).not.toHaveBeenCalled();
  });
});

describe("resume boundary invariants", () => {
  it("rejects completed turns repeatedly without mutating state or history", async () => {
    const store = createRuntimeSessionStore();
    const f = await fixture(store);
    const result = await f.runtime.runTurn({ content: "Inspect the project" });
    const snapshot = store.get(result.sessionId);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(f.runtime.resumeTurn({ sessionId: result.sessionId })).rejects.toThrow(
        "already completed",
      );
      expect(store.get(result.sessionId)).toEqual(snapshot);
      expect(f.runtime.inspectSessionRecovery(result.sessionId).canResume).toBe(false);
    }
    expect(f.chat).toHaveBeenCalledOnce();
  });

  it("counts human inputs rather than tool results and does not consume another turn when resuming", async () => {
    const store = createRuntimeSessionStore();
    const f = await fixture(
      store,
      vi
        .fn()
        .mockResolvedValueOnce(response([call]))
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(response()),
    );
    const runtime = await createAgentRuntime({
      providerType: "ollama",
      model: "fixture",
      provider: f.provider,
      toolRegistry: f.runtime.toolRegistry,
      runtimeSessionStore: store,
      turnRunner: createToolCallingRuntimeTurnRunner(),
      runtimePolicy: { costBudget: { maxTurns: 2 } },
    });
    const session = runtime.createSession({ mode: "build" });
    await expect(
      runtime.runTurn({
        sessionId: session.id,
        content: "Edit this file",
        confirmedTools: ["write_file"],
      }),
    ).rejects.toThrow("offline");
    await runtime.resumeTurn({ sessionId: session.id });
    await runtime.runTurn({ sessionId: session.id, content: "Explain this change" });
    await expect(
      runtime.runTurn({ sessionId: session.id, content: "Third task" }),
    ).rejects.toMatchObject({ code: "max_turns_exceeded" });
    expect(f.effect).toHaveBeenCalledOnce();
  });
});

describe("bounded context recovery", () => {
  it("retries an overflow only once and preserves the raw history after another rejection", async () => {
    const { store } = fileStore();
    const overflow = Object.assign(new Error("context_length_exceeded"), {
      code: "context_length_exceeded",
    });
    const f = await fixture(store, vi.fn().mockRejectedValue(overflow));
    f.provider.chat = vi
      .fn()
      .mockResolvedValue({ content: "Earlier inspection completed.", stopReason: "end_turn" });
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: index === 1 ? "Preserved evidence ".repeat(1500) : "Continue",
    })) as Message[];
    const session = store.create({ messages });
    await expect(
      f.runtime.runTurn({ sessionId: session.id, content: "Inspect the project" }),
    ).rejects.toBe(overflow);
    expect(f.chat).toHaveBeenCalledTimes(2);
    expect(f.provider.chat).toHaveBeenCalledOnce();
    expect(store.get(session.id)?.messages).toEqual([
      ...messages,
      { role: "user", content: "Inspect the project" },
    ]);
    expect(f.effect).not.toHaveBeenCalled();
  });
});

describe("ephemeral host call approvals", () => {
  it("passes a defensive copy and does not persist approval across reopen", async () => {
    const { store, path } = fileStore();
    const f = await fixture(
      store,
      vi
        .fn()
        .mockResolvedValueOnce(response([call]))
        .mockResolvedValue(response()),
    );
    const approval = vi.fn((requested: Readonly<ToolCall>) => {
      requested.input.value = "callback mutation";
      return true;
    });
    const result = await f.runtime.runTurn({
      content: "Edit this file",
      mode: "build",
      confirmToolCall: approval,
    });
    expect(f.effect).toHaveBeenCalledWith({ value: "changed" }, expect.anything());
    expect(approval).toHaveBeenCalledOnce();
    expect(JSON.stringify(store.get(result.sessionId))).not.toContain("confirmToolCall");
    const g = await fixture(
      createFileRuntimeSessionStore(path),
      vi
        .fn()
        .mockResolvedValueOnce(response([call]))
        .mockResolvedValue(response()),
    );
    await g.runtime.runTurn({ sessionId: result.sessionId, content: "Edit this file again" });
    expect(g.effect).not.toHaveBeenCalled();
  });

  it.each(["plan", "policy"] as const)("does not override %s restrictions", async (restriction) => {
    const store = createRuntimeSessionStore();
    const f = await fixture(
      store,
      vi
        .fn()
        .mockResolvedValueOnce(response([call]))
        .mockResolvedValue(response()),
    );
    const runtime = await createAgentRuntime({
      providerType: "ollama",
      model: "fixture",
      provider: f.provider,
      toolRegistry: f.runtime.toolRegistry,
      runtimeSessionStore: store,
      turnRunner: createToolCallingRuntimeTurnRunner(),
      ...(restriction === "policy" ? { runtimePolicy: { allowedTools: ["read_file"] } } : {}),
    });
    await runtime.runTurn({
      content: "Edit this file",
      mode: restriction === "plan" ? "plan" : "build",
      confirmToolCall: () => true,
    });
    expect(f.effect).not.toHaveBeenCalled();
  });
});
