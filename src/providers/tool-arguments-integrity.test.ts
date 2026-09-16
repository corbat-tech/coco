import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { CodexProvider } from "./codex.js";
import { ResilientProvider } from "./resilient.js";
import type { LLMProvider, StreamChunk } from "./types.js";
const mocks = vi.hoisted(() => ({
  cc: vi.fn(),
  responses: vi.fn(),
  anthropic: vi.fn(),
  anthropicStream: vi.fn(),
  fetch: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("openai", () => {
  class APIError extends Error {
    status?: number;
  }
  return {
    default: Object.assign(
      vi.fn(function () {
        return {
          chat: { completions: { create: mocks.cc } },
          responses: { create: mocks.responses },
        };
      }),
      { APIError },
    ),
    APIError,
  };
});
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  return {
    default: Object.assign(
      vi.fn(function () {
        return { messages: { create: mocks.anthropic, stream: mocks.anthropicStream } };
      }),
      { APIError },
    ),
    APIError,
  };
});
vi.mock("../auth/index.js", () => ({ getValidAccessToken: mocks.auth }));
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
const routes = [
  "cc-chat",
  "cc-stream",
  "responses-chat",
  "responses-stream",
  "anthropic-chat",
  "anthropic-stream",
  "anthropic-unclosed",
  "codex-chat",
  "codex-stream",
] as const;
type Route = (typeof routes)[number];
const secret = "fixture-private-argument-marker";
const messages = [{ role: "user" as const, content: "fixture" }];
function iterable(events: unknown[]) {
  return Object.assign(
    (async function* () {
      for (const event of events) yield event;
    })(),
    { controller: new AbortController() },
  );
}
async function prepare(route: Route, args: string, input: unknown): Promise<LLMProvider> {
  if (route.startsWith("anthropic")) {
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "fixture-key", model: "claude-sonnet-4-20250514" });
    mocks.anthropic.mockResolvedValue({
      id: "fixture",
      content: [{ type: "tool_use", id: "call-1", name: "fixture_tool", input }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    mocks.anthropicStream.mockResolvedValue(
      iterable([
        {
          type: "content_block_start",
          content_block: { type: "tool_use", id: "call-1", name: "fixture_tool" },
        },
        { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: args } },
        route === "anthropic-unclosed"
          ? {
              type: "content_block_start",
              content_block: { type: "tool_use", id: "call-2", name: "fixture_tool" },
            }
          : { type: "content_block_stop" },
        ...(route === "anthropic-unclosed"
          ? [
              {
                type: "content_block_delta",
                delta: { type: "input_json_delta", partial_json: "{}" },
              },
              { type: "content_block_stop" },
            ]
          : []),
      ]),
    );
    return provider;
  }
  const item = {
    type: "function_call",
    id: "item-1",
    call_id: "call-1",
    name: "fixture_tool",
    arguments: args,
  };
  const completedResponse = {
    id: "fixture",
    status: "completed",
    output: [item],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  if (route.startsWith("codex")) {
    const provider = new CodexProvider();
    await provider.initialize({ model: "gpt-5.2" });
    const events = [
      ...(route === "codex-chat"
        ? [
            {
              type: "response.output_item.added",
              output_index: 0,
              item: { ...item, arguments: "" },
            },
            {
              type: "response.function_call_arguments.done",
              output_index: 0,
              item_id: item.id,
              arguments: args,
            },
          ]
        : []),
      { type: "response.completed", response: completedResponse },
    ];
    const bytes = new TextEncoder().encode(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    );
    mocks.fetch.mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
    return provider;
  }
  const provider = new OpenAIProvider();
  await provider.initialize({
    apiKey: "fixture-key",
    model: route.startsWith("cc") ? "gpt-4o" : "gpt-5.2",
  });
  if (route === "cc-chat")
    mocks.cc.mockResolvedValue({
      id: "fixture",
      model: "gpt-4o",
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "fixture_tool", arguments: args },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
  if (route === "cc-stream")
    mocks.cc.mockResolvedValue(
      iterable([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call-1", function: { name: "fixture_tool", arguments: args } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]),
    );
  if (route === "responses-chat") mocks.responses.mockResolvedValue(completedResponse);
  if (route === "responses-stream")
    mocks.responses.mockResolvedValue(
      iterable([{ type: "response.completed", response: completedResponse }]),
    );
  return provider;
}
async function invoke(provider: LLMProvider, route: Route, seen: StreamChunk[]) {
  if (route.endsWith("chat")) return provider.chatWithTools(messages, { tools: [], maxRetries: 0 });
  for await (const chunk of provider.streamWithTools(messages, { tools: [], maxRetries: 0 }))
    seen.push(chunk);
  return seen;
}
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.auth.mockResolvedValue({ accessToken: "fixture-token" });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cross-provider executable tool argument integrity", () => {
  it.each(routes.flatMap((route) => ["malformed", "non-object"].map((kind) => ({ route, kind }))))(
    "$route rejects $kind arguments without an executable tool result or secret-bearing error",
    async ({ route, kind }) => {
      const args = kind === "malformed" ? `{"secret":"${secret}",}` : JSON.stringify([secret]);
      const input = kind === "malformed" ? args : [secret];
      const provider = await prepare(route, args, input);
      const seen: StreamChunk[] = [];
      const outcome = await invoke(provider, route, seen).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBeInstanceOf(Error);
        expect(String(outcome.error)).toMatch(/tool arguments|JSON object|complete JSON/i);
        expect(String(outcome.error)).not.toContain(secret);
        expect(JSON.stringify(outcome.error)).not.toContain(secret);
      }
      expect(seen.filter((chunk) => chunk.type === "tool_use_end")).toEqual([]);
      expect(seen.filter((chunk) => chunk.type === "done")).toEqual([]);
    },
  );

  it.each(routes)("%s preserves a complete nested argument object", async (route) => {
    const input = { nested: { value: "fixture" }, list: [1, 2], enabled: true };
    const provider = await prepare(route, JSON.stringify(input), input);
    const seen: StreamChunk[] = [];
    const output = await invoke(provider, route, seen);
    if (Array.isArray(output))
      expect(seen.find((chunk) => chunk.type === "tool_use_end")?.toolCall?.input).toEqual(input);
    else expect(output.toolCalls[0]?.input).toEqual(input);
  });
});

describe("Invalid tool arguments cannot consume retry budget", () => {
  it.each(["cc-chat", "responses-chat", "anthropic-chat"] as const)(
    "%s dispatches once even with three retries available",
    async (route) => {
      vi.useFakeTimers();
      try {
        const args = `{"secret":"${secret}",}`;
        const provider = await prepare(route, args, args);
        const outcome = provider.chatWithTools(messages, { tools: [], maxRetries: 3 }).then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        await vi.advanceTimersByTimeAsync(20000);
        const result = await outcome;
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(String(result.error)).toMatch(/tool arguments/i);
          expect(String(result.error)).not.toContain(secret);
        }
        const sdkCall =
          route === "cc-chat"
            ? mocks.cc
            : route === "responses-chat"
              ? mocks.responses
              : mocks.anthropic;
        expect(sdkCall).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    },
  );

  it("ResilientProvider does not replay a stream that rejects invalid arguments before its first emission", async () => {
    vi.useFakeTimers();
    try {
      const provider = await prepare("responses-stream", `{"secret":"${secret}",}`, {});
      const wrapped = new ResilientProvider(provider, {
        streamRetry: { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 },
      });
      const seen: StreamChunk[] = [];
      const outcome = (async () => {
        for await (const chunk of wrapped.streamWithTools(messages, { tools: [], maxRetries: 3 }))
          seen.push(chunk);
      })().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await vi.advanceTimersByTimeAsync(10);
      const result = await outcome;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(String(result.error)).toMatch(/tool arguments/i);
      expect(seen).toEqual([]);
      expect(mocks.responses).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
