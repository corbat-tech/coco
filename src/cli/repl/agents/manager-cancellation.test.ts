import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentManager } from "./manager.js";
import { ToolRegistry } from "../../../tools/registry.js";
import type {
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  LLMProvider,
} from "../../../providers/types.js";
vi.mock("../../../utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const response: ChatWithToolsResponse = {
  id: "fixture",
  content: "fixture response",
  toolCalls: [],
  stopReason: "end_turn",
  usage: { inputTokens: 1, outputTokens: 1 },
  model: "fixture",
};
function deferred() {
  let resolve!: (value: ChatWithToolsResponse) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ChatWithToolsResponse>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const chat = vi.fn<LLMProvider["chatWithTools"]>();
  const provider: LLMProvider = {
    id: "fixture",
    name: "fixture",
    initialize: vi.fn(),
    chat: vi.fn(),
    chatWithTools: chat,
    stream: vi.fn(),
    streamWithTools: vi.fn(),
    countTokens: () => 1,
    getContextWindow: () => 200000,
    isAvailable: async () => true,
  };
  const registry = new ToolRegistry();
  const effect = vi.fn().mockResolvedValue("fixture read");
  registry.register({
    name: "read_file",
    description: "Fixture read",
    category: "file",
    parameters: z.object({ path: z.string() }),
    execute: effect,
  });
  const manager = new AgentManager(provider, registry);
  const cancel = vi.fn();
  const complete = vi.fn();
  manager.on("cancel", cancel);
  manager.on("complete", complete);
  return { manager, chat, effect, cancel, complete };
}
function signalFor(chat: ReturnType<typeof fixture>["chat"], index = 0) {
  return (chat.mock.calls[index]![1] as ChatWithToolsOptions).signal!;
}
function clean(signal: AbortSignal) {
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("AgentManager cancellation ownership", () => {
  it("pre-abort never invokes the provider and reports the host reason", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort(new Error("fixture preabort reason"));
    const result = await f.manager.spawn("explore", "fixture task", { signal: controller.signal });
    expect(result.success).toBe(false);
    expect(result.agent.status).toBe("failed");
    expect(result.agent.error).toContain("fixture preabort reason");
    expect(f.chat).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.manager.getActiveCount()).toBe(0);
    clean(controller.signal);
  });

  it("external cancellation reaches an owned provider signal and rejects late tool effects", async () => {
    const f = fixture();
    const pending = deferred();
    const controller = new AbortController();
    f.chat.mockReturnValue(pending.promise);
    const outcome = f.manager.spawn("explore", "fixture task", { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    const owned = signalFor(f.chat);
    expect(owned).toBeInstanceOf(AbortSignal);
    expect(owned).not.toBe(controller.signal);
    const reason = new Error("external fixture stop");
    controller.abort(reason);
    expect(owned.reason).toBe(reason);
    expect(f.manager.getActiveCount()).toBe(1);
    pending.resolve({
      ...response,
      toolCalls: [{ id: "read-1", name: "read_file", input: { path: "fixture" } }],
    });
    const result = await outcome;
    expect(result.success).toBe(false);
    expect(result.agent.status).toBe("failed");
    expect(result.agent.error).toContain(reason.message);
    expect(f.effect).not.toHaveBeenCalled();
    expect(f.chat).toHaveBeenCalledOnce();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.manager.getActiveCount()).toBe(0);
    clean(controller.signal);
  });

  it("cancel(id) retains active work until provider settlement and suppresses late success", async () => {
    const f = fixture();
    const pending = deferred();
    f.chat.mockReturnValue(pending.promise);
    const outcome = f.manager.spawn("explore", "fixture task");
    await vi.advanceTimersByTimeAsync(0);
    const id = f.manager.getActiveAgents()[0]!.id;
    expect(f.manager.cancel(id)).toBe(true);
    expect(signalFor(f.chat).aborted).toBe(true);
    expect(f.manager.getActiveCount()).toBe(1);
    const timeout = vi.fn();
    f.manager.on("timeout", timeout);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(timeout).not.toHaveBeenCalled();
    pending.resolve(response);
    const result = await outcome;
    expect(result.success).toBe(false);
    expect(result.agent.status).toBe("failed");
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.manager.getActiveCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains a late persistence failure diagnostic after cancellation", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.chat.mockImplementationOnce(async () => {
      controller.abort(new Error("fixture canceled"));
      throw new Error("fixture credential persistence failed");
    });
    const result = await f.manager.spawn("explore", "fixture", { signal: controller.signal });
    expect(result.success).toBe(false);
    expect(result.agent.error).toContain("credential persistence failed");
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.complete).not.toHaveBeenCalled();
    clean(controller.signal);
  });

  it.each([undefined, 19])(
    "timeout %s aborts provider but retains active work until settlement",
    async (timeout) => {
      const f = fixture();
      const pending = deferred();
      f.chat.mockReturnValue(pending.promise);
      const outcome = f.manager.spawn(
        "explore",
        "fixture task",
        timeout === undefined ? {} : { timeout },
      );
      await vi.advanceTimersByTimeAsync((timeout ?? 300000) - 1);
      expect(signalFor(f.chat).aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signalFor(f.chat).aborted).toBe(true);
      expect(f.manager.getActiveCount()).toBe(1);
      pending.resolve(response);
      const result = await outcome;
      expect(result.success).toBe(false);
      expect(result.agent.status).toBe("failed");
      expect(result.agent.error).toMatch(/timeout|timed out/i);
      expect(f.complete).not.toHaveBeenCalled();
      expect(f.manager.getActiveCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("timeout zero disables the deadline", async () => {
    const f = fixture();
    const pending = deferred();
    f.chat.mockReturnValue(pending.promise);
    const outcome = f.manager.spawn("explore", "fixture task", { timeout: 0 });
    await vi.advanceTimersByTimeAsync(300001);
    expect(signalFor(f.chat).aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve(response);
    expect((await outcome).success).toBe(true);
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it.each(["success", "error"] as const)(
    "%s removes its external listener without removing a host listener",
    async (ending) => {
      const f = fixture();
      const controller = new AbortController();
      const hostListener = vi.fn();
      controller.signal.addEventListener("abort", hostListener);
      if (ending === "success") f.chat.mockResolvedValue(response);
      else f.chat.mockRejectedValue(new Error("Aborted appears in an ordinary provider failure"));
      const result = await f.manager.spawn("explore", "fixture task", {
        signal: controller.signal,
      });
      expect(result.success).toBe(ending === "success");
      expect(f.cancel).not.toHaveBeenCalled();
      expect(getEventListeners(controller.signal, "abort")).toEqual([hostListener]);
      expect(vi.getTimerCount()).toBe(0);
      controller.signal.removeEventListener("abort", hostListener);
    },
  );

  it("canceling A leaves B's provider request and completion intact", async () => {
    const f = fixture();
    const a = deferred();
    const b = deferred();
    f.chat.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = f.manager.spawn("explore", "A fixture");
    const second = f.manager.spawn("explore", "B fixture");
    await vi.advanceTimersByTimeAsync(0);
    const id = f.manager.getActiveAgents().find((agent) => agent.task === "A fixture")!.id;
    f.manager.cancel(id);
    expect(signalFor(f.chat, 0).aborted).toBe(true);
    expect(signalFor(f.chat, 1).aborted).toBe(false);
    expect(f.manager.getActiveCount()).toBe(2);
    a.resolve(response);
    expect((await first).success).toBe(false);
    expect(f.manager.getActiveCount()).toBe(1);
    b.resolve(response);
    expect((await second).success).toBe(true);
    expect(f.manager.getActiveCount()).toBe(0);
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.complete).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
