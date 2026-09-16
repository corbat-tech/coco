import { ResilientProvider } from "./resilient.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "./anthropic.js";
import type { StreamChunk } from "./types.js";
const sdk = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  return {
    default: Object.assign(
      vi.fn(function () {
        return { messages: { create: sdk.create, stream: sdk.stream } };
      }),
      { APIError },
    ),
    APIError,
  };
});
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
const messages = [{ role: "user" as const, content: "fixture" }];
function block(index = 0, id = "call-1", args = '{"value":1}', name = "fixture_tool") {
  return [
    {
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id, name, input: {} },
    },
    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: args } },
    { type: "content_block_stop", index },
  ];
}
function terminal(reason: string | null = "tool_use") {
  return [
    {
      type: "message_delta",
      delta: { stop_reason: reason, stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
}
function iterable(events: unknown[]) {
  return Object.assign(
    (async function* () {
      for (const event of events) yield event;
    })(),
    { controller: new AbortController() },
  );
}
async function provider() {
  const value = new AnthropicProvider();
  await value.initialize({
    apiKey: "fixture-key",
    model: "claude-sonnet-4-20250514",
    timeout: 30000,
  });
  return value;
}
async function collect(value: AnthropicProvider, seen: StreamChunk[]) {
  for await (const chunk of value.streamWithTools(messages, { tools: [], maxRetries: 3 }))
    seen.push(chunk);
}
async function rejected(pending: Promise<unknown>) {
  const outcome = pending.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(20000);
  const result = await outcome;
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(Error);
}
const ends = (seen: StreamChunk[]) => seen.filter((chunk) => chunk.type === "tool_use_end");
beforeEach(() => {
  vi.useFakeTimers();
  sdk.create.mockReset();
  sdk.stream.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Anthropic terminal tool integrity", () => {
  it.each(["EOF", "max_tokens", "refusal", "end_turn", "missing reason", "delta without stop"])(
    "%s cannot commit buffered tool arguments",
    async (ending) => {
      const events = [...block()];
      const tail =
        ending === "EOF"
          ? []
          : ending === "delta without stop"
            ? terminal().slice(0, 1)
            : terminal(ending === "missing reason" ? null : ending);
      sdk.stream.mockResolvedValue(iterable([...events, ...tail]));
      const seen: StreamChunk[] = [];
      await rejected(collect(await provider(), seen));
      expect(ends(seen)).toEqual([]);
      expect(seen.some((chunk) => chunk.type === "done")).toBe(false);
      expect(sdk.stream).toHaveBeenCalledOnce();
    },
  );

  it.each(["missing block stop", "wrong stop index", "wrong delta index"])(
    "%s rejects before any tool completion",
    async (failure) => {
      const events = block();
      if (failure === "missing block stop") events.pop();
      if (failure === "wrong stop index") events[2] = { type: "content_block_stop", index: 1 };
      if (failure === "wrong delta index")
        events[1] = {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"value":1}' },
        };
      sdk.stream.mockResolvedValue(iterable([...events, ...terminal()]));
      const seen: StreamChunk[] = [];
      await rejected(collect(await provider(), seen));
      expect(ends(seen)).toEqual([]);
      expect(sdk.stream).toHaveBeenCalledOnce();
    },
  );

  it.each([undefined, "max_tokens", "refusal", "end_turn"])(
    "nonstream tool calls reject stop reason %s without retries",
    async (reason) => {
      sdk.create.mockResolvedValue({
        id: "fixture",
        content: [{ type: "tool_use", id: "call-1", name: "fixture_tool", input: { value: 1 } }],
        stop_reason: reason,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      await rejected((await provider()).chatWithTools(messages, { tools: [], maxRetries: 3 }));
      expect(sdk.create).toHaveBeenCalledOnce();
    },
  );

  it("all closed blocks commit after message_stop, retaining distinct IDs with identical arguments", async () => {
    sdk.stream.mockResolvedValue(iterable([...block(), ...block(1, "call-2"), ...terminal()]));
    const seen: StreamChunk[] = [];
    await collect(await provider(), seen);
    expect(ends(seen).map((chunk) => chunk.toolCall?.id)).toEqual(["call-1", "call-2"]);
    expect(ends(seen).map((chunk) => chunk.toolCall?.input)).toEqual([{ value: 1 }, { value: 1 }]);
    expect(seen.at(-1)).toMatchObject({ type: "done", stopReason: "tool_use" });
  });

  it.each(["arguments", "name"] as const)(
    "conflicting duplicate ID by %s cannot publish the first tool",
    async (field) => {
      sdk.stream.mockResolvedValue(
        iterable([
          ...block(),
          ...block(
            1,
            "call-1",
            field === "arguments" ? '{"value":2}' : '{"value":1}',
            field === "name" ? "other_fixture_tool" : "fixture_tool",
          ),
          ...terminal(),
        ]),
      );
      const seen: StreamChunk[] = [];
      await rejected(collect(await provider(), seen));
      expect(ends(seen)).toEqual([]);
    },
  );

  it("malformed second block prevents a valid first block from being committed", async () => {
    sdk.stream.mockResolvedValue(
      iterable([...block(), ...block(1, "call-2", '{"value":'), ...terminal()]),
    );
    const seen: StreamChunk[] = [];
    await rejected(collect(await provider(), seen));
    expect(ends(seen)).toEqual([]);
    expect(sdk.stream).toHaveBeenCalledOnce();
  });

  it("text-only max_tokens remains a valid terminal result", async () => {
    sdk.stream.mockResolvedValue(
      iterable([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "fixture text" },
        },
        { type: "content_block_stop", index: 0 },
        ...terminal("max_tokens"),
      ]),
    );
    const seen: StreamChunk[] = [];
    await collect(await provider(), seen);
    expect(seen).toContainEqual({ type: "text", text: "fixture text" });
    expect(ends(seen)).toEqual([]);
    expect(seen.at(-1)).toMatchObject({ type: "done", stopReason: "max_tokens" });
  });

  it("tool start and delta remain progressive but cancellation prevents final commitment", async () => {
    sdk.stream.mockResolvedValue(iterable([...block(), ...terminal()]));
    const controller = new AbortController();
    const iterator = (await provider())
      .streamWithTools(messages, { tools: [], signal: controller.signal })
      [Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "tool_use_start" });
    expect((await iterator.next()).value).toMatchObject({ type: "tool_use_delta" });
    controller.abort(new Error("fixture provisional abort"));
    await expect(iterator.next()).rejects.toBe(controller.signal.reason);
  });

  it("cancellation between committed tools prevents the remaining tool and done", async () => {
    sdk.stream.mockResolvedValue(iterable([...block(), ...block(1, "call-2"), ...terminal()]));
    const controller = new AbortController();
    const iterator = (await provider())
      .streamWithTools(messages, { tools: [], signal: controller.signal })
      [Symbol.asyncIterator]();
    for (;;) {
      const next = await iterator.next();
      expect(next.done).toBe(false);
      if (next.value?.type === "tool_use_end") break;
    }
    controller.abort(new Error("fixture final abort"));
    await expect(iterator.next()).rejects.toBe(controller.signal.reason);
  });

  it("timeout zero disables the watchdog while a provisional tool is suspended", async () => {
    const upstream = iterable([...block(), ...terminal()]);
    sdk.stream.mockResolvedValue(upstream);
    const iterator = (await provider())
      .streamWithTools(messages, { tools: [], timeout: 0 })
      [Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "tool_use_start" });
    await vi.advanceTimersByTimeAsync(35001);
    expect(upstream.controller.signal.aborted).toBe(false);
    const remaining: StreamChunk[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      remaining.push(next.value);
    }
    expect(ends(remaining)).toHaveLength(1);
    expect(remaining.at(-1)?.type).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Anthropic invalid block shapes never replay", () => {
  it.each([null, [null]])("rejects nonstream content %j once", async (content) => {
    sdk.create.mockResolvedValue({ content, stop_reason: "tool_use" });
    await rejected((await provider()).chatWithTools(messages, { tools: [], maxRetries: 3 }));
    expect(sdk.create).toHaveBeenCalledOnce();
  });
  it("rejects a null streamed block before any chunk without wrapper retry", async () => {
    sdk.stream.mockImplementation(() =>
      iterable([{ type: "content_block_start", index: 0, content_block: null }]),
    );
    const wrapped = new ResilientProvider(await provider(), {
      streamRetry: { maxRetries: 3, initialDelayMs: 1 },
    });
    const seen: StreamChunk[] = [];
    const outcome = (async () => {
      for await (const chunk of wrapped.streamWithTools(messages, { tools: [], maxRetries: 3 }))
        seen.push(chunk);
    })();
    await rejected(outcome);
    expect(seen).toEqual([]);
    expect(sdk.stream).toHaveBeenCalledOnce();
  });
});
