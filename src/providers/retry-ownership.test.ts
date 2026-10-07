import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai.js";
import { ResilientProvider } from "./resilient.js";
import type { ChatOptions, LLMProvider, StreamChunk } from "./types.js";

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => {
  class APIError extends Error {
    status = 503;
  }
  return {
    default: Object.assign(
      vi.fn(function () {
        return { chat: { completions: { create: sdk.create } }, responses: { create: sdk.create } };
      }),
      { APIError },
    ),
    APIError,
  };
});
const messages = [{ role: "user" as const, content: "fixture" }];
const methods = ["chat", "chatWithTools", "stream", "streamWithTools"] as const;
type Method = (typeof methods)[number];
const retry = { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 };
function wrap(provider: LLMProvider) {
  return new ResilientProvider(provider, {
    retry,
    streamRetry: retry,
    circuitBreaker: { failureThreshold: 100 },
  });
}
async function providerFor(model = "gpt-4o") {
  const provider = new OpenAIProvider();
  await provider.initialize({ apiKey: "fixture-not-real", model });
  return provider;
}
async function invoke(provider: LLMProvider, method: Method, options: ChatOptions) {
  if (method === "chat") return provider.chat(messages, options);
  if (method === "chatWithTools")
    return provider.chatWithTools(messages, { ...options, tools: [] });
  const stream =
    method === "stream"
      ? provider.stream(messages, options)
      : provider.streamWithTools(messages, { ...options, tools: [] });
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
async function expectFailure(pending: Promise<unknown>) {
  const assertion = expect(pending).rejects.toThrow();
  await vi.runAllTimersAsync();
  await assertion;
}

beforeEach(() => {
  vi.useFakeTimers();
  sdk.create.mockReset().mockRejectedValue(new Error("503 fixture unavailable"));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("one retry owner per provider invocation", () => {
  it.each(["gpt-4o", "gpt-5.2"])(
    "%s retains four default direct attempts and permits an explicit zero retry budget",
    async (model) => {
      const direct = await providerFor(model);
      await expectFailure(direct.chat(messages));
      expect(sdk.create).toHaveBeenCalledTimes(4);
      sdk.create.mockClear();
      await expectFailure(direct.chat(messages, { maxRetries: 0 }));
      expect(sdk.create).toHaveBeenCalledTimes(1);
    },
  );

  it.each(methods)(
    "Resilient %s override=2 owns exactly three SDK attempts without multiplying retries",
    async (method) => {
      const direct = await providerFor();
      const options = Object.freeze({ maxRetries: 2, timeout: 5000 });
      await expectFailure(invoke(wrap(direct), method, options));
      expect(sdk.create).toHaveBeenCalledTimes(3);
      for (const [, requestOptions] of sdk.create.mock.calls)
        expect(requestOptions).toMatchObject({ maxRetries: 0 });
      expect(options).toEqual({ maxRetries: 2, timeout: 5000 });
    },
  );

  it.each(methods)(
    "nested Resilient %s layers still make only three SDK attempts",
    async (method) => {
      const nested = wrap(wrap(await providerFor()));
      await expectFailure(invoke(nested, method, { maxRetries: 2 }));
      expect(sdk.create).toHaveBeenCalledTimes(3);
    },
  );

  it.each(methods)(
    "Resilient %s passes a copied zero-budget option object to its underlying provider",
    async (method) => {
      const received: ChatOptions[] = [];
      const operation = vi.fn((_messages: unknown, options: ChatOptions) => {
        received.push(options);
        if (method.startsWith("stream"))
          return (async function* () {
            yield { type: "done" as const };
          })();
        return Promise.resolve({
          id: "fixture",
          content: "ok",
          model: "fixture",
          stopReason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
          toolCalls: [],
        });
      });
      const provider = {
        id: "fixture",
        name: "Fixture",
        [method]: operation,
      } as unknown as LLMProvider;
      const controller = new AbortController();
      const options = Object.freeze({ maxRetries: 2, timeout: 321, signal: controller.signal });
      await invoke(wrap(provider), method, options);
      expect(operation).toHaveBeenCalledTimes(1);
      expect(received[0]).not.toBe(options);
      expect(received[0]).toMatchObject({ maxRetries: 0, timeout: 321, signal: controller.signal });
      expect(options.maxRetries).toBe(2);
    },
  );

  it.each(["stream", "streamWithTools"] as const)(
    "%s override=0 disables retries before the first chunk",
    async (method) => {
      await expectFailure(invoke(wrap(await providerFor()), method, { maxRetries: 0 }));
      expect(sdk.create).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["stream", "streamWithTools"] as const)(
    "%s never uses remaining budget after emitting a chunk",
    async (method) => {
      sdk.create.mockImplementation(async () =>
        Object.assign(
          (async function* () {
            yield { choices: [{ delta: { content: "partial" }, finish_reason: null }] };
            throw new Error("503 after partial output");
          })(),
          { controller: new AbortController() },
        ),
      );
      const wrapper = wrap(await providerFor());
      const seen: StreamChunk[] = [];
      const stream =
        method === "stream"
          ? wrapper.stream(messages, { maxRetries: 2 })
          : wrapper.streamWithTools(messages, { maxRetries: 2, tools: [] });
      const consume = (async () => {
        for await (const chunk of stream) seen.push(chunk);
      })();
      await expectFailure(consume);
      expect(seen).toEqual([{ type: "text", text: "partial" }]);
      expect(sdk.create).toHaveBeenCalledTimes(1);
    },
  );

  it.each([-1, 0.5, NaN, Infinity])(
    "rejects invalid retry budget %s before any SDK request",
    async (maxRetries) => {
      const direct = await providerFor();
      await expectFailure(direct.chat(messages, { maxRetries }));
      for (const method of methods)
        await expectFailure(invoke(wrap(direct), method, { maxRetries }));
      expect(sdk.create).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each(["chat", "chatWithTools"] as const)(
    "%s invalid budget does not trip the provider circuit",
    async (method) => {
      const wrapper = new ResilientProvider(await providerFor(), {
        circuitBreaker: { failureThreshold: 1 },
      });
      await expectFailure(invoke(wrapper, method, { maxRetries: -1 }));
      expect(wrapper.getCircuitState()).toBe("closed");
      expect(sdk.create).not.toHaveBeenCalled();
    },
  );
});
