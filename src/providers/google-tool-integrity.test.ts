import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GoogleToolBatch } from "./google-tool-integrity.js";
import { ResponseIntegrityError } from "./response-integrity.js";
import type { StreamChunk } from "./types.js";

const sdk = vi.hoisted(() => ({ generate: vi.fn(), stream: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: sdk.generate, generateContentStream: sdk.stream };
  },
  FunctionCallingConfigMode: { AUTO: "AUTO", ANY: "ANY" },
}));

const part = (args: unknown = {}, id?: string) => ({
  functionCall: { name: "read_file", args, ...(id === undefined ? {} : { id }) },
  thoughtSignature: "opaque-signature",
});
const response = (parts: unknown[], finishReason?: string) => ({
  candidates: [{ content: { parts }, ...(finishReason ? { finishReason } : {}) }],
});

describe("Google native tool integrity", () => {
  it.each([
    undefined,
    "MAX_TOKENS",
    "SAFETY",
    "MALFORMED_FUNCTION_CALL",
    "UNEXPECTED_TOOL_CALL",
    "OTHER",
  ])("rejects tools with terminal %s", (reason) => {
    const batch = new GoogleToolBatch("gemini");
    batch.add([part()], reason);
    expect(() => batch.complete()).toThrow(ResponseIntegrityError);
  });
  it.each([null, [], "{}", 3, false])(
    "rejects invalid native args %s across an entire batch",
    (args) => {
      const batch = new GoogleToolBatch("vertex");
      batch.add([part({}, "good"), part(args, "bad")], "STOP");
      expect(() => batch.complete()).toThrow(ResponseIntegrityError);
    },
  );
  it("accepts native omitted args only after STOP and preserves signatures", () => {
    const batch = new GoogleToolBatch("gemini");
    batch.add([{ functionCall: { name: "ping" }, thoughtSignature: "sig" }], "STOP");
    expect(batch.complete().toolCalls[0]).toMatchObject({
      input: {},
      geminiThoughtSignature: "sig",
    });
  });
  it("keeps distinct id-less identical calls and avoids native ID collisions", () => {
    const batch = new GoogleToolBatch("vertex");
    batch.add([part(), part(), part({}, "vertex_call_1")], "STOP");
    expect(batch.complete().toolCalls.map((call) => call.id)).toEqual([
      "vertex_call_2",
      "vertex_call_3",
      "vertex_call_1",
    ]);
  });
  it("deduplicates only matching explicit IDs", () => {
    const batch = new GoogleToolBatch("gemini");
    batch.add([part({ a: 1, b: 2 }, "id")]);
    batch.add([part({ b: 2, a: 1 }, "id"), part({}, "other")], "STOP");
    expect(batch.complete().toolCalls).toHaveLength(2);
  });
  it("rejects conflicting explicit IDs", () => {
    const batch = new GoogleToolBatch("gemini");
    batch.add([part({}, "id"), part({ a: 1 }, "id")], "STOP");
    expect(() => batch.complete()).toThrow(ResponseIntegrityError);
  });
  it.each([
    { name: "" },
    { name: "ping", id: "" },
    { name: "ping", willContinue: true },
    { name: "ping", partialArgs: [] },
  ])("rejects malformed or partial call %#", (functionCall) => {
    const batch = new GoogleToolBatch("gemini");
    expect(() => {
      batch.add([{ functionCall }], "STOP");
      batch.complete();
    }).toThrow(ResponseIntegrityError);
  });
  it("rejects content after terminal", () => {
    const batch = new GoogleToolBatch("gemini");
    batch.add([part()], "STOP");
    expect(() => batch.add([part()])).toThrow(ResponseIntegrityError);
  });
});

describe.each(["gemini", "vertex"] as const)("%s provider tool terminal", (kind) => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());
  async function provider(events: unknown[], streaming = true) {
    if (kind === "gemini") {
      sdk.generate.mockResolvedValue(events[0]);
      sdk.stream.mockResolvedValue(
        (async function* () {
          for (const event of events) yield event;
        })(),
      );
      const { GeminiProvider } = await import("./gemini.js");
      const p = new GeminiProvider();
      await p.initialize({ apiKey: "fixture" });
      return p;
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            streaming
              ? events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
              : JSON.stringify(events[0]),
            { status: 200 },
          ),
        ),
    );
    const { VertexProvider } = await import("./vertex.js");
    const p = new VertexProvider();
    await p.initialize({ apiKey: "fixture", project: "fixture" });
    return p;
  }
  async function collect(events: unknown[], seen: StreamChunk[]) {
    const p = await provider(events);
    for await (const event of p.streamWithTools([{ role: "user", content: "read" }], { tools: [] }))
      seen.push(event);
  }
  it("waits for native STOP and preserves all distinct calls/signatures", async () => {
    const seen: StreamChunk[] = [];
    await collect([response([part()]), response([part()]), response([], "STOP")], seen);
    expect(seen.filter((e) => e.type === "tool_use_end")).toHaveLength(2);
    expect(
      seen.filter((e) => e.type === "tool_use_end").map((e) => e.toolCall?.geminiThoughtSignature),
    ).toEqual(["opaque-signature", "opaque-signature"]);
    expect(seen.at(-1)).toMatchObject({ type: "done", stopReason: "tool_use" });
  });
  it.each([undefined, "MAX_TOKENS", "SAFETY"])(
    "publishes zero calls on missing/invalid terminal %s",
    async (reason) => {
      const seen: StreamChunk[] = [];
      await expect(collect([response([part()], reason)], seen)).rejects.toBeInstanceOf(
        ResponseIntegrityError,
      );
      expect(seen).toEqual([]);
    },
  );
  it("publishes zero calls for a mixed valid/invalid batch", async () => {
    const seen: StreamChunk[] = [];
    await expect(collect([response([part(), part(null)], "STOP")], seen)).rejects.toBeInstanceOf(
      ResponseIntegrityError,
    );
    expect(seen).toEqual([]);
  });
  it("accepts a complete nonstream tool batch", async () => {
    const p = await provider([response([part({}, "native-id")], "STOP")], false);
    const result = await p.chatWithTools([], { tools: [] });
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toEqual([
      { id: "native-id", name: "read_file", input: {}, geminiThoughtSignature: "opaque-signature" },
    ]);
  });
  if (kind === "vertex") {
    it.each(["data: {broken}\n\n", "data: {truncated"])(
      "rejects malformed SSE after a valid batch without emitting tools: %s",
      async (trailer) => {
        const p = await provider([]);
        vi.mocked(fetch).mockResolvedValueOnce(
          new Response(`data: ${JSON.stringify(response([part()], "STOP"))}\n\n${trailer}`),
        );
        const seen: StreamChunk[] = [];
        await expect(
          (async () => {
            for await (const chunk of p.streamWithTools([], { tools: [] })) seen.push(chunk);
          })(),
        ).rejects.toBeInstanceOf(ResponseIntegrityError);
        expect(seen).toEqual([]);
      },
    );
  }
  it.each([undefined, "MAX_TOKENS", "SAFETY"])(
    "rejects nonstream tools on %s without retry",
    async (reason) => {
      const p = await provider([response([part()], reason)], false);
      await expect(p.chatWithTools([], { tools: [], maxRetries: 2 })).rejects.toBeInstanceOf(
        ResponseIntegrityError,
      );
      expect(kind === "gemini" ? sdk.generate : fetch).toHaveBeenCalledOnce();
    },
  );
});
