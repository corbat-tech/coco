import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return {
      models: {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
      },
    };
  }),
  FunctionCallingConfigMode: {
    AUTO: "AUTO",
    ANY: "ANY",
  },
}));

describe("GeminiProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialize", () => {
    it("throws if API key is missing", async () => {
      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();
      const originalGemini = process.env["GEMINI_API_KEY"];
      const originalGoogle = process.env["GOOGLE_API_KEY"];
      delete process.env["GEMINI_API_KEY"];
      delete process.env["GOOGLE_API_KEY"];

      await expect(provider.initialize({})).rejects.toThrow(/API key not provided/);

      process.env["GEMINI_API_KEY"] = originalGemini;
      process.env["GOOGLE_API_KEY"] = originalGoogle;
    });

    it("uses explicit config API key first", async () => {
      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();

      await expect(provider.initialize({ apiKey: "test-key" })).resolves.toBeUndefined();
    });
  });

  describe("chat", () => {
    it("sends stateless contents with system instruction", async () => {
      mockGenerateContent.mockResolvedValue({
        text: "Hello! How can I help?",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
      });

      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test-key" });

      const response = await provider.chat([
        { role: "system", content: "Be concise" },
        { role: "user", content: "Hi" },
      ]);

      expect(response.content).toBe("Hello! How can I help?");
      expect(response.stopReason).toBe("end_turn");
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(8);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [{ role: "user", parts: [{ text: "Hi" }] }],
          config: expect.objectContaining({
            systemInstruction: "Be concise",
          }),
        }),
      );
    });

    it("throws if not initialized", async () => {
      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();

      await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
        /not initialized/,
      );
    });
  });

  describe("chatWithTools", () => {
    const tools = [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ];

    it("returns function calls using provider ids from the API response", async () => {
      mockGenerateContent.mockResolvedValue({
        text: "",
        functionCalls: [{ id: "call-123", name: "read_file", args: { path: "a.txt" } }],
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 5 },
      });

      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test-key" });

      const response = await provider.chatWithTools([{ role: "user", content: "Read a.txt" }], {
        tools,
      });

      expect(response.stopReason).toBe("tool_use");
      expect(response.toolCalls).toEqual([
        {
          id: "call-123",
          name: "read_file",
          input: { path: "a.txt" },
        },
      ]);
    });

    it("sends tool responses back as user functionResponse parts with matching id", async () => {
      mockGenerateContent.mockResolvedValue({
        text: "Done",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
      });

      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test-key" });

      await provider.chatWithTools(
        [
          { role: "user", content: "Read a.txt" },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "call-123",
                name: "read_file",
                input: { path: "a.txt" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "call-123",
                content: "file contents",
              },
            ],
          },
        ],
        { tools, toolChoice: { type: "tool", name: "read_file" } as any },
      );

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [
            { role: "user", parts: [{ text: "Read a.txt" }] },
            {
              role: "model",
              parts: [{ functionCall: { id: "call-123", name: "read_file", args: { path: "a.txt" } } }],
            },
            {
              role: "user",
              parts: [
                {
                  functionResponse: {
                    id: "call-123",
                    name: "read_file",
                    response: { result: "file contents" },
                  },
                },
              ],
            },
          ],
          config: expect.objectContaining({
            toolConfig: {
              functionCallingConfig: {
                mode: "ANY",
                allowedFunctionNames: ["read_file"],
              },
            },
          }),
        }),
      );
    });
  });

  describe("streaming", () => {
    it("streams text chunks", async () => {
      mockGenerateContentStream.mockResolvedValue(
        (async function* () {
          yield { text: "Hello", candidates: [{ finishReason: undefined }] };
          yield { text: " world", candidates: [{ finishReason: "STOP" }] };
        })(),
      );

      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test-key" });

      const chunks = [];
      for await (const chunk of provider.stream([{ role: "user", content: "Hi" }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: "text", text: "Hello" },
        { type: "text", text: " world" },
        { type: "done", stopReason: "end_turn" },
      ]);
    });

    it("streams tool calls once per function call id", async () => {
      mockGenerateContentStream.mockResolvedValue(
        (async function* () {
          yield {
            text: undefined,
            functionCalls: [{ id: "call-1", name: "read_file", args: { path: "a.txt" } }],
            candidates: [{ finishReason: undefined }],
          };
          yield {
            text: undefined,
            functionCalls: [{ id: "call-1", name: "read_file", args: { path: "a.txt" } }],
            candidates: [{ finishReason: "STOP" }],
          };
        })(),
      );

      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test-key" });

      const chunks = [];
      for await (const chunk of provider.streamWithTools([{ role: "user", content: "Read a.txt" }], {
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            input_schema: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: "tool_use_start", toolCall: { id: "call-1", name: "read_file" } },
        {
          type: "tool_use_end",
          toolCall: { id: "call-1", name: "read_file", input: { path: "a.txt" } },
        },
        { type: "done", stopReason: "tool_use" },
      ]);
    });
  });

  describe("error handling", () => {
    it("marks server errors as retryable", async () => {
      mockGenerateContent.mockRejectedValue(new Error("HTTP 500: Server Error"));

      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test-key" });

      await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toMatchObject(
        expect.objectContaining({
          recoverable: true,
        }),
      );
    });
  });
});

describe("createGeminiProvider", () => {
  it("creates a provider without config", async () => {
    const { createGeminiProvider, GeminiProvider } = await import("./gemini.js");
    const provider = createGeminiProvider();
    expect(provider).toBeInstanceOf(GeminiProvider);
  });
});
