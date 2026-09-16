import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "./gemini.js";
import type { ChatOptions, StreamChunk } from "./types.js";

const sdk = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn(), constructor: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function (options: unknown) {
    sdk.constructor(options);
    return { models: { generateContent: sdk.create, generateContentStream: sdk.stream } };
  }),
  FunctionCallingConfigMode: { AUTO: "AUTO", ANY: "ANY" },
}));
const methods = ["chat", "chatWithTools", "stream", "streamWithTools"] as const;
type Method = (typeof methods)[number];
const streaming = ["stream", "streamWithTools"] as const;
const messages = [{ role: "user" as const, content: "fixture" }];
const response = {
  text: "fixture",
  candidates: [{ finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
};
type Request = { config: { abortSignal: AbortSignal; httpOptions: unknown } };
function callFor(method: Method) {
  return method.startsWith("stream") ? sdk.stream : sdk.create;
}
async function providerFor(timeout?: number) {
  const provider = new GeminiProvider();
  await provider.initialize({
    apiKey: "fixture-not-a-real-key",
    model: "gemini-2.5-flash",
    ...(timeout === undefined ? {} : { timeout }),
  });
  return provider;
}
function iteratorFor(
  provider: GeminiProvider,
  method: (typeof streaming)[number],
  options: ChatOptions,
) {
  return (
    method === "stream"
      ? provider.stream(messages, options)
      : provider.streamWithTools(messages, { ...options, tools: [] })
  )[Symbol.asyncIterator]();
}
async function invoke(
  provider: GeminiProvider,
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
function successFor(method: Method) {
  return method.startsWith("stream")
    ? (async function* () {
        yield response;
      })()
    : response;
}
beforeEach(() => {
  vi.useFakeTimers();
  sdk.create.mockReset();
  sdk.stream.mockReset();
  sdk.constructor.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Gemini per-call cancellation scope", () => {
  it("initializes the SDK with the configured base URL and one attempt", async () => {
    const provider = new GeminiProvider();
    await provider.initialize({
      apiKey: "fixture-not-a-real-key",
      baseUrl: "http://127.0.0.1:12345",
    });
    expect(sdk.constructor).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          baseUrl: "http://127.0.0.1:12345",
          retryOptions: { attempts: 1 },
        }),
      }),
    );
  });
  it.each(methods)("%s pre-abort prevents SDK calls and leaves no resources", async (method) => {
    const controller = new AbortController();
    const reason = new Error("fixture canceled");
    controller.abort(reason);
    await expect(invoke(await providerFor(), method, { signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(sdk.create).not.toHaveBeenCalled();
    expect(sdk.stream).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(methods)(
    "%s gives SDK a linked owned signal and disables SDK timers/retries",
    async (method) => {
      const controller = new AbortController();
      let owned!: AbortSignal;
      callFor(method).mockImplementation(async ({ config }: Request) => {
        owned = config.abortSignal;
        expect(owned).not.toBe(controller.signal);
        expect(owned.aborted).toBe(false);
        expect(config.httpOptions).toEqual({ timeout: 0, retryOptions: { attempts: 1 } });
        return successFor(method);
      });
      await invoke(await providerFor(), method, { signal: controller.signal });
      expect(owned.aborted).toBe(true);
      expect(controller.signal.aborted).toBe(false);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(methods)(
    "%s never delivers a late successful SDK response after host abort",
    async (method) => {
      const controller = new AbortController();
      const reason = new Error("host cancellation reason");
      let owned!: AbortSignal;
      callFor(method).mockImplementation(async ({ config }: Request) => {
        owned = config.abortSignal;
        controller.abort(reason);
        expect(owned.aborted).toBe(true);
        expect(owned.reason).toBe(reason);
        return successFor(method);
      });
      const seen: StreamChunk[] = [];
      await expect(
        invoke(await providerFor(), method, { signal: controller.signal }, seen),
      ).rejects.toBe(reason);
      expect(seen).toEqual([]);
      expect(callFor(method)).toHaveBeenCalledOnce();
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  const deadlines = [
    { label: "call override", configured: 9000, override: 23, deadline: 23 },
    { label: "configuration", configured: 41, override: undefined, deadline: 41 },
    { label: "default", configured: undefined, override: undefined, deadline: 120000 },
  ];
  it.each(methods.flatMap((method) => deadlines.map((deadline) => ({ method, ...deadline }))))(
    "$method uses $label deadline and preserves its abort reason",
    async ({ method, configured, override, deadline }) => {
      const controller = new AbortController();
      let owned!: AbortSignal;
      callFor(method).mockImplementation(({ config }: Request) => {
        owned = config.abortSignal;
        return new Promise((_resolve, reject) => {
          owned.addEventListener("abort", () => reject(owned.reason), { once: true });
        });
      });
      const provider = await providerFor(configured);
      const outcome = invoke(provider, method, {
        signal: controller.signal,
        ...(override === undefined ? {} : { timeout: override }),
      }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await vi.advanceTimersByTimeAsync(deadline - 1);
      expect(owned.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const result = await outcome;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(owned.reason);
        expect(String(result.error)).toMatch(/timeout|timed out/i);
      }
      expect(controller.signal.aborted).toBe(false);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(
    streaming.flatMap((method) => [false, true].map((extraEvent) => ({ method, extraEvent }))),
  )("$method rejects canceled EOF or late event ($extraEvent)", async ({ method, extraEvent }) => {
    const controller = new AbortController();
    const reason = new Error("canceled upstream");
    sdk.stream.mockResolvedValue(
      (async function* () {
        controller.abort(reason);
        if (extraEvent) yield response;
      })(),
    );
    const seen: StreamChunk[] = [];
    await expect(
      invoke(await providerFor(), method, { signal: controller.signal }, seen),
    ).rejects.toBe(reason);
    expect(seen).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it.each(streaming)(
    "%s stops on resume without requesting another upstream chunk",
    async (method) => {
      const controller = new AbortController();
      const advanced = vi.fn();
      const cleanup = vi.fn();
      sdk.stream.mockResolvedValue(
        (async function* () {
          try {
            yield response;
            advanced();
            yield response;
          } finally {
            cleanup();
          }
        })(),
      );
      const iterator = iteratorFor(await providerFor(), method, { signal: controller.signal });
      expect((await iterator.next()).value).toMatchObject({ type: "text" });
      const reason = new Error("resume abort");
      controller.abort(reason);
      await expect(iterator.next()).rejects.toBe(reason);
      expect(advanced).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    },
  );

  it.each(["text", "tool_use_start"] as const)(
    "checks abort after %s before remaining emissions from the same chunk",
    async (firstEmission) => {
      const controller = new AbortController();
      const advanced = vi.fn();
      const cleanup = vi.fn();
      sdk.stream.mockResolvedValue(
        (async function* () {
          try {
            yield {
              ...(firstEmission === "text" ? { text: "fixture" } : {}),
              functionCalls: [
                { id: "call-1", name: "fixture_tool", args: {} },
                { id: "call-2", name: "fixture_tool", args: {} },
              ],
            };
            advanced();
          } finally {
            cleanup();
          }
        })(),
      );
      const iterator = iteratorFor(await providerFor(), "streamWithTools", {
        signal: controller.signal,
      });
      expect((await iterator.next()).value).toMatchObject({ type: firstEmission });
      const reason = new Error("same chunk abort");
      controller.abort(reason);
      await expect(iterator.next()).rejects.toBe(reason);
      expect(advanced).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(streaming)(
    "%s consumer return aborts owned body and releases host listener/timer",
    async (method) => {
      const controller = new AbortController();
      const hostListener = vi.fn();
      controller.signal.addEventListener("abort", hostListener);
      const cleanup = vi.fn();
      let owned!: AbortSignal;
      sdk.stream.mockImplementation(async ({ config }: Request) => {
        owned = config.abortSignal;
        return (async function* () {
          try {
            yield response;
            yield response;
          } finally {
            cleanup();
          }
        })();
      });
      const iterator = iteratorFor(await providerFor(), method, { signal: controller.signal });
      await iterator.next();
      expect(owned.aborted).toBe(false);
      await iterator.return?.();
      expect(owned.aborted).toBe(true);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(getEventListeners(controller.signal, "abort")).toEqual([hostListener]);
      expect(hostListener).not.toHaveBeenCalled();
      controller.signal.removeEventListener("abort", hostListener);
    },
  );

  it("checks deadline between tool start and end within one chunk", async () => {
    let owned!: AbortSignal;
    const cleanup = vi.fn();
    sdk.stream.mockImplementation(async ({ config }: Request) => {
      owned = config.abortSignal;
      return (async function* () {
        try {
          yield { functionCalls: [{ id: "call-1", name: "fixture_tool", args: {} }] };
        } finally {
          cleanup();
        }
      })();
    });
    const iterator = iteratorFor(await providerFor(), "streamWithTools", { timeout: 13 });
    expect((await iterator.next()).value).toMatchObject({ type: "tool_use_start" });
    await vi.advanceTimersByTimeAsync(13);
    expect(owned.aborted).toBe(true);
    await expect(iterator.next()).rejects.toBe(owned.reason);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Gemini retry budget within the total request deadline", () => {
  const chats = ["chat", "chatWithTools"] as const;
  it.each(
    chats.flatMap((method) => [0, 1, undefined].map((maxRetries) => ({ method, maxRetries }))),
  )("$method honors additional retry budget $maxRetries", async ({ method, maxRetries }) => {
    sdk.create.mockRejectedValue(new Error("503 fixture unavailable"));
    const provider = await providerFor();
    const outcome = invoke(provider, method, maxRetries === undefined ? {} : { maxRetries }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    // The default three waits, including jitter, finish well before 20 seconds.
    await vi.advanceTimersByTimeAsync(20000);
    expect((await outcome).ok).toBe(false);
    expect(sdk.create).toHaveBeenCalledTimes(1 + (maxRetries ?? 3));
    for (const [request] of sdk.create.mock.calls) {
      expect((request as Request).config.httpOptions).toEqual({
        timeout: 0,
        retryOptions: { attempts: 1 },
      });
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(chats)("%s host abort during backoff prevents another SDK request", async (method) => {
    const controller = new AbortController();
    sdk.create.mockRejectedValue(new Error("503 fixture unavailable"));
    const provider = await providerFor();
    const outcome = invoke(provider, method, { signal: controller.signal, maxRetries: 3 }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(sdk.create).toHaveBeenCalledOnce();
    const reason = new Error("abort while waiting for retry");
    controller.abort(reason);
    const result = await outcome;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(reason);
    await vi.advanceTimersByTimeAsync(20000);
    expect(sdk.create).toHaveBeenCalledOnce();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(chats)(
    "%s total deadline expires during backoff without restarting the request",
    async (method) => {
      let owned!: AbortSignal;
      sdk.create.mockImplementation(({ config }: Request) => {
        owned = config.abortSignal;
        return Promise.reject(new Error("503 fixture unavailable"));
      });
      const provider = await providerFor();
      const outcome = invoke(provider, method, { timeout: 17, maxRetries: 3 }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await vi.advanceTimersByTimeAsync(17);
      const result = await outcome;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(owned.reason);
      expect(owned.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(20000);
      expect(sdk.create).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(methods)("%s timeout zero disables the configured deadline", async (method) => {
    let complete!: (value: ReturnType<typeof successFor>) => void;
    let owned!: AbortSignal;
    callFor(method).mockImplementation(({ config }: Request) => {
      owned = config.abortSignal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const provider = await providerFor(7);
    const pending = invoke(provider, method, { timeout: 0 });
    await vi.advanceTimersByTimeAsync(120001);
    expect(owned.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    complete(successFor(method));
    await pending;
    expect(owned.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(
    methods.flatMap((method) =>
      [-1, NaN, Infinity, 2147483648].map((timeout) => ({ method, timeout })),
    ),
  )("$method rejects invalid timeout $timeout before SDK dispatch", async ({ method, timeout }) => {
    const controller = new AbortController();
    await expect(
      invoke(await providerFor(), method, { timeout, signal: controller.signal }),
    ).rejects.toThrow(/timeout/i);
    expect(sdk.create).not.toHaveBeenCalled();
    expect(sdk.stream).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
