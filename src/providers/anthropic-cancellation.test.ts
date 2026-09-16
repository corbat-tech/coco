import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "./anthropic.js";
import type { ChatOptions, StreamChunk } from "./types.js";

const sdk = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  const Anthropic = Object.assign(
    vi.fn(function () {
      return { messages: { create: sdk.create, stream: sdk.stream } };
    }),
    { APIError },
  );
  return { default: Anthropic, APIError };
});

const methods = ["chat", "chatWithTools", "stream", "streamWithTools"] as const;
type Method = (typeof methods)[number];
const streaming = ["stream", "streamWithTools"] as const;
const messages = [{ role: "user" as const, content: "Fixture request" }];
const textEvent = { type: "content_block_delta", delta: { type: "text_delta", text: "fixture" } };
const response = {
  id: "fixture",
  model: "claude-sonnet-4-20250514",
  stop_reason: "end_turn",
  content: [{ type: "text", text: "fixture" }],
  usage: { input_tokens: 1, output_tokens: 1 },
};
async function providerFor(timeout?: number) {
  const provider = new AnthropicProvider();
  await provider.initialize({
    apiKey: "fixture-not-a-real-key",
    model: response.model,
    ...(timeout === undefined ? {} : { timeout }),
  });
  return provider;
}
function streamFor(
  provider: AnthropicProvider,
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
  provider: AnthropicProvider,
  method: Method,
  options: ChatOptions,
  seen: StreamChunk[] = [],
) {
  if (method === "chat") return provider.chat(messages, options);
  if (method === "chatWithTools")
    return provider.chatWithTools(messages, { ...options, tools: [] });
  const iterator = streamFor(provider, method, options);
  for (;;) {
    const item = await iterator.next();
    if (item.done) break;
    seen.push(item.value);
  }
  return seen;
}
function sdkStream(generator: AsyncGenerator<unknown>) {
  return Object.assign(generator, { controller: new AbortController() });
}
function mockSuccess() {
  sdk.create.mockResolvedValue(response);
  sdk.stream.mockImplementation(async () =>
    sdkStream(
      (async function* () {
        yield textEvent;
        yield { type: "message_delta", delta: { stop_reason: "end_turn" } };
        yield { type: "message_stop" };
      })(),
    ),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  sdk.create.mockReset();
  sdk.stream.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Anthropic cancellation and request ownership", () => {
  it.each(methods)("%s pre-abort never enters the SDK", async (method) => {
    const provider = await providerFor();
    const controller = new AbortController();
    const reason = new Error("fixture cancellation");
    controller.abort(reason);
    await expect(invoke(provider, method, { signal: controller.signal })).rejects.toBe(reason);
    expect(sdk.create).not.toHaveBeenCalled();
    expect(sdk.stream).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(methods)(
    "%s forwards per-call timeout, signal and disables SDK retries",
    async (method) => {
      mockSuccess();
      const provider = await providerFor(9000);
      const signal = new AbortController().signal;
      await invoke(provider, method, { signal, timeout: 4321 });
      expect(method.startsWith("stream") ? sdk.stream : sdk.create).toHaveBeenCalledWith(
        expect.any(Object),
        { signal, timeout: 4321, maxRetries: 0 },
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(methods.flatMap((method) => [undefined, 9876].map((timeout) => ({ method, timeout }))))(
    "$method uses configured/default timeout $timeout",
    async ({ method, timeout }) => {
      mockSuccess();
      await invoke(await providerFor(timeout), method, {});
      expect(method.startsWith("stream") ? sdk.stream : sdk.create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ timeout: timeout ?? 120000, maxRetries: 0 }),
      );
    },
  );

  it.each(methods)("%s preserves SDK cancellation without retry", async (method) => {
    const canceled = Object.assign(new Error("429 canceled"), { name: "APIUserAbortError" });
    const call = method.startsWith("stream") ? sdk.stream : sdk.create;
    call.mockRejectedValue(canceled);
    await expect(invoke(await providerFor(), method, {})).rejects.toBe(canceled);
    expect(call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(
    streaming.flatMap((method) =>
      [false, true].map((postAbortEvent) => ({ method, postAbortEvent })),
    ),
  )(
    "$method rejects canceled EOF/event (extra event: $postAbortEvent) without done",
    async ({ method, postAbortEvent }) => {
      const controller = new AbortController();
      const reason = new Error("stream canceled");
      sdk.stream.mockResolvedValue(
        sdkStream(
          (async function* () {
            controller.abort(reason);
            if (postAbortEvent) yield textEvent;
          })(),
        ),
      );
      const seen: StreamChunk[] = [];
      await expect(
        invoke(await providerFor(), method, { signal: controller.signal }, seen),
      ).rejects.toBe(reason);
      expect(seen).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(streaming)("%s abort on resume does not request the next SDK event", async (method) => {
    const controller = new AbortController();
    const nextEvent = vi.fn();
    const cleanup = vi.fn();
    sdk.stream.mockResolvedValue(
      sdkStream(
        (async function* () {
          try {
            yield textEvent;
            nextEvent();
            yield textEvent;
          } finally {
            cleanup();
          }
        })(),
      ),
    );
    const iterator = streamFor(await providerFor(), method, { signal: controller.signal });
    expect((await iterator.next()).value).toMatchObject({ type: "text" });
    const reason = new Error("resume canceled");
    controller.abort(reason);
    await expect(iterator.next()).rejects.toBe(reason);
    expect(nextEvent).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["chat", "chatWithTools"] as const)(
    "%s rejects a late successful response after abort",
    async (method) => {
      const controller = new AbortController();
      const reason = new Error("response canceled");
      sdk.create.mockImplementation(async () => {
        controller.abort(reason);
        return response;
      });
      await expect(invoke(await providerFor(), method, { signal: controller.signal })).rejects.toBe(
        reason,
      );
      expect(sdk.create).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(streaming)("%s early consumer return releases watchdog and upstream", async (method) => {
    const cleanup = vi.fn();
    sdk.stream.mockResolvedValue(
      sdkStream(
        (async function* () {
          try {
            yield textEvent;
            yield textEvent;
          } finally {
            cleanup();
          }
        })(),
      ),
    );
    const iterator = streamFor(await providerFor(), method, {});
    await iterator.next();
    expect(vi.getTimerCount()).toBe(1);
    await iterator.return?.();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["abort", "timeout"] as const)(
    "stops between validated tool ends from the terminal event on %s",
    async (cause) => {
      const controller = new AbortController();
      const upstream = sdkStream(
        (async function* () {
          for (const [index, id] of ["first", "second"].entries()) {
            yield {
              type: "content_block_start",
              index,
              content_block: { type: "tool_use", id, name: "fixture_tool" },
            };
            yield {
              type: "content_block_delta",
              index,
              delta: { type: "input_json_delta", partial_json: "{}" },
            };
            yield { type: "content_block_stop", index };
          }
          yield { type: "message_delta", delta: { stop_reason: "tool_use" } };
          yield { type: "message_stop" };
        })(),
      );
      sdk.stream.mockResolvedValue(upstream);
      const iterator = streamFor(await providerFor(50000), "streamWithTools", {
        signal: controller.signal,
        timeout: 1,
      });
      expect((await iterator.next()).value).toMatchObject({
        type: "tool_use_start",
        toolCall: { id: "first" },
      });
      expect((await iterator.next()).value).toMatchObject({
        type: "tool_use_delta",
        text: "{}",
      });
      expect((await iterator.next()).value).toMatchObject({
        type: "tool_use_start",
        toolCall: { id: "second" },
      });
      expect((await iterator.next()).value).toMatchObject({ type: "tool_use_delta", text: "{}" });
      expect((await iterator.next()).value).toMatchObject({
        type: "tool_use_end",
        toolCall: { id: "first" },
      });
      if (cause === "abort") {
        const reason = new Error("between emissions");
        controller.abort(reason);
        await expect(iterator.next()).rejects.toBe(reason);
      } else {
        await vi.advanceTimersByTimeAsync(5001);
        expect(upstream.controller.signal.aborted).toBe(true);
        await expect(iterator.next()).rejects.toThrow(/timeout/i);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
