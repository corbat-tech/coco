import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderFallback } from "./fallback.js";
import { ResilientProvider } from "./resilient.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import type { LLMProvider, StreamChunk } from "./types.js";

const methods = ["chat", "chatWithTools", "stream", "streamWithTools"] as const;
type Method = (typeof methods)[number];
type Kind = "fallback" | "resilient";
const matrix = (["fallback", "resilient"] as const).flatMap((kind) =>
  methods.map((method) => ({ kind, method })),
);
const response = {
  id: "fixture",
  content: "fixture",
  model: "fixture",
  stopReason: "end_turn",
  usage: { inputTokens: 1, outputTokens: 1 },
  toolCalls: [],
};
const messages = [{ role: "user" as const, content: "fixture" }];

function provider(id: string) {
  return {
    id,
    name: id,
    initialize: vi.fn(),
    countTokens: vi.fn(() => 1),
    getContextWindow: vi.fn(() => 1000),
    isAvailable: vi.fn(async () => true),
    chat: vi.fn(async () => response),
    chatWithTools: vi.fn(async () => response),
    stream: vi.fn<() => AsyncIterable<StreamChunk>>(() =>
      (async function* () {
        yield { type: "done" as const };
      })(),
    ),
    streamWithTools: vi.fn<() => AsyncIterable<StreamChunk>>(() =>
      (async function* () {
        yield { type: "done" as const };
      })(),
    ),
  };
}
function fixture(kind: Kind, failureThreshold = 1) {
  const primary = provider("primary");
  const secondary = provider("secondary");
  const circuitBreaker = { failureThreshold, resetTimeout: 1000, halfOpenRequests: 1 };
  const retry = { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 100, jitterFactor: 0 };
  const wrapper =
    kind === "fallback"
      ? new ProviderFallback([primary, secondary] as unknown as LLMProvider[], { circuitBreaker })
      : new ResilientProvider(primary as unknown as LLMProvider, {
          circuitBreaker,
          retry,
          streamRetry: retry,
        });
  return { primary, secondary, wrapper };
}
async function invoke(
  wrapper: LLMProvider,
  method: Method,
  signal?: AbortSignal,
  seen: StreamChunk[] = [],
) {
  if (method === "chat") return wrapper.chat(messages, { signal });
  if (method === "chatWithTools") return wrapper.chatWithTools(messages, { signal, tools: [] });
  const stream =
    method === "stream"
      ? wrapper.stream(messages, { signal })
      : wrapper.streamWithTools(messages, { signal, tools: [] });
  for await (const chunk of stream) seen.push(chunk);
  return seen;
}
function fail(primary: ReturnType<typeof provider>, method: Method, error: Error) {
  if (method === "stream" || method === "streamWithTools")
    primary[method].mockImplementation(() =>
      // eslint-disable-next-line require-yield -- models a stream failing before its first event
      (async function* () {
        throw error;
      })(),
    );
  else primary[method].mockRejectedValue(error);
}
function expectUnaffected(wrapper: ProviderFallback | ResilientProvider) {
  if (wrapper instanceof ProviderFallback) {
    expect(
      wrapper
        .getCircuitStatus()
        .every((status) => status.state === "closed" && status.failureCount === 0),
    ).toBe(true);
  } else expect(wrapper.getCircuitState()).toBe("closed");
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("provider wrapper cancellation", () => {
  it.each(matrix)(
    "$kind $method pre-abort does not invoke either provider",
    async ({ kind, method }) => {
      const { wrapper, primary, secondary } = fixture(kind);
      const controller = new AbortController();
      controller.abort();
      await expect(invoke(wrapper, method, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(primary[method]).not.toHaveBeenCalled();
      expect(secondary[method]).not.toHaveBeenCalled();
      expectUnaffected(wrapper);
    },
  );

  it.each(matrix)(
    "$kind $method does not retry/fallback or penalize named cancellation",
    async ({ kind, method }) => {
      for (const name of ["AbortError", "APIUserAbortError"]) {
        const { wrapper, primary, secondary } = fixture(kind);
        const error = Object.assign(new Error("429 request canceled"), { name });
        fail(primary, method, error);
        const assertion = expect(invoke(wrapper, method)).rejects.toBe(error);
        await vi.runAllTimersAsync();
        await assertion;
        expect(primary[method]).toHaveBeenCalledTimes(1);
        expect(secondary[method]).not.toHaveBeenCalled();
        expectUnaffected(wrapper);
      }
    },
  );

  it.each(matrix)(
    "$kind $method discards a late successful result and preserves signal.reason",
    async ({ kind, method }) => {
      const { wrapper, primary, secondary } = fixture(kind);
      const controller = new AbortController();
      const reason = new Error("host requested stop");
      if (method === "stream" || method === "streamWithTools")
        primary[method].mockImplementation(() =>
          (async function* () {
            controller.abort(reason);
            yield { type: "done" as const };
          })(),
        );
      else
        primary[method].mockImplementation(async () => {
          controller.abort(reason);
          return response;
        });
      const seen: StreamChunk[] = [];
      await expect(invoke(wrapper, method, controller.signal, seen)).rejects.toBe(reason);
      expect(seen).toEqual([]);
      expect(primary[method]).toHaveBeenCalledTimes(1);
      expect(secondary[method]).not.toHaveBeenCalled();
      expectUnaffected(wrapper);
    },
  );

  it.each(
    (["fallback", "resilient"] as const).flatMap((kind) =>
      (["stream", "streamWithTools"] as const).map((method) => ({ kind, method })),
    ),
  )("$kind $method never restarts after any emitted chunk", async ({ kind, method }) => {
    const chunks: StreamChunk[] = [
      { type: "text", text: "partial" },
      { type: "tool_use_start", toolCall: { id: "call", name: "fixture" } },
      { type: "done" },
    ];
    for (const first of chunks) {
      const { wrapper, primary, secondary } = fixture(kind, 3);
      primary[method].mockImplementation(() =>
        (async function* () {
          yield first;
          throw new Error("503 after output");
        })(),
      );
      const seen: StreamChunk[] = [];
      const assertion = expect(invoke(wrapper, method, undefined, seen)).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;
      expect(seen).toEqual([first]);
      expect(primary[method]).toHaveBeenCalledTimes(1);
      expect(secondary[method]).not.toHaveBeenCalled();
    }
  });

  it.each(["stream", "streamWithTools"] as const)(
    "resilient %s cancellation interrupts backoff without another provider call",
    async (method) => {
      const { wrapper, primary } = fixture("resilient", 3);
      fail(primary, method, new Error("503 before first output"));
      const controller = new AbortController();
      const assertion = expect(invoke(wrapper, method, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      controller.abort();
      await vi.runAllTimersAsync();
      await assertion;
      expect(primary[method]).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect((wrapper as ResilientProvider).getCircuitState()).toBe("closed");
    },
  );

  it.each(
    (["fallback", "resilient"] as const).flatMap((kind) =>
      (["stream", "streamWithTools"] as const).map((method) => ({ kind, method })),
    ),
  )(
    "$kind $method stops before asking an aborted upstream for another chunk",
    async ({ kind, method }) => {
      const { wrapper, primary, secondary } = fixture(kind);
      const controller = new AbortController();
      const continued = vi.fn();
      const cleaned = vi.fn();
      primary[method].mockImplementation(() =>
        (async function* () {
          try {
            yield { type: "text" as const, text: "first" };
            continued();
            yield { type: "done" as const };
          } finally {
            cleaned();
          }
        })(),
      );
      const stream =
        method === "stream"
          ? wrapper.stream(messages, { signal: controller.signal })
          : wrapper.streamWithTools(messages, { signal: controller.signal, tools: [] });
      const iterator = stream[Symbol.asyncIterator]();
      try {
        expect((await iterator.next()).value).toMatchObject({ type: "text", text: "first" });
        controller.abort();
        await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
        expect(continued).not.toHaveBeenCalled();
        expect(cleaned).toHaveBeenCalledTimes(1);
        expect(secondary[method]).not.toHaveBeenCalled();
        expectUnaffected(wrapper);
      } finally {
        await iterator.return?.();
      }
    },
  );

  it.each(matrix)(
    "$kind $method still recovers from a genuine failure before output",
    async ({ kind, method }) => {
      const { wrapper, primary, secondary } = fixture(kind, 3);
      if (method === "stream" || method === "streamWithTools")
        primary[method].mockImplementationOnce(() =>
          // eslint-disable-next-line require-yield -- models a stream failing before its first event
          (async function* () {
            throw new Error("503 transient");
          })(),
        );
      else primary[method].mockRejectedValueOnce(new Error("503 transient"));
      const pending = invoke(wrapper, method);
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeDefined();
      expect(primary[method]).toHaveBeenCalledTimes(kind === "resilient" ? 2 : 1);
      expect(secondary[method]).toHaveBeenCalledTimes(kind === "fallback" ? 1 : 0);
    },
  );
});

describe("CircuitBreaker cancellation is neither a success nor a failure", () => {
  it.each(["AbortError", "APIUserAbortError", "late success"])(
    "leaves half-open state unchanged for %s",
    async (variant) => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 1000,
        halfOpenRequests: 1,
      });
      await expect(
        breaker.execute(async () => {
          throw new Error("real failure");
        }),
      ).rejects.toThrow("real failure");
      expect(breaker.getState()).toBe("open");
      await vi.advanceTimersByTimeAsync(1001);
      expect(breaker.getState()).toBe("half-open");
      const controller = new AbortController();
      const reason = Object.assign(new Error("stop"), {
        name: variant === "late success" ? "AbortError" : variant,
      });
      await expect(
        breaker.execute(async () => {
          if (variant === "late success") {
            controller.abort(reason);
            return "late";
          }
          throw reason;
        }, controller.signal),
      ).rejects.toBe(reason);
      expect(breaker.getState()).toBe("half-open");
      expect(breaker.getFailureCount()).toBe(1);
      await expect(breaker.execute(async () => "real recovery")).resolves.toBe("real recovery");
      expect(breaker.getState()).toBe("closed");
    },
  );

  it("a genuine half-open failure still reopens the circuit", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000 });
    breaker.recordFailure();
    await vi.advanceTimersByTimeAsync(1001);
    expect(breaker.getState()).toBe("half-open");
    await expect(
      breaker.execute(async () => {
        throw new Error("503 real failure");
      }),
    ).rejects.toThrow("503 real failure");
    expect(breaker.getState()).toBe("open");
    expect(breaker.getFailureCount()).toBe(2);
  });
});
