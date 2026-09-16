import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexProvider } from "./codex.js";
import { ResponseIntegrityError } from "./response-integrity.js";
import type { StreamChunk } from "./types.js";

vi.mock("../auth/index.js", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue({ accessToken: "test-token" }),
}));
const mockFetch = vi.fn();
const call = (id = "call_1", args = '{"path":"a"}') => ({
  type: "function_call",
  id: `item_${id}`,
  call_id: id,
  name: "read_file",
  arguments: args,
});
const added = { type: "response.output_item.added", item: call() };
const done = {
  type: "response.function_call_arguments.done",
  item_id: "item_call_1",
  arguments: '{"path":"a"}',
};
const completed = (output: unknown[] = [call()]) => ({
  type: "response.completed",
  response: { status: "completed", output },
});
function respond(events: unknown[]) {
  mockFetch.mockImplementation(
    async () => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")),
  );
}
async function provider() {
  const instance = new CodexProvider();
  await instance.initialize({});
  return instance;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe.each(["chat", "stream"] as const)("Codex %s terminal integrity", (mode) => {
  async function consume(events: unknown[], seen: StreamChunk[] = []) {
    respond(events);
    const instance = await provider();
    if (mode === "chat") return instance.chatWithTools([], { tools: [], maxRetries: 3 });
    for await (const chunk of instance.streamWithTools([], { tools: [] })) seen.push(chunk);
    return seen;
  }
  it.each([
    ["EOF", []],
    ["null event", [null]],
    ["failed", [{ type: "response.failed" }]],
    ["incomplete", [{ type: "response.incomplete" }]],
    ["error", [{ type: "error" }]],
    [
      "inconsistent status",
      [{ type: "response.completed", response: { status: "incomplete", output: [call()] } }],
    ],
    ["missing output", [{ type: "response.completed", response: { status: "completed" } }]],
    ["null output item", [completed([null])]],
    ["invalid later call", [completed([call(), call("call_2", "{")])]],
    ["contradictory final arguments", [completed([call("call_1", '{"path":"b"}')])]],
    ["conflicting identity", [completed([{ ...call(), name: "write_file" }])]],
  ])("rejects %s without executable calls or retry", async (_label, terminal) => {
    const seen: StreamChunk[] = [];
    await expect(consume([added, done, ...terminal], seen)).rejects.toBeInstanceOf(
      ResponseIntegrityError,
    );
    expect(seen.filter((chunk) => chunk.type === "tool_use_end" || chunk.type === "done")).toEqual(
      [],
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it("merges terminal-only calls and deduplicates repeated identities", async () => {
    const result = await consume([added, done, completed([call(), call(), call("call_2")])]);
    const calls = Array.isArray(result)
      ? result.filter((chunk) => chunk.type === "tool_use_end").map((chunk) => chunk.toolCall)
      : result.toolCalls;
    expect(calls.map((entry) => entry?.id)).toEqual(["call_1", "call_2"]);
  });
  it("accepts authoritative terminal arguments that finish a provisional fragment", async () => {
    const result = await consume([{ ...added, item: call("call_1", '{"path":') }, completed()]);
    const calls = Array.isArray(result)
      ? result.filter((chunk) => chunk.type === "tool_use_end").map((chunk) => chunk.toolCall)
      : result.toolCalls;
    expect(calls).toEqual([{ id: "call_1", name: "read_file", input: { path: "a" } }]);
  });
  it("accepts a completed text-only response", async () => {
    const result = await consume([completed([])]);
    if (Array.isArray(result)) expect(result).toEqual([{ type: "done", stopReason: "end_turn" }]);
    else expect(result.stopReason).toBe("end_turn");
  });
});

it("withholds tool ends until completion and preserves cancellation", async () => {
  const abort = new AbortController();
  mockFetch.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              [added, done, { type: "response.output_text.delta", delta: "pending" }]
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(""),
            ),
          );
        },
      }),
    ),
  );
  const instance = await provider();
  const stream = instance
    .streamWithTools([], { tools: [], signal: abort.signal })
    [Symbol.asyncIterator]();
  expect((await stream.next()).value?.type).toBe("tool_use_start");
  expect((await stream.next()).value?.type).toBe("text");
  abort.abort(new Error("cancel test"));
  await expect(stream.next()).rejects.toThrow("cancel test");
});

it("rejects malformed SSE JSON without leaking response data or retrying", async () => {
  mockFetch.mockImplementation(async () => new Response("data: secret-invalid-json\n\n"));
  const instance = await provider();
  await expect(instance.chatWithTools([], { tools: [], maxRetries: 3 })).rejects.toThrow(
    "Malformed tool response event",
  );
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it("accepts SSE data fields without a space", async () => {
  mockFetch.mockResolvedValue(new Response(`data:${JSON.stringify(completed())}\n\n`));
  const instance = await provider();
  const result = await instance.chatWithTools([], { tools: [] });
  expect(result.toolCalls).toEqual([{ id: "call_1", name: "read_file", input: { path: "a" } }]);
});

it("rejects a malformed no-space SSE event even before a valid terminal", async () => {
  mockFetch.mockResolvedValue(
    new Response(`data:{invalid-secret\n\ndata:${JSON.stringify(completed())}\n\n`),
  );
  const instance = await provider();
  const seen: StreamChunk[] = [];
  await expect(
    (async () => {
      for await (const event of instance.streamWithTools([], { tools: [] })) seen.push(event);
    })(),
  ).rejects.toThrow("Malformed tool response event");
  expect(seen).toEqual([]);
});
