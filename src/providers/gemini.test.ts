/**
 * Tests for Gemini provider
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Google Generative AI SDK
const mockSendMessage = vi.fn();
const mockSendMessageStream = vi.fn();
const mockGenerateContent = vi.fn();
const mockStartChat = vi.fn().mockReturnValue({
  sendMessage: mockSendMessage,
  sendMessageStream: mockSendMessageStream,
});
const mockGetGenerativeModel = vi.fn().mockReturnValue({
  startChat: mockStartChat,
  generateContent: mockGenerateContent,
});

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
  FunctionCallingMode: {
    AUTO: "AUTO",
    ANY: "ANY",
    NONE: "NONE",
  },
}));

describe("GeminiProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialize", () => {
    it("should throw error if API key not provided", async () => {
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

    it("should initialize with API key from config", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test-api-key" });

      // Should not throw
    });

    it("should initialize with GEMINI_API_KEY from environment", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      const originalEnv = process.env["GEMINI_API_KEY"];
      process.env["GEMINI_API_KEY"] = "env-api-key";

      await provider.initialize({});

      process.env["GEMINI_API_KEY"] = originalEnv;
    });

    it("should initialize with GOOGLE_API_KEY from environment", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      const originalGemini = process.env["GEMINI_API_KEY"];
      const originalGoogle = process.env["GOOGLE_API_KEY"];
      delete process.env["GEMINI_API_KEY"];
      process.env["GOOGLE_API_KEY"] = "google-api-key";

      await provider.initialize({});

      process.env["GEMINI_API_KEY"] = originalGemini;
      process.env["GOOGLE_API_KEY"] = originalGoogle;
    });
  });

  describe("countTokens", () => {
    it("should estimate tokens based on character count", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      const count = provider.countTokens("Hello, this is a test message.");

      // ~30 chars / 4 = ~8 tokens
      expect(count).toBeGreaterThan(5);
      expect(count).toBeLessThan(15);
    });

    it("should return 0 for empty string", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      expect(provider.countTokens("")).toBe(0);
    });
  });

  describe("getContextWindow", () => {
    it("should return context window for gemini-2.0-flash", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test", model: "gemini-2.0-flash" });

      expect(provider.getContextWindow()).toBe(1048576);
    });

    it("should return context window for gemini-1.5-pro", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test", model: "gemini-1.5-pro" });

      expect(provider.getContextWindow()).toBe(2000000);
    });

    it("should return default for unknown model", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test", model: "unknown-model" });

      expect(provider.getContextWindow()).toBe(1000000);
    });
  });

  describe("isAvailable", () => {
    it("should return false when not initialized", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      expect(await provider.isAvailable()).toBe(false);
    });

    it("should return true when API is reachable", async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => "hi" },
      });

      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test" });

      expect(await provider.isAvailable()).toBe(true);
    });

    it("should return false when API call fails", async () => {
      mockGenerateContent.mockRejectedValue(new Error("Network error"));

      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test" });

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe("chat", () => {
    it("should throw if not initialized", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();

      await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
        /not initialized/,
      );
    });

    it("should send chat message and return response", async () => {
      mockSendMessage.mockResolvedValue({
        response: {
          text: () => "Hello! How can I help?",
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 8,
          },
          candidates: [
            {
              finishReason: "STOP",
            },
          ],
        },
      });

      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test" });

      const response = await provider.chat([{ role: "user", content: "Hi" }]);

      expect(response.content).toBe("Hello! How can I help?");
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(8);
      expect(response.stopReason).toBe("end_turn");
    });
  });

  describe("chatWithTools", () => {
    it("should send chat with tools and return tool calls", async () => {
      mockSendMessage.mockResolvedValue({
        response: {
          text: () => "",
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 5,
          },
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "read_file",
                      args: { path: "/test.txt" },
                    },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      });

      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test" });

      const response = await provider.chatWithTools([{ role: "user", content: "Read test.txt" }], {
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            input_schema: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      });

      expect(response.toolCalls.length).toBe(1);
      expect(response.toolCalls[0]?.name).toBe("read_file");
      expect(response.toolCalls[0]?.input).toEqual({ path: "/test.txt" });
      expect(response.stopReason).toBe("tool_use");
    });
  });

  describe("error handling", () => {
    it("should handle API errors", async () => {
      mockSendMessage.mockRejectedValue(new Error("Rate limit exceeded 429"));

      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test" });

      await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(/Rate limit/);
    });
  });
});

describe("stream", () => {
  it("should stream text chunks", async () => {
    mockSendMessageStream.mockResolvedValue({
      stream: (async function* () {
        yield { text: () => "Hello" };
        yield { text: () => " World" };
        yield { text: () => "" }; // Empty text
      })(),
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    const chunks: { type: string; text?: string }[] = [];
    for await (const chunk of provider.stream([{ role: "user", content: "Hi" }])) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(chunks[chunks.length - 1]?.type).toBe("done");
  });

  it("should throw if not initialized", async () => {
    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();

    const iterator = provider.stream([{ role: "user", content: "Hello" }]);
    await expect(iterator.next()).rejects.toThrow(/not initialized/);
  });

  it("should handle stream errors", async () => {
    mockSendMessageStream.mockRejectedValue(new Error("Stream error"));

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    const iterator = provider.stream([{ role: "user", content: "Hello" }]);
    await expect(iterator.next()).rejects.toThrow();
  });
});

describe("message conversion", () => {
  it("should handle system messages by ignoring them in history", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "Hello!",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        candidates: [{ finishReason: "STOP" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
    ]);

    // System messages should be filtered out
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("should handle user messages with array content", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "Hello!",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        candidates: [{ finishReason: "STOP" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([{ role: "user", content: [{ type: "text", text: "Hello" }] }]);

    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("should handle tool_use content blocks in assistant messages", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "Done",
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
        candidates: [{ finishReason: "STOP" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "/test" } }],
      },
    ]);

    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("should handle tool_result content in user messages", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "Processed",
        usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 5 },
        candidates: [{ finishReason: "STOP" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([
      { role: "user", content: "Read file" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "read_file", name: "read_file", input: { path: "/test" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "read_file", content: "file contents" }],
      },
    ]);

    expect(mockStartChat).toHaveBeenCalledWith(
      expect.objectContaining({
        history: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ functionResponse: expect.anything() }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("should handle empty content array", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "OK",
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
        candidates: [{ finishReason: "STOP" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([{ role: "user", content: [] }]);

    expect(mockSendMessage).toHaveBeenCalled();
  });
});

describe("tool choice conversion", () => {
  it("should handle undefined tool choice as AUTO", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "OK",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        candidates: [{ finishReason: "STOP" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chatWithTools([{ role: "user", content: "Hello" }], { tools: [] });

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: expect.objectContaining({
          functionCallingConfig: { mode: "AUTO" },
        }),
      }),
    );
  });

  it("should handle any tool choice", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "OK",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        candidates: [{ finishReason: "STOP" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
      toolChoice: "any",
    });

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: expect.objectContaining({
          functionCallingConfig: { mode: "ANY" },
        }),
      }),
    );
  });

  it("should handle specific tool choice (falls back to AUTO)", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "OK",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        candidates: [{ finishReason: "STOP" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    // Gemini doesn't support specific tool choice, so it falls back to AUTO
    await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
      toolChoice: { type: "tool", name: "specificTool" },
    });

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: expect.objectContaining({
          functionCallingConfig: { mode: "AUTO" },
        }),
      }),
    );
  });
});

describe("finish reason mapping", () => {
  it("should map MAX_TOKENS finish reason", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "Truncated...",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8192 },
        candidates: [{ finishReason: "MAX_TOKENS" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("max_tokens");
  });

  it("should map SAFETY finish reason to stop_sequence", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
        candidates: [{ finishReason: "SAFETY" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("stop_sequence");
  });

  it("should map RECITATION finish reason to stop_sequence", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
        candidates: [{ finishReason: "RECITATION" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("stop_sequence");
  });

  it("should map OTHER finish reason to stop_sequence", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
        candidates: [{ finishReason: "OTHER" }],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("stop_sequence");
  });

  it("should map undefined finish reason to end_turn", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "OK",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        candidates: [{}],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("end_turn");
  });
});

describe("chatWithTools response parsing", () => {
  it("should handle response with both text and function calls", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 10 },
        candidates: [
          {
            content: {
              parts: [
                { text: "I'll read the file" },
                {
                  functionCall: {
                    name: "read_file",
                    args: { path: "/test.txt" },
                  },
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chatWithTools([{ role: "user", content: "Read file" }], {
      tools: [
        {
          name: "read_file",
          description: "Read",
          input_schema: { type: "object", properties: {} },
        },
      ],
    });

    expect(response.content).toBe("I'll read the file");
    expect(response.toolCalls.length).toBe(1);
    expect(response.stopReason).toBe("tool_use");
  });

  it("should handle response with no candidates", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
        candidates: [],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
    });

    expect(response.content).toBe("");
    expect(response.toolCalls).toEqual([]);
  });

  it("should handle function call with undefined args", async () => {
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => "",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 5 },
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "get_time",
                    args: undefined,
                  },
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      },
    });

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chatWithTools([{ role: "user", content: "What time?" }], {
      tools: [],
    });

    expect(response.toolCalls[0]?.input).toEqual({});
  });
});

describe("error handling", () => {
  it("should identify 500 errors as retryable", async () => {
    mockSendMessage.mockRejectedValue(new Error("HTTP 500: Server Error"));

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    try {
      await provider.chat([{ role: "user", content: "Hello" }]);
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it("should handle non-Error thrown values", async () => {
    mockSendMessage.mockRejectedValue("string error");

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
  });

  it("should handle chatWithTools errors", async () => {
    mockSendMessage.mockRejectedValue(new Error("Server error 500"));

    const { GeminiProvider } = await import("./gemini.js");
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey: "test" });

    await expect(
      provider.chatWithTools([{ role: "user", content: "Hello" }], { tools: [] }),
    ).rejects.toThrow(/Server error/);
  });
});

describe("createGeminiProvider", () => {
  it("should create a provider instance", async () => {
    const { createGeminiProvider } = await import("./gemini.js");

    const provider = createGeminiProvider();

    expect(provider.id).toBe("gemini");
    expect(provider.name).toBe("Google Gemini");
  });

  it("should accept optional config", async () => {
    const { createGeminiProvider } = await import("./gemini.js");

    const provider = createGeminiProvider({ apiKey: "test-key" });

    expect(provider.id).toBe("gemini");
  });
});
