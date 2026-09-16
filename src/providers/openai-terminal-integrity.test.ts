import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai.js";
import type { StreamChunk } from "./types.js";
const sdk = vi.hoisted(() => ({ cc: vi.fn(), responses: vi.fn() }));
vi.mock("openai", () => {
  class APIError extends Error {
    status?: number;
  }
  return {
    default: Object.assign(
      vi.fn(function () {
        return { chat: { completions: { create: sdk.cc } }, responses: { create: sdk.responses } };
      }),
      { APIError },
    ),
    APIError,
  };
});
const messages = [{ role: "user" as const, content: "fixture" }];
const item = (id = "call-1", args = '{"value":1}') => ({
  type: "function_call",
  id: `item-${id}`,
  call_id: id,
  name: "fixture_tool",
  arguments: args,
});
const ccTool = (id = "call-1", args = '{"value":1}') => ({
  id,
  type: "function",
  function: { name: "fixture_tool", arguments: args },
});
const completed = (output: unknown[] = [item()], status = "completed") => ({
  type: "response.completed",
  response: { id: "fixture", status, output, usage: { input_tokens: 1, output_tokens: 1 } },
});
const provisional = (args = '{"value":1}') => [
  { type: "response.output_item.added", output_index: 0, item: { ...item(), arguments: "" } },
  {
    type: "response.function_call_arguments.done",
    item_id: item().id,
    output_index: 0,
    arguments: args,
  },
];
function stream(events: unknown[]) {
  return Object.assign(
    (async function* () {
      for (const event of events) yield event;
    })(),
    { controller: new AbortController() },
  );
}
async function provider(api: "cc" | "responses") {
  const value = new OpenAIProvider();
  await value.initialize({ apiKey: "fixture-key", model: api === "cc" ? "gpt-4o" : "gpt-5.2" });
  return value;
}
async function collect(value: OpenAIProvider, seen: StreamChunk[], signal?: AbortSignal) {
  for await (const chunk of value.streamWithTools(messages, { tools: [], maxRetries: 3, signal }))
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
  sdk.cc.mockReset();
  sdk.responses.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("OpenAI tool completion requires consistent terminal evidence", () => {
  it.each([undefined, "length", "content_filter", "stop"])(
    "CC stream terminal %s cannot finalize buffered tools",
    async (finish) => {
      sdk.cc.mockResolvedValue(
        stream([
          {
            choices: [
              { delta: { tool_calls: [{ index: 0, ...ccTool() }] }, finish_reason: finish },
            ],
          },
        ]),
      );
      const seen: StreamChunk[] = [];
      await rejected(collect(await provider("cc"), seen));
      expect(ends(seen)).toEqual([]);
      expect(sdk.cc).toHaveBeenCalledOnce();
    },
  );

  it.each([undefined, "length", "content_filter", "stop"])(
    "CC nonstream terminal %s cannot return executable calls",
    async (finish) => {
      sdk.cc.mockResolvedValue({
        id: "fixture",
        choices: [{ message: { content: "", tool_calls: [ccTool()] }, finish_reason: finish }],
        usage: {},
      });
      await rejected((await provider("cc")).chatWithTools(messages, { tools: [], maxRetries: 3 }));
      expect(sdk.cc).toHaveBeenCalledOnce();
    },
  );

  it.each(["response.incomplete", "response.failed", "EOF"])(
    "Responses provisional arguments followed by %s produce no completed tools",
    async (terminal) => {
      const events = provisional();
      sdk.responses.mockResolvedValue(
        stream([
          ...events,
          ...(terminal === "EOF"
            ? []
            : [
                {
                  type: terminal,
                  response: {
                    status: terminal === "response.failed" ? "failed" : "incomplete",
                    output: [item()],
                  },
                },
              ]),
        ]),
      );
      const seen: StreamChunk[] = [];
      await rejected(collect(await provider("responses"), seen));
      expect(ends(seen)).toEqual([]);
      expect(sdk.responses).toHaveBeenCalledOnce();
    },
  );

  it.each([undefined, "incomplete", "failed"])(
    "Responses nonstream status %s rejects tools without replay",
    async (status) => {
      sdk.responses.mockResolvedValue({ id: "fixture", status, output: [item()], usage: {} });
      await rejected(
        (await provider("responses")).chatWithTools(messages, { tools: [], maxRetries: 3 }),
      );
      expect(sdk.responses).toHaveBeenCalledOnce();
    },
  );

  it.each(["cc", "responses"] as const)(
    "%s invalid second call prevents publication of the valid first call",
    async (api) => {
      if (api === "cc")
        sdk.cc.mockResolvedValue(
          stream([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, ...ccTool() },
                      { index: 1, ...ccTool("call-2", '{"broken":') },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            },
          ]),
        );
      else
        sdk.responses.mockResolvedValue(
          stream([completed([item(), item("call-2", '{"broken":')])]),
        );
      const seen: StreamChunk[] = [];
      await rejected(collect(await provider(api), seen));
      expect(ends(seen)).toEqual([]);
      expect(sdk[api]).toHaveBeenCalledOnce();
    },
  );

  it.each(["cc", "responses"] as const)(
    "%s valid terminal retains distinct IDs even with identical arguments",
    async (api) => {
      if (api === "cc")
        sdk.cc.mockResolvedValue(
          stream([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, ...ccTool() },
                      { index: 1, ...ccTool("call-2") },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            },
          ]),
        );
      else
        sdk.responses.mockResolvedValue(
          stream([...provisional(), completed([item(), item("call-2")])]),
        );
      const seen: StreamChunk[] = [];
      await collect(await provider(api), seen);
      expect(ends(seen).map((chunk) => chunk.toolCall?.id)).toEqual(["call-1", "call-2"]);
      expect(ends(seen).map((chunk) => chunk.toolCall?.input)).toEqual([
        { value: 1 },
        { value: 1 },
      ]);
      expect(seen.at(-1)?.type).toBe("done");
    },
  );

  it("Responses completed output supplies missing granular events", async () => {
    sdk.responses.mockResolvedValue(stream([completed()]));
    const seen: StreamChunk[] = [];
    await collect(await provider("responses"), seen);
    expect(ends(seen)).toHaveLength(1);
    expect(ends(seen)[0]?.toolCall?.input).toEqual({ value: 1 });
  });

  it("Responses completed output replaces an incomplete provisional buffer", async () => {
    sdk.responses.mockResolvedValue(
      stream([
        { type: "response.output_item.added", output_index: 0, item: { ...item(), arguments: "" } },
        {
          type: "response.function_call_arguments.delta",
          item_id: item().id,
          output_index: 0,
          delta: '{"value":',
        },
        completed(),
      ]),
    );
    const seen: StreamChunk[] = [];
    await collect(await provider("responses"), seen);
    expect(ends(seen)).toHaveLength(1);
    expect(ends(seen)[0]?.toolCall?.input).toEqual({ value: 1 });
  });

  it("abort during provisional arguments emits no completed tools", async () => {
    const controller = new AbortController();
    sdk.responses.mockResolvedValue(stream([...provisional(), completed()]));
    const iterator = (await provider("responses"))
      .streamWithTools(messages, { tools: [], signal: controller.signal })
      [Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "tool_use_start" });
    controller.abort(new Error("fixture provisional canceled"));
    await expect(iterator.next()).rejects.toBe(controller.signal.reason);
    expect(sdk.responses).toHaveBeenCalledOnce();
  });

  it.each(["cc", "responses"] as const)(
    "%s checks cancellation between terminal tool emissions",
    async (api) => {
      const controller = new AbortController();
      if (api === "cc")
        sdk.cc.mockResolvedValue(
          stream([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, ...ccTool() },
                      { index: 1, ...ccTool("call-2") },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            },
          ]),
        );
      else sdk.responses.mockResolvedValue(stream([completed([item(), item("call-2")])]));
      const iterator = (await provider(api))
        .streamWithTools(messages, { tools: [], signal: controller.signal })
        [Symbol.asyncIterator]();
      for (;;) {
        const next = await iterator.next();
        expect(next.done).toBe(false);
        if (next.value?.type === "tool_use_end") break;
      }
      controller.abort(new Error("fixture between final calls"));
      await expect(iterator.next()).rejects.toBe(controller.signal.reason);
    },
  );

  it.each(["cc", "responses"] as const)(
    "%s text EOF without terminal evidence rejects",
    async (api) => {
      sdk[api].mockResolvedValue(
        stream(
          api === "cc"
            ? [{ choices: [{ delta: { content: "fixture" }, finish_reason: null }] }]
            : [{ type: "response.output_text.delta", delta: "fixture" }],
        ),
      );
      const seen: StreamChunk[] = [];
      await rejected(collect(await provider(api), seen));
      expect(seen.some((chunk) => chunk.type === "done")).toBe(false);
      expect(sdk[api]).toHaveBeenCalledOnce();
    },
  );

  it("CC length terminal remains valid for text-only max_tokens", async () => {
    sdk.cc.mockResolvedValue(
      stream([{ choices: [{ delta: { content: "fixture" }, finish_reason: "length" }] }]),
    );
    const seen: StreamChunk[] = [];
    await collect(await provider("cc"), seen);
    expect(ends(seen)).toEqual([]);
    expect(seen.at(-1)).toMatchObject({ type: "done", stopReason: "max_tokens" });
  });
});

describe("Terminal identity and argument contradictions", () => {
  it.each(["arguments", "name"] as const)(
    "CC duplicate ID with conflicting %s cannot emit either call",
    async (field) => {
      const conflicting = ccTool("call-1", field === "arguments" ? '{"value":2}' : '{"value":1}');
      if (field === "name") conflicting.function.name = "other_fixture_tool";
      sdk.cc.mockResolvedValue(
        stream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, ...ccTool() },
                    { index: 1, ...conflicting },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]),
      );
      const seen: StreamChunk[] = [];
      await rejected(collect(await provider("cc"), seen));
      expect(ends(seen)).toEqual([]);
      expect(sdk.cc).toHaveBeenCalledOnce();
    },
  );

  it.each(["id", "name"] as const)(
    "CC changing %s on an existing index is a protocol error",
    async (field) => {
      const initial = {
        index: 0,
        id: "call-1",
        function: { name: "fixture_tool", arguments: '{"value":' },
      };
      const next =
        field === "id"
          ? { index: 0, id: "call-2", function: { arguments: "1}" } }
          : { index: 0, function: { name: "other_fixture_tool", arguments: "1}" } };
      sdk.cc.mockResolvedValue(
        stream([
          { choices: [{ delta: { tool_calls: [initial] }, finish_reason: null }] },
          { choices: [{ delta: { tool_calls: [next] }, finish_reason: "tool_calls" }] },
        ]),
      );
      const seen: StreamChunk[] = [];
      await rejected(collect(await provider("cc"), seen));
      expect(ends(seen)).toEqual([]);
      expect(sdk.cc).toHaveBeenCalledOnce();
    },
  );

  it.each(["name", "arguments", "name without arguments"] as const)(
    "Responses terminal %s cannot contradict finalized provisional arguments",
    async (field) => {
      const finalItem: Record<string, unknown> = { ...item() };
      if (field === "arguments") finalItem.arguments = '{"value":2}';
      else finalItem.name = "other_fixture_tool";
      if (field === "name without arguments") delete finalItem.arguments;
      sdk.responses.mockResolvedValue(stream([...provisional(), completed([finalItem])]));
      const seen: StreamChunk[] = [];
      await rejected(collect(await provider("responses"), seen));
      expect(ends(seen)).toEqual([]);
      expect(sdk.responses).toHaveBeenCalledOnce();
    },
  );

  it.each(["cc", "responses"] as const)(
    "%s permits an identical duplicate ID without duplicate execution",
    async (api) => {
      if (api === "cc")
        sdk.cc.mockResolvedValue(
          stream([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, ...ccTool() },
                      { index: 1, ...ccTool() },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            },
          ]),
        );
      else sdk.responses.mockResolvedValue(stream([...provisional(), completed([item(), item()])]));
      const seen: StreamChunk[] = [];
      await collect(await provider(api), seen);
      expect(ends(seen)).toHaveLength(1);
      expect(ends(seen)[0]?.toolCall?.id).toBe("call-1");
    },
  );

  it.each([
    { label: "missing response", event: { type: "response.completed" } },
    {
      label: "missing output",
      event: { type: "response.completed", response: { status: "completed" } },
    },
    {
      label: "non-array output",
      event: { type: "response.completed", response: { status: "completed", output: {} } },
    },
  ])("Responses $label terminal is rejected without replay", async ({ event }) => {
    sdk.responses.mockResolvedValue(stream([event]));
    const seen: StreamChunk[] = [];
    await rejected(collect(await provider("responses"), seen));
    expect(ends(seen)).toEqual([]);
    expect(seen.some((chunk) => chunk.type === "done")).toBe(false);
    expect(sdk.responses).toHaveBeenCalledOnce();
  });
});

describe("Provisional argument and reference consistency", () => {
  it("Responses completed JSON buffer cannot be replaced by different done arguments", async () => {
    const changed = '{"value":2}';
    sdk.responses.mockResolvedValue(
      stream([
        { type: "response.output_item.added", output_index: 0, item: { ...item(), arguments: "" } },
        {
          type: "response.function_call_arguments.delta",
          item_id: item().id,
          output_index: 0,
          delta: '{"value":1}',
        },
        {
          type: "response.function_call_arguments.done",
          item_id: item().id,
          output_index: 0,
          arguments: changed,
        },
        completed([item("call-1", changed)]),
      ]),
    );
    const seen: StreamChunk[] = [];
    await rejected(collect(await provider("responses"), seen));
    expect(ends(seen)).toEqual([]);
    expect(sdk.responses).toHaveBeenCalledOnce();
  });

  it("Responses incomplete fragment can be completed by consistent full done arguments", async () => {
    sdk.responses.mockResolvedValue(
      stream([
        { type: "response.output_item.added", output_index: 0, item: { ...item(), arguments: "" } },
        {
          type: "response.function_call_arguments.delta",
          item_id: item().id,
          output_index: 0,
          delta: '{"value":',
        },
        {
          type: "response.function_call_arguments.done",
          item_id: item().id,
          output_index: 0,
          arguments: '{"value":1}',
        },
        completed(),
      ]),
    );
    const seen: StreamChunk[] = [];
    await collect(await provider("responses"), seen);
    expect(ends(seen)).toHaveLength(1);
    expect(ends(seen)[0]?.toolCall?.input).toEqual({ value: 1 });
  });

  it("an explicit unknown Responses item ID cannot attach to the only existing builder", async () => {
    sdk.responses.mockResolvedValue(
      stream([
        { type: "response.output_item.added", output_index: 0, item: { ...item(), arguments: "" } },
        {
          type: "response.function_call_arguments.done",
          item_id: "item-unknown",
          arguments: '{"value":1}',
        },
        completed(),
      ]),
    );
    const seen: StreamChunk[] = [];
    await rejected(collect(await provider("responses"), seen));
    expect(ends(seen)).toEqual([]);
    expect(sdk.responses).toHaveBeenCalledOnce();
  });

  it("Responses item ID and output index cannot identify different builders", async () => {
    sdk.responses.mockResolvedValue(
      stream([
        { type: "response.output_item.added", output_index: 0, item: { ...item(), arguments: "" } },
        {
          type: "response.output_item.added",
          output_index: 1,
          item: { ...item("call-2"), arguments: "" },
        },
        {
          type: "response.function_call_arguments.done",
          item_id: item().id,
          output_index: 1,
          arguments: '{"value":1}',
        },
        completed([item(), item("call-2")]),
      ]),
    );
    const seen: StreamChunk[] = [];
    await rejected(collect(await provider("responses"), seen));
    expect(ends(seen)).toEqual([]);
    expect(sdk.responses).toHaveBeenCalledOnce();
  });

  it("CC unindexed delta is rejected when multiple builders make its target ambiguous", async () => {
    sdk.cc.mockResolvedValue(
      stream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, ...ccTool("call-1", '{"value":1}') },
                  { index: 1, ...ccTool("call-2", '{"value":') },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: { tool_calls: [{ function: { arguments: "1}" } }] },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]),
    );
    const seen: StreamChunk[] = [];
    await rejected(collect(await provider("cc"), seen));
    expect(ends(seen)).toEqual([]);
    expect(sdk.cc).toHaveBeenCalledOnce();
  });
});
