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
        parts: [{ functionCall: { name: "get_weather", args: { city: "Madrid" } } }],
      },
      {
        role: "user",
        parts: [{ functionResponse: { name: "get_weather", response: { result: "Sunny" } } }],
      },
    ]);
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
});
