import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/gcloud.js", () => ({
  getCachedADCToken: vi.fn().mockResolvedValue({
    accessToken: "adc-token",
    expiresAt: Date.now() + 60_000,
  }),
}));

describe("VertexProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  it("sends functionResponse parts under user role", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "done" }],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { VertexProvider } = await import("./vertex.js");
    const provider = new VertexProvider();
    await provider.initialize({ project: "test-project", location: "global" });

    await provider.chatWithTools(
      [
        { role: "user", content: "Find the weather" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "get_weather",
              input: { city: "Madrid" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "Sunny",
            },
          ],
        },
      ],
      {
        model: "gemini-2.5-pro",
        tools: [
          {
            name: "get_weather",
            description: "Returns weather by city",
            input_schema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        ],
      },
    );

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(call?.[1]?.body)) as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };

    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Find the weather" }] },
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "get_weather", args: { city: "Madrid" } },
            thoughtSignature: "skip_thought_signature_validator",
            thought_signature: "skip_thought_signature_validator",
          },
        ],
      },
      {
        role: "user",
        parts: [{ functionResponse: { name: "get_weather", response: { result: "Sunny" } } }],
      },
    ]);
  });

  it("preserves thought_signature in tool_use parts", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "ok" }],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { VertexProvider } = await import("./vertex.js");
    const provider = new VertexProvider();
    await provider.initialize({ project: "test-project", location: "global" });

    await provider.chatWithTools(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "bash_exec",
              input: { command: "date" },
              geminiThoughtSignature: "sig-123",
            },
          ],
        },
      ],
      {
        model: "gemini-3-flash-preview",
        tools: [
          {
            name: "bash_exec",
            description: "Run shell command",
            input_schema: {
              type: "object",
              properties: {
                command: { type: "string" },
              },
              required: ["command"],
            },
          },
        ],
      },
    );

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(call?.[1]?.body)) as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    const modelParts = body.contents.find((c) => c.role === "model")?.parts ?? [];
    const functionCall = modelParts[0]?.["functionCall"] as
      | { thoughtSignature?: string; thought_signature?: string }
      | undefined;
    const partSignature = modelParts[0] as
      | { thoughtSignature?: string; thought_signature?: string }
      | undefined;

    expect(functionCall?.thoughtSignature).toBeUndefined();
    expect(functionCall?.thought_signature).toBeUndefined();
    expect(partSignature?.thoughtSignature).toBe("sig-123");
    expect(partSignature?.thought_signature).toBe("sig-123");
  });

  it("returns thought_signature in parsed tool calls", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "bash_exec",
                      args: { command: "date" },
                    },
                    thoughtSignature: "sig-abc",
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { VertexProvider } = await import("./vertex.js");
    const provider = new VertexProvider();
    await provider.initialize({ project: "test-project", location: "global" });

    const response = await provider.chatWithTools([{ role: "user", content: "run date" }], {
      model: "gemini-3-flash-preview",
      tools: [
        {
          name: "bash_exec",
          description: "Run shell command",
          input_schema: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      ],
    });

    expect(response.toolCalls[0]?.geminiThoughtSignature).toBe("sig-abc");
  });

  it("uses the global endpoint for global location", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { VertexProvider } = await import("./vertex.js");
    const provider = new VertexProvider();
    await provider.initialize({ project: "test-project", location: "global" });
    await provider.chat([{ role: "user", content: "hi" }], { model: "gemini-2.5-pro" });

    const url = String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]);
    expect(url).toContain(
      "https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/",
    );
  });

  it("uses a regional endpoint for regional locations", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { VertexProvider } = await import("./vertex.js");
    const provider = new VertexProvider();
    await provider.initialize({ project: "test-project", location: "europe-west1" });
    await provider.chat([{ role: "user", content: "hi" }], { model: "gemini-2.5-pro" });

    const url = String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]);
    expect(url).toContain(
      "https://europe-west1-aiplatform.googleapis.com/v1/projects/test-project/locations/europe-west1/",
    );
  });

  it("parses SSE streams with CRLF boundaries", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"candidates":[{"content":{"parts":[{"text":"Ho"}]},"finishReason":"STOP"}]}\r\n\r\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"candidates":[{"content":{"parts":[{"text":"la"}]},"finishReason":"STOP"}]}\r\n\r\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\r\n\r\n"));
        controller.close();
      },
    });

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { VertexProvider } = await import("./vertex.js");
    const provider = new VertexProvider();
    await provider.initialize({ project: "test-project", location: "global" });

    const chunks: string[] = [];
    for await (const chunk of provider.stream([{ role: "user", content: "hola" }])) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }

    expect(chunks.join("")).toBe("Hola");
  });

  it("ignores malformed SSE JSON chunks and continues streaming", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {invalid-json}\r\n\r\n"));
        controller.enqueue(
          encoder.encode(
            'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\r\n\r\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\r\n\r\n"));
        controller.close();
      },
    });

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { VertexProvider } = await import("./vertex.js");
    const provider = new VertexProvider();
    await provider.initialize({ project: "test-project", location: "global" });

    const chunks: string[] = [];
    for await (const chunk of provider.stream([{ role: "user", content: "hola" }])) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }

    expect(chunks.join("")).toBe("ok");
  });

  it("deduplicates repeated functionCall chunks in streamWithTools", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_env","args":{"name":"HOME"}},"thoughtSignature":"sig-home"}]},"finishReason":"STOP"}]}\r\n\r\n',
          ),
        );
        // Some Vertex streams repeat cumulative parts; this duplicate must not emit twice.
        controller.enqueue(
          encoder.encode(
            'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_env","args":{"name":"HOME"}},"thoughtSignature":"sig-home"}]},"finishReason":"STOP"}]}\r\n\r\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\r\n\r\n"));
        controller.close();
      },
    });

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { VertexProvider } = await import("./vertex.js");
    const provider = new VertexProvider();
    await provider.initialize({ project: "test-project", location: "global" });

    const chunks = [];
    for await (const chunk of provider.streamWithTools([{ role: "user", content: "hola" }], {
      model: "gemini-3-flash-preview",
      tools: [
        {
          name: "get_env",
          description: "Get environment variable",
          input_schema: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
      ],
    })) {
      chunks.push(chunk);
    }

    const starts = chunks.filter((c) => c.type === "tool_use_start");
    const ends = chunks.filter((c) => c.type === "tool_use_end");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      type: "tool_use_start",
      toolCall: {
        name: "get_env",
        input: { name: "HOME" },
        geminiThoughtSignature: "sig-home",
      },
    });
  });
});
