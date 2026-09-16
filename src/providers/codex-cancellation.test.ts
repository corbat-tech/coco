import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexProvider } from "./codex.js";
import type { ChatOptions, StreamChunk } from "./types.js";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), fetch: vi.fn() }));
vi.mock("../auth/index.js", () => ({ getValidAccessToken: mocks.auth }));
const methods = ["chat", "chatWithTools", "stream", "streamWithTools"] as const;
type Method = (typeof methods)[number];
const streams = ["stream", "streamWithTools"] as const;
const messages = [{ role: "user" as const, content: "fixture" }];
const textEvent = { type: "response.output_text.delta", delta: "fixture" };
const completed = {
  type: "response.completed",
  response: {
    id: "fixture",
    status: "completed",
    output: [],
    usage: { input_tokens: 1, output_tokens: 1 },
  },
};
async function providerFor(timeout?: number) {
  const provider = new CodexProvider();
  await provider.initialize({ model: "gpt-5.2", ...(timeout === undefined ? {} : { timeout }) });
  mocks.auth.mockClear();
  return provider;
}
function readerFixture(events: unknown[] = [textEvent, completed]) {
  const bytes = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  );
  const reader = {
    read: vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: bytes })
      .mockResolvedValue({ done: true, value: undefined }),
    cancel: vi.fn().mockResolvedValue(undefined),
    releaseLock: vi.fn(),
  };
  return { reader, response: { ok: true, body: { getReader: () => reader } } };
}
function iteratorFor(
  provider: CodexProvider,
  method: (typeof streams)[number],
  options: ChatOptions,
) {
  return (
    method === "stream"
      ? provider.stream(messages, options)
      : provider.streamWithTools(messages, { ...options, tools: [] })
  )[Symbol.asyncIterator]();
}
async function invoke(
  provider: CodexProvider,
  method: Method,
  options: ChatOptions,
  seen: StreamChunk[] = [],
) {
  if (method === "chat") return provider.chat(messages, options);
  if (method === "chatWithTools")
    return provider.chatWithTools(messages, { ...options, tools: [] });
  const iterator = iteratorFor(provider, method, options);
  for (;;) {
    const item = await iterator.next();
    if (item.done) return seen;
    seen.push(item.value);
  }
}
function expectClean(signal: AbortSignal) {
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.auth.mockReset().mockResolvedValue({ accessToken: "fixture-token" });
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Codex transport cancellation", () => {
  it.each(methods)("%s pre-abort prevents HTTP dispatch", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    const reason = new Error("fixture preabort");
    controller.abort(reason);
    await expect(invoke(provider, method, { signal: controller.signal })).rejects.toBe(reason);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expectClean(controller.signal);
  });

  it.each(methods)("%s owns the fetch signal and closes it after success", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    let owned!: AbortSignal;
    const fixture = readerFixture();
    mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
      owned = options.signal as AbortSignal;
      expect(owned).not.toBe(controller.signal);
      expect(owned.aborted).toBe(false);
      return fixture.response;
    });
    await invoke(provider, method, { signal: controller.signal });
    expect(owned.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    expect(fixture.reader.cancel).toHaveBeenCalledOnce();
    expect(fixture.reader.releaseLock).toHaveBeenCalledOnce();
    expectClean(controller.signal);
  });

  it.each(methods)("%s rejects a late fetch response after host abort", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    const reason = new Error("headers canceled");
    const fixture = readerFixture();
    mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
      controller.abort(reason);
      expect(options.signal?.reason).toBe(reason);
      return fixture.response;
    });
    const seen: StreamChunk[] = [];
    await expect(invoke(provider, method, { signal: controller.signal }, seen)).rejects.toBe(
      reason,
    );
    expect(seen).toEqual([]);
    expect(fixture.reader.read).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expectClean(controller.signal);
  });

  it.each(methods)("%s preserves host reason while fetch is pending", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    mocks.fetch.mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener(
            "abort",
            () => reject(new Error("wrapped transport cancellation")),
            { once: true },
          );
        }),
    );
    const outcome = invoke(provider, method, { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const reason = new Error("pending headers canceled");
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expectClean(controller.signal);
  });

  it.each(methods)("%s rejects cancellation while its response body is pending", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    const fixture = readerFixture();
    mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
      fixture.reader.read.mockReset().mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener(
              "abort",
              () => reject(new Error("wrapped body cancellation")),
              { once: true },
            );
          }),
      );
      return fixture.response;
    });
    const seen: StreamChunk[] = [];
    const outcome = invoke(provider, method, { signal: controller.signal }, seen).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.reader.read).toHaveBeenCalledOnce();
    const reason = new Error("pending body canceled");
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expect(seen).toEqual([]);
    expect(fixture.reader.cancel).toHaveBeenCalledOnce();
    expect(fixture.reader.releaseLock).toHaveBeenCalledOnce();
    expectClean(controller.signal);
  });

  const deadlines = [
    { label: "call", configured: 9999, override: 13, deadline: 13 },
    { label: "config", configured: 31, override: undefined, deadline: 31 },
    { label: "default", configured: undefined, override: undefined, deadline: 120000 },
  ];
  it.each(methods.flatMap((method) => deadlines.map((item) => ({ method, ...item }))))(
    "$method enforces $label deadline during pending fetch",
    async ({ method, configured, override, deadline }) => {
      const provider = await providerFor(configured);
      const controller = new AbortController();
      let owned!: AbortSignal;
      mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
        owned = options.signal as AbortSignal;
        return new Promise((_resolve, reject) =>
          owned.addEventListener("abort", () => reject(owned.reason), { once: true }),
        );
      });
      const outcome = invoke(provider, method, {
        signal: controller.signal,
        ...(override === undefined ? {} : { timeout: override }),
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(deadline - 1);
      expect(owned.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toBe(owned.reason);
      expect(String(owned.reason)).toMatch(/timeout|timed out/i);
      expect(mocks.fetch).toHaveBeenCalledOnce();
      expectClean(controller.signal);
    },
  );

  it.each(methods)("%s timeout zero disables the configured timeout", async (method) => {
    const provider = await providerFor(3);
    let owned!: AbortSignal;
    let finish!: (value: unknown) => void;
    mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
      owned = options.signal as AbortSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pending = invoke(provider, method, { timeout: 0 });
    await vi.advanceTimersByTimeAsync(120001);
    expect(owned.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    finish(readerFixture().response);
    await pending;
    expect(owned.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["chat", "chatWithTools"] as const)(
    "%s deadline includes retry backoff",
    async (method) => {
      const provider = await providerFor();
      let owned!: AbortSignal;
      mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
        owned = options.signal as AbortSignal;
        throw new Error("503 fixture unavailable");
      });
      const outcome = invoke(provider, method, { timeout: 17, maxRetries: 3 }).catch(
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(17);
      expect(await outcome).toBe(owned.reason);
      await vi.advanceTimersByTimeAsync(20000);
      expect(mocks.fetch).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe("Codex SSE reader lifecycle", () => {
  it.each(methods)("%s canceled EOF never returns success or done", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    const reason = new Error("EOF canceled");
    const fixture = readerFixture();
    fixture.reader.read.mockReset().mockImplementation(async () => {
      controller.abort(reason);
      return { done: true, value: undefined };
    });
    mocks.fetch.mockResolvedValue(fixture.response);
    const seen: StreamChunk[] = [];
    await expect(invoke(provider, method, { signal: controller.signal }, seen)).rejects.toBe(
      reason,
    );
    expect(seen).toEqual([]);
    expect(fixture.reader.cancel).toHaveBeenCalledOnce();
    expect(fixture.reader.releaseLock).toHaveBeenCalledOnce();
    expectClean(controller.signal);
  });

  it.each(streams)(
    "%s abort after text skips buffered done and performs no extra read",
    async (method) => {
      const provider = await providerFor();
      const controller = new AbortController();
      const fixture = readerFixture();
      mocks.fetch.mockResolvedValue(fixture.response);
      const iterator = iteratorFor(provider, method, { signal: controller.signal });
      expect((await iterator.next()).value).toMatchObject({ type: "text" });
      const reason = new Error("between buffered events");
      controller.abort(reason);
      await expect(iterator.next()).rejects.toBe(reason);
      expect(fixture.reader.read).toHaveBeenCalledOnce();
      expect(fixture.reader.cancel).toHaveBeenCalledOnce();
      expect(fixture.reader.releaseLock).toHaveBeenCalledOnce();
      expectClean(controller.signal);
    },
  );

  it.each(["abort", "timeout"] as const)(
    "%s between buffered tool start/end prevents remaining emissions",
    async (cause) => {
      const provider = await providerFor();
      const controller = new AbortController();
      const fixture = readerFixture([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "function_call",
            id: "item-1",
            call_id: "call-1",
            name: "fixture_tool",
            arguments: "",
          },
        },
        {
          type: "response.function_call_arguments.done",
          item_id: "item-1",
          output_index: 0,
          arguments: "{}",
        },
        completed,
      ]);
      let owned!: AbortSignal;
      mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
        owned = options.signal as AbortSignal;
        return fixture.response;
      });
      const iterator = iteratorFor(provider, "streamWithTools", {
        signal: controller.signal,
        timeout: 23,
      });
      expect((await iterator.next()).value).toMatchObject({ type: "tool_use_start" });
      if (cause === "abort") controller.abort(new Error("between tool events"));
      else await vi.advanceTimersByTimeAsync(23);
      await expect(iterator.next()).rejects.toBe(owned.reason);
      expect(fixture.reader.read).toHaveBeenCalledOnce();
      expect(fixture.reader.cancel).toHaveBeenCalledOnce();
      expect(fixture.reader.releaseLock).toHaveBeenCalledOnce();
      expectClean(controller.signal);
    },
  );

  it.each(streams)(
    "%s consumer return aborts transport and releases owned reader",
    async (method) => {
      const provider = await providerFor();
      const controller = new AbortController();
      const fixture = readerFixture();
      let owned!: AbortSignal;
      mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
        owned = options.signal as AbortSignal;
        return fixture.response;
      });
      const iterator = iteratorFor(provider, method, { signal: controller.signal });
      await iterator.next();
      await iterator.return?.();
      expect(owned.aborted).toBe(true);
      expect(fixture.reader.read).toHaveBeenCalledOnce();
      expect(fixture.reader.cancel).toHaveBeenCalledOnce();
      expect(fixture.reader.releaseLock).toHaveBeenCalledOnce();
      expectClean(controller.signal);
    },
  );
});
