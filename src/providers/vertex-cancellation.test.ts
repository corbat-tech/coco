import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VertexProvider } from "./vertex.js";
import type { ChatOptions, StreamChunk } from "./types.js";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), fetch: vi.fn() }));
vi.mock("../auth/gcloud.js", () => ({ getCachedADCToken: mocks.auth }));
const methods = ["chat", "chatWithTools", "stream", "streamWithTools"] as const;
type Method = (typeof methods)[number];
const streams = ["stream", "streamWithTools"] as const;
const chats = ["chat", "chatWithTools"] as const;
const messages = [{ role: "user" as const, content: "fixture" }];
const token = { accessToken: "fixture-token", expiresAt: Number.MAX_SAFE_INTEGER };
const payload = {
  candidates: [{ content: { parts: [{ text: "fixture" }] }, finishReason: "STOP" }],
};
async function providerFor(timeout?: number) {
  const provider = new VertexProvider();
  // Empty explicit key selects mocked ADC regardless of any host environment.
  await provider.initialize({
    project: "fixture-project",
    apiKey: "",
    model: "gemini-2.5-flash",
    ...(timeout === undefined ? {} : { timeout }),
  });
  mocks.auth.mockClear();
  return provider;
}
function iteratorFor(
  provider: VertexProvider,
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
  provider: VertexProvider,
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
function readerFixture(data: unknown = payload) {
  const read = vi
    .fn()
    .mockResolvedValueOnce({
      done: false,
      value: new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`),
    })
    .mockResolvedValue({ done: true, value: undefined });
  const reader = { read, cancel: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn() };
  return { reader, response: { ok: true, body: { getReader: () => reader } } };
}
function successfulResponse(method: Method) {
  return method.startsWith("stream")
    ? readerFixture().response
    : { ok: true, json: vi.fn().mockResolvedValue(payload) };
}
function expectClean(signal: AbortSignal) {
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.auth.mockReset().mockResolvedValue(token);
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Vertex cancellation boundaries", () => {
  it.each(methods)("%s pre-abort never enters auth or fetch", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    const reason = new Error("pre-aborted fixture");
    controller.abort(reason);
    await expect(invoke(provider, method, { signal: controller.signal })).rejects.toBe(reason);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expectClean(controller.signal);
  });

  it.each(methods)("%s forwards one owned signal through ADC and fetch", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    let owned!: AbortSignal;
    mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
      owned = options.signal as AbortSignal;
      expect(owned).not.toBe(controller.signal);
      expect(owned.aborted).toBe(false);
      expect(mocks.auth).toHaveBeenCalledWith(owned);
      return successfulResponse(method);
    });
    await invoke(provider, method, { signal: controller.signal });
    expect(owned.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    expectClean(controller.signal);
  });

  it.each(methods)(
    "%s host abort during ADC prevents fetch even if auth resolves late",
    async (method) => {
      const provider = await providerFor();
      const controller = new AbortController();
      const reason = new Error("ADC canceled");
      mocks.auth.mockImplementation(async (signal: AbortSignal) => {
        controller.abort(reason);
        expect(signal.aborted).toBe(true);
        expect(signal.reason).toBe(reason);
        return token;
      });
      await expect(invoke(provider, method, { signal: controller.signal })).rejects.toBe(reason);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expectClean(controller.signal);
    },
  );

  it.each(methods)("%s preserves cancellation while fetch is pending", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    const reason = new Error("fetch canceled");
    mocks.fetch.mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener(
            "abort",
            () => reject(new Error("transport abort wrapper")),
            { once: true },
          );
        }),
    );
    const outcome = invoke(provider, method, { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expectClean(controller.signal);
  });

  it.each(chats)("%s never accepts JSON resolved after cancellation", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    const reason = new Error("JSON canceled");
    let finish!: (value: unknown) => void;
    const json = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mocks.fetch.mockResolvedValue({ ok: true, json });
    const outcome = invoke(provider, method, { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(json).toHaveBeenCalledOnce();
    controller.abort(reason);
    finish(payload);
    expect(await outcome).toBe(reason);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expectClean(controller.signal);
  });

  const deadlines = [
    { label: "override", configured: 500, override: 17, deadline: 17 },
    { label: "config", configured: 29, override: undefined, deadline: 29 },
    { label: "default", configured: undefined, override: undefined, deadline: 120000 },
  ];
  it.each(methods.flatMap((method) => deadlines.map((item) => ({ method, ...item }))))(
    "$method enforces $label deadline while fetch is pending",
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

  it.each(methods)("%s explicit timeout zero disables its configured deadline", async (method) => {
    const provider = await providerFor(5);
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
    finish(successfulResponse(method));
    await pending;
    expect(owned.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(chats)("%s total deadline covers retry backoff", async (method) => {
    const provider = await providerFor();
    let owned!: AbortSignal;
    mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
      owned = options.signal as AbortSignal;
      throw new Error("503 fixture unavailable");
    });
    const outcome = invoke(provider, method, { timeout: 19, maxRetries: 3 }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(19);
    expect(await outcome).toBe(owned.reason);
    await vi.advanceTimersByTimeAsync(20000);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Vertex stream reader ownership", () => {
  it("deadline between tool start and end cancels and releases the reader", async () => {
    const provider = await providerFor();
    const fixture = readerFixture({
      candidates: [{ content: { parts: [{ functionCall: { name: "fixture_tool", args: {} } }] } }],
    });
    let owned!: AbortSignal;
    mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
      owned = options.signal as AbortSignal;
      return fixture.response;
    });
    const iterator = iteratorFor(provider, "streamWithTools", { timeout: 11 });
    expect((await iterator.next()).value).toMatchObject({ type: "tool_use_start" });
    await vi.advanceTimersByTimeAsync(11);
    await expect(iterator.next()).rejects.toBe(owned.reason);
    expect(fixture.reader.read).toHaveBeenCalledOnce();
    expect(fixture.reader.cancel).toHaveBeenCalledOnce();
    expect(fixture.reader.releaseLock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(
    streams.flatMap((method) =>
      ["success", "read error", "early return"].map((ending) => ({ method, ending })),
    ),
  )("$method cancels and releases reader on $ending", async ({ method, ending }) => {
    const provider = await providerFor();
    const controller = new AbortController();
    const fixture = readerFixture();
    const failure = new Error("fixture reader failure");
    if (ending === "read error") fixture.reader.read.mockReset().mockRejectedValue(failure);
    mocks.fetch.mockResolvedValue(fixture.response);
    if (ending === "early return") {
      const iterator = iteratorFor(provider, method, { signal: controller.signal });
      expect((await iterator.next()).value).toMatchObject({ type: "text" });
      await iterator.return?.();
      expect(fixture.reader.read).toHaveBeenCalledOnce();
    } else if (ending === "read error") {
      await expect(invoke(provider, method, { signal: controller.signal })).rejects.toThrow(
        /fixture reader failure/,
      );
    } else {
      const seen: StreamChunk[] = [];
      await invoke(provider, method, { signal: controller.signal }, seen);
      expect(seen.at(-1)).toMatchObject({ type: "done" });
    }
    expect(fixture.reader.cancel).toHaveBeenCalledOnce();
    expect(fixture.reader.releaseLock).toHaveBeenCalledOnce();
    expectClean(controller.signal);
  });

  it.each(streams)("%s canceled EOF does not emit done", async (method) => {
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

  it.each([
    { method: "stream" as const, first: "text", parts: [{ text: "first" }, { text: "second" }] },
    {
      method: "streamWithTools" as const,
      first: "text",
      parts: [{ text: "first" }, { functionCall: { name: "fixture_tool", args: {} } }],
    },
    {
      method: "streamWithTools" as const,
      first: "tool_use_start",
      parts: [{ functionCall: { name: "fixture_tool", args: {} } }],
    },
  ])(
    "$method abort after $first blocks same-chunk emissions and any new read",
    async ({ method, first, parts }) => {
      const provider = await providerFor();
      const controller = new AbortController();
      const fixture = readerFixture({ candidates: [{ content: { parts }, finishReason: "STOP" }] });
      mocks.fetch.mockResolvedValue(fixture.response);
      const iterator = iteratorFor(provider, method, { signal: controller.signal });
      expect((await iterator.next()).value).toMatchObject({ type: first });
      const reason = new Error("between emissions");
      controller.abort(reason);
      await expect(iterator.next()).rejects.toBe(reason);
      expect(fixture.reader.read).toHaveBeenCalledOnce();
      expect(fixture.reader.cancel).toHaveBeenCalledOnce();
      expect(fixture.reader.releaseLock).toHaveBeenCalledOnce();
      expectClean(controller.signal);
    },
  );
});
