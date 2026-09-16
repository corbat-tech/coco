import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai.js";
import type { ChatOptions, StreamChunk } from "./types.js";

const sdk = vi.hoisted(() => ({ cc: vi.fn(), responses: vi.fn() }));
vi.mock("openai", () => {
  class APIError extends Error {
    status?: number;
  }
  const OpenAI = Object.assign(
    vi.fn(function () {
      return {
        chat: { completions: { create: sdk.cc } },
        responses: { create: sdk.responses },
        models: { list: vi.fn() },
      };
    }),
    { APIError },
  );
  return { default: OpenAI, APIError };
});

const methods = ["chat", "chatWithTools", "stream", "streamWithTools"] as const;
type Method = (typeof methods)[number];
const cases = ["gpt-4o", "gpt-5.2"].flatMap((model) =>
  methods.map((method) => ({ model, method })),
);
const streaming = cases.filter(({ method }) => method.startsWith("stream"));
const messages = [{ role: "user" as const, content: "Fixture request" }];

async function invoke(
  provider: OpenAIProvider,
  method: Method,
  options: ChatOptions,
  seen: StreamChunk[] = [],
) {
  if (method === "chat") return provider.chat(messages, options);
  if (method === "chatWithTools")
    return provider.chatWithTools(messages, { ...options, tools: [] });
  const chunks =
    method === "stream"
      ? provider.stream(messages, options)
      : provider.streamWithTools(messages, { ...options, tools: [] });
  for await (const chunk of chunks) seen.push(chunk);
  return seen;
}

function textEvent(model: string) {
  return model === "gpt-4o"
    ? { choices: [{ delta: { content: "fixture" }, finish_reason: null }] }
    : { type: "response.output_text.delta", delta: "fixture" };
}
function successResponse(model: string) {
  return {
    id: "fixture",
    model,
    status: "completed",
    output_text: "fixture",
    output: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, input_tokens: 1, output_tokens: 1 },
    choices: [{ message: { content: "fixture", tool_calls: [] }, finish_reason: "stop" }],
  };
}
function mockSuccess(model: string, method: Method) {
  const create = model === "gpt-4o" ? sdk.cc : sdk.responses;
  create.mockImplementation(async () => {
    if (!method.startsWith("stream")) return successResponse(model);
    return Object.assign(
      (async function* () {
        yield textEvent(model);
        yield model === "gpt-4o"
          ? { choices: [{ delta: {}, finish_reason: "stop" }] }
          : { type: "response.completed", response: successResponse(model) };
      })(),
      { controller: new AbortController() },
    );
  });
  return create;
}
async function providerFor(model: string, timeout?: number) {
  const provider = new OpenAIProvider();
  await provider.initialize({
    apiKey: "fixture-not-a-real-key",
    model,
    ...(timeout === undefined ? {} : { timeout }),
  });
  return provider;
}

beforeEach(() => {
  vi.useFakeTimers();
  sdk.cc.mockReset();
  sdk.responses.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("OpenAI cancellation at both SDK API boundaries", () => {
  it.each(cases)(
    "$model $method forwards signal, request timeout, and disables nested SDK retries",
    async ({ model, method }) => {
      const provider = await providerFor(model, 6543);
      const create = mockSuccess(model, method);
      const controller = new AbortController();
      await invoke(provider, method, { signal: controller.signal, timeout: 3210 });
      expect(create).toHaveBeenLastCalledWith(expect.any(Object), {
        signal: controller.signal,
        timeout: 3210,
        maxRetries: 0,
      });
      await invoke(provider, method, { signal: controller.signal });
      expect(create).toHaveBeenLastCalledWith(expect.any(Object), {
        signal: controller.signal,
        timeout: 6543,
        maxRetries: 0,
      });
      expect(create).toHaveBeenCalledTimes(2);
      expect(model === "gpt-4o" ? sdk.responses : sdk.cc).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(cases)(
    "$model $method refuses a pre-aborted request before calling SDK",
    async ({ model, method }) => {
      const provider = await providerFor(model);
      mockSuccess(model, method);
      const controller = new AbortController();
      controller.abort();
      await expect(invoke(provider, method, { signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(sdk.cc).not.toHaveBeenCalled();
      expect(sdk.responses).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(cases)(
    "$model $method preserves cancellation and never retries a canceled SDK request",
    async ({ model, method }) => {
      const provider = await providerFor(model);
      const controller = new AbortController();
      const create = model === "gpt-4o" ? sdk.cc : sdk.responses;
      create.mockImplementation(async () => {
        controller.abort();
        throw Object.assign(new Error("429 request aborted"), { name: "AbortError" });
      });
      const pending = invoke(provider, method, { signal: controller.signal });
      const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.runAllTimersAsync();
      await assertion;
      expect(create).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(streaming)(
    "$model $method rejects silent EOF after cancellation without emitting done",
    async ({ model, method }) => {
      const provider = await providerFor(model);
      const controller = new AbortController();
      const create = model === "gpt-4o" ? sdk.cc : sdk.responses;
      create.mockResolvedValue(
        Object.assign(
          (async function* () {
            yield textEvent(model);
            controller.abort();
            // Some SDK streams finish silently rather than throwing on abort.
          })(),
          { controller: new AbortController() },
        ),
      );
      const seen: StreamChunk[] = [];
      await expect(
        invoke(provider, method, { signal: controller.signal }, seen),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(seen.some((chunk) => chunk.type === "text")).toBe(true);
      expect(seen.some((chunk) => chunk.type === "done")).toBe(false);
      expect(create).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(streaming)(
    "$model $method does not emit a chunk received after cancellation",
    async ({ model, method }) => {
      const provider = await providerFor(model);
      const controller = new AbortController();
      const create = model === "gpt-4o" ? sdk.cc : sdk.responses;
      create.mockResolvedValue(
        Object.assign(
          (async function* () {
            controller.abort();
            yield textEvent(model);
          })(),
          { controller: new AbortController() },
        ),
      );
      const seen: StreamChunk[] = [];
      await expect(
        invoke(provider, method, { signal: controller.signal }, seen),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(seen).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["responses completed", "CC inline finish", "CC EOF fallback"])(
    "checks cancellation between yields within %s",
    async (scenario) => {
      const model = scenario === "responses completed" ? "gpt-5.2" : "gpt-4o";
      const provider = await providerFor(model);
      const controller = new AbortController();
      const create = model === "gpt-4o" ? sdk.cc : sdk.responses;
      const calls = [0, 1].map((index) => ({
        index,
        id: `call-${index}`,
        type: "function",
        function: { name: "fixture_tool", arguments: "{}" },
      }));
      const event =
        scenario === "responses completed"
          ? {
              type: "response.completed",
              response: {
                output: calls.map((call) => ({
                  type: "function_call",
                  call_id: call.id,
                  name: "fixture_tool",
                  arguments: "{}",
                })),
              },
            }
          : {
              choices: [
                {
                  delta: { tool_calls: scenario === "CC EOF fallback" ? calls.slice(0, 1) : calls },
                  finish_reason: scenario === "CC EOF fallback" ? null : "tool_calls",
                },
              ],
            };
      create.mockResolvedValue(
        Object.assign(
          (async function* () {
            yield event;
          })(),
          { controller: new AbortController() },
        ),
      );
      const iterator = provider
        .streamWithTools(messages, { tools: [], signal: controller.signal })
        [Symbol.asyncIterator]();
      const seen: StreamChunk[] = [];
      try {
        for (let step = 0; step < 8; step++) {
          const next = await iterator.next();
          expect(next.done).toBe(false);
          seen.push(next.value);
          if (next.value.type === "tool_use_end") break;
        }
        expect(seen.filter((chunk) => chunk.type === "tool_use_end")).toHaveLength(1);
        controller.abort();
        await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
        expect(seen.some((chunk) => chunk.type === "done")).toBe(false);
        expect(create).toHaveBeenCalledTimes(1);
      } finally {
        await iterator.return?.();
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("rejects watchdog expiry between two function-call yields in one Responses completed event", async () => {
    const provider = await providerFor("gpt-5.2", 1);
    const sdkController = new AbortController();
    sdk.responses.mockResolvedValue(
      Object.assign(
        (async function* () {
          yield {
            type: "response.completed",
            response: {
              output: [0, 1].map((index) => ({
                type: "function_call",
                call_id: `call-${index}`,
                name: "fixture_tool",
                arguments: "{}",
              })),
            },
          };
        })(),
        { controller: sdkController },
      ),
    );
    const iterator = provider
      .streamWithTools(messages, { tools: [], timeout: 1 })
      [Symbol.asyncIterator]();
    try {
      expect((await iterator.next()).value).toMatchObject({
        type: "tool_use_end",
        toolCall: { id: "call-0" },
      });
      await vi.advanceTimersByTimeAsync(5001);
      expect(sdkController.signal.aborted).toBe(true);
      await expect(iterator.next()).rejects.toThrow(/timeout/i);
    } finally {
      await iterator.return?.();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["gpt-4o", "gpt-5.2"])(
    "%s defaults to 120000ms when neither timeout is provided",
    async (model) => {
      const provider = await providerFor(model);
      const create = mockSuccess(model, "chat");
      await invoke(provider, "chat", {});
      expect(create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ timeout: 120000, maxRetries: 0 }),
      );
    },
  );
});
