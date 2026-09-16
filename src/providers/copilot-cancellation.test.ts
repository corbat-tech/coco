import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotProvider } from "./copilot.js";
import type { ChatOptions, StreamChunk } from "./types.js";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), create: vi.fn(), constructor: vi.fn() }));
vi.mock("../auth/copilot.js", () => ({ getValidCopilotToken: mocks.auth }));
vi.mock("openai", () => {
  class APIError extends Error {
    status?: number;
  }
  const OpenAI = Object.assign(
    vi.fn(function (options: unknown) {
      mocks.constructor(options);
      return { chat: { completions: { create: mocks.create } }, models: { list: vi.fn() } };
    }),
    { APIError },
  );
  return { default: OpenAI, APIError };
});
const methods = ["chat", "chatWithTools", "stream", "streamWithTools"] as const;
type Method = (typeof methods)[number];
const streams = ["stream", "streamWithTools"] as const;
const messages = [{ role: "user" as const, content: "fixture" }];
const token = { token: "fixture-copilot", baseUrl: "https://fixture.invalid", isNew: false };
const response = {
  id: "fixture",
  model: "gpt-4o",
  choices: [{ message: { content: "fixture", tool_calls: [] }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
};
const chunk = { choices: [{ delta: { content: "fixture" }, finish_reason: null }] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function providerFor(timeout?: number) {
  const provider = new CopilotProvider();
  await provider.initialize({ model: "gpt-4o", ...(timeout === undefined ? {} : { timeout }) });
  mocks.auth.mockClear();
  mocks.constructor.mockClear();
  return provider;
}
function iteratorFor(
  provider: CopilotProvider,
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
  provider: CopilotProvider,
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
function sdkSuccess(method: Method) {
  mocks.create.mockImplementation(async () =>
    method.startsWith("stream")
      ? Object.assign(
          (async function* () {
            yield chunk;
          })(),
          { controller: new AbortController() },
        )
      : response,
  );
}
function clean(signal: AbortSignal) {
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.auth.mockReset().mockResolvedValue(token);
  mocks.create.mockReset();
  mocks.constructor.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Copilot request scopes", () => {
  it.each(methods)("%s pre-abort bypasses refresh and SDK", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    controller.abort(new Error("fixture preabort"));
    await expect(invoke(provider, method, { signal: controller.signal })).rejects.toBe(
      controller.signal.reason,
    );
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    clean(controller.signal);
  });

  it.each(methods)("%s forwards an owned SDK signal and disables SDK retries", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    sdkSuccess(method);
    await invoke(provider, method, { signal: controller.signal });
    const sdkOptions = mocks.create.mock.calls[0]?.[1] as {
      signal: AbortSignal;
      maxRetries: number;
    };
    expect(sdkOptions.signal).toBeInstanceOf(AbortSignal);
    expect(sdkOptions.signal).not.toBe(controller.signal);
    expect(sdkOptions.maxRetries).toBe(0);
    expect(sdkOptions.signal.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    clean(controller.signal);
  });

  it.each(methods)("%s abort after auth prevents SDK dispatch", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    const reason = new Error("auth completed after cancellation");
    mocks.auth.mockImplementation(async () => {
      controller.abort(reason);
      return token;
    });
    await expect(invoke(provider, method, { signal: controller.signal })).rejects.toBe(reason);
    expect(mocks.create).not.toHaveBeenCalled();
    clean(controller.signal);
  });

  const deadlines = [
    { configured: 5000, override: 13, deadline: 13 },
    { configured: 23, override: undefined, deadline: 23 },
    { configured: undefined, override: undefined, deadline: 120000 },
  ];
  it.each(methods.flatMap((method) => deadlines.map((value) => ({ method, ...value }))))(
    "$method deadline $deadline includes pending authentication",
    async ({ method, configured, override, deadline }) => {
      const provider = await providerFor(configured);
      let shared!: AbortSignal;
      mocks.auth.mockImplementation((signal: AbortSignal) => {
        shared = signal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      });
      const outcome = invoke(
        provider,
        method,
        override === undefined ? {} : { timeout: override },
      ).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(deadline - 1);
      expect(shared.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await outcome;
      expect(String(error)).toMatch(/timeout|timed out/i);
      expect(shared.aborted).toBe(true);
      expect(mocks.create).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("timeout zero keeps a slow refresh alive despite configured deadline", async () => {
    const provider = await providerFor(3);
    const refresh = deferred<typeof token>();
    let shared!: AbortSignal;
    mocks.auth.mockImplementation((signal: AbortSignal) => {
      shared = signal;
      return refresh.promise;
    });
    sdkSuccess("chat");
    const pending = provider.chat(messages, { timeout: 0 });
    await vi.advanceTimersByTimeAsync(120001);
    expect(shared.aborted).toBe(false);
    refresh.resolve(token);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("total deadline is not reset when authentication finishes", async () => {
    const provider = await providerFor();
    const refresh = deferred<typeof token>();
    mocks.auth.mockReturnValue(refresh.promise);
    let transport!: AbortSignal;
    mocks.create.mockImplementation((_body: unknown, options: { signal: AbortSignal }) => {
      transport = options.signal;
      return new Promise((_resolve, reject) =>
        transport.addEventListener("abort", () => reject(transport.reason), { once: true }),
      );
    });
    const outcome = provider.chat(messages, { timeout: 13 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(8);
    refresh.resolve(token);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.create).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5);
    expect(await outcome).toBe(transport.reason);
    expect(String(transport.reason)).toMatch(/timeout|timed out/i);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Copilot shared refresh consumer isolation", () => {
  it("a canceled newcomer still observes the closing flight's persistence failure", async () => {
    const provider = await providerFor();
    const persistence = deferred<typeof token>();
    mocks.auth.mockReturnValue(persistence.promise);
    const first = new AbortController();
    const newcomer = new AbortController();
    const originalResult = provider
      .chat(messages, { signal: first.signal })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    first.abort(new Error("original canceled during persistence"));
    const newcomerResult = provider
      .chat(messages, { signal: newcomer.signal })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    newcomer.abort(new Error("newcomer canceled during persistence"));
    const failure = Object.assign(new Error("fixture persistence failed"), { code: "ENOSPC" });
    persistence.reject(failure);
    expect(await originalResult).toBe(failure);
    expect(await newcomerResult).toBe(failure);
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    clean(first.signal);
    clean(newcomer.signal);
  });

  it.each(["abort", "deadline"] as const)(
    "one caller's %s leaves the other consumer's refresh alive",
    async (cause) => {
      const provider = await providerFor();
      const refresh = deferred<typeof token>();
      let shared!: AbortSignal;
      mocks.auth.mockImplementation((signal: AbortSignal) => {
        shared = signal;
        return refresh.promise;
      });
      sdkSuccess("chat");
      const first = new AbortController();
      const second = new AbortController();
      const canceled = provider
        .chat(messages, { signal: first.signal, timeout: cause === "deadline" ? 7 : 1000 })
        .catch((error: unknown) => error);
      const survivor = provider.chat(messages, { signal: second.signal, timeout: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.auth).toHaveBeenCalledOnce();
      expect(shared).not.toBe(first.signal);
      expect(shared).not.toBe(second.signal);
      if (cause === "abort") first.abort(new Error("one consumer canceled"));
      else await vi.advanceTimersByTimeAsync(7);
      const error = await canceled;
      if (cause === "abort") expect(error).toBe(first.signal.reason);
      else expect(String(error)).toMatch(/timeout|timed out/i);
      expect(shared.aborted).toBe(false);
      refresh.resolve(token);
      await expect(survivor).resolves.toMatchObject({ content: "fixture" });
      expect(mocks.create).toHaveBeenCalledOnce();
      clean(first.signal);
      clean(second.signal);
    },
  );

  it("last canceled consumer aborts shared auth and ignores its late client update", async () => {
    const provider = await providerFor();
    const refresh = deferred<typeof token>();
    let shared!: AbortSignal;
    mocks.auth.mockImplementation((signal: AbortSignal) => {
      shared = signal;
      return refresh.promise;
    });
    const first = new AbortController();
    const second = new AbortController();
    const a = provider.chat(messages, { signal: first.signal }).catch((error: unknown) => error);
    const b = provider.chat(messages, { signal: second.signal }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    first.abort(new Error("first canceled"));
    await a;
    expect(shared.aborted).toBe(false);
    second.abort(new Error("last canceled"));
    expect(shared.aborted).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    refresh.resolve({ ...token, token: "fixture-stale-late-token", isNew: true });
    expect(await b).toBe(second.signal.reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.constructor).not.toHaveBeenCalled();
    clean(first.signal);
    clean(second.signal);
    mocks.auth.mockResolvedValue(token);
    sdkSuccess("chat");
    await expect(provider.chat(messages)).resolves.toMatchObject({ content: "fixture" });
    expect(mocks.auth).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("last cancellation waits for persistence and exposes its ENOSPC failure", async () => {
    const provider = await providerFor();
    const persistence = deferred<typeof token>();
    const controller = new AbortController();
    let shared!: AbortSignal;
    mocks.auth.mockImplementation((signal: AbortSignal) => {
      shared = signal;
      return persistence.promise;
    });
    let settled = false;
    const outcome = provider
      .chat(messages, { signal: controller.signal })
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("last caller canceled"));
    await vi.advanceTimersByTimeAsync(0);
    expect(shared.aborted).toBe(true);
    expect(settled).toBe(false);
    const failure = Object.assign(new Error("fixture persistence failed"), { code: "ENOSPC" });
    persistence.reject(failure);
    expect(await outcome).toBe(failure);
    expect(mocks.create).not.toHaveBeenCalled();
    clean(controller.signal);
  });

  it.each(["persistence failure", "cancellation"] as const)(
    "new caller waits for the canceled auth flight's %s before deciding whether to refresh",
    async (ending) => {
      const provider = await providerFor();
      const oldFlight = deferred<typeof token>();
      const controller = new AbortController();
      let shared!: AbortSignal;
      mocks.auth
        .mockImplementationOnce((signal: AbortSignal) => {
          shared = signal;
          return oldFlight.promise;
        })
        .mockResolvedValue(token);
      sdkSuccess("chat");
      const canceled = provider
        .chat(messages, { signal: controller.signal })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      controller.abort(new Error("old caller canceled"));
      let newcomerSettled = false;
      const newcomer = provider
        .chat(messages)
        .catch((error: unknown) => error)
        .finally(() => {
          newcomerSettled = true;
        });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.auth).toHaveBeenCalledOnce();
      expect(newcomerSettled).toBe(false);
      expect(mocks.create).not.toHaveBeenCalled();
      const failure =
        ending === "cancellation"
          ? shared.reason
          : Object.assign(new Error("fixture persistence failed"), { code: "ENOSPC" });
      oldFlight.reject(failure);
      expect(await canceled).toBe(failure);
      if (ending === "persistence failure") {
        expect(await newcomer).toBe(failure);
        expect(mocks.auth).toHaveBeenCalledOnce();
        expect(mocks.create).not.toHaveBeenCalled();
      } else {
        expect(await newcomer).toMatchObject({ content: "fixture" });
        expect(mocks.auth).toHaveBeenCalledTimes(2);
        expect(mocks.create).toHaveBeenCalledOnce();
      }
      clean(controller.signal);
    },
  );

  it("concurrent null refresh preserves initialized direct API token behavior", async () => {
    mocks.auth.mockResolvedValue(null);
    const provider = new CopilotProvider();
    await provider.initialize({ apiKey: "fixture-direct-token", model: "gpt-4o" });
    mocks.auth.mockClear();
    const refresh = deferred<null>();
    mocks.auth.mockReturnValue(refresh.promise);
    sdkSuccess("chat");
    const first = provider.chat(messages);
    const second = provider.chat(messages);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.auth).toHaveBeenCalledOnce();
    refresh.resolve(null);
    await Promise.all([first, second]);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Copilot stream and setup lifetime", () => {
  it("initialize preserves a persistence failure arriving after its deadline", async () => {
    const provider = new CopilotProvider();
    const persistence = deferred<typeof token>();
    let signal!: AbortSignal;
    mocks.auth.mockImplementation((owned: AbortSignal) => {
      signal = owned;
      return persistence.promise;
    });
    const outcome = provider
      .initialize({ model: "gpt-4o", timeout: 17 })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(17);
    expect(signal.aborted).toBe(true);
    const failure = Object.assign(new Error("fixture initialization persistence failed"), {
      code: "ENOSPC",
    });
    persistence.reject(failure);
    expect(await outcome).toBe(failure);
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(streams.flatMap((method) => ["abort", "return"].map((ending) => ({ method, ending }))))(
    "$method $ending after text closes upstream without another emission",
    async ({ method, ending }) => {
      const provider = await providerFor();
      const controller = new AbortController();
      const advanced = vi.fn();
      const cleanup = vi.fn();
      mocks.create.mockResolvedValue(
        Object.assign(
          (async function* () {
            try {
              yield chunk;
              advanced();
              yield { choices: [{ delta: {}, finish_reason: "stop" }] };
            } finally {
              cleanup();
            }
          })(),
          { controller: new AbortController() },
        ),
      );
      const iterator = iteratorFor(provider, method, { signal: controller.signal });
      expect((await iterator.next()).value).toMatchObject({ type: "text" });
      if (ending === "abort") {
        controller.abort(new Error("stream canceled"));
        await expect(iterator.next()).rejects.toBe(controller.signal.reason);
      } else await iterator.return?.();
      expect(advanced).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledOnce();
      clean(controller.signal);
    },
  );

  it.each(["initialize", "isAvailable"] as const)(
    "%s uses a bounded auth signal",
    async (operation) => {
      const provider = operation === "initialize" ? new CopilotProvider() : await providerFor(17);
      let signal!: AbortSignal;
      mocks.auth.mockImplementation((owned: AbortSignal) => {
        signal = owned;
        return new Promise((_resolve, reject) =>
          owned.addEventListener("abort", () => reject(owned.reason), { once: true }),
        );
      });
      const outcome = (
        operation === "initialize"
          ? provider.initialize({ model: "gpt-4o", timeout: 17 })
          : provider.isAvailable()
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await vi.advanceTimersByTimeAsync(16);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const result = await outcome;
      expect(signal.aborted).toBe(true);
      if (operation === "initialize") {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe(signal.reason);
      } else {
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(false);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
