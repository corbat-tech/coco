/**
 * Tests for Anthropic provider
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMessagesCreate = vi.fn().mockResolvedValue({
  id: "msg_123",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Hello! How can I help you?" }],
  model: "claude-sonnet-4-20250514",
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 20 },
});

const mockMessagesStream = vi.fn().mockReturnValue({
  async *[Symbol.asyncIterator]() {
    yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } };
    yield { type: "content_block_delta", delta: { type: "text_delta", text: " World" } };
  },
});

// Mock @anthropic-ai/sdk
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
      stream: mockMessagesStream,
    },
  })),
  APIError: class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

describe("AnthropicProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessagesCreate.mockResolvedValue({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello! How can I help you?" }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  });

  describe("initialization", () => {
    it("should have correct id and name", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();

      expect(provider.id).toBe("anthropic");
      expect(provider.name).toBe("Anthropic Claude");
    });

    it("should initialize with API key", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();

      await provider.initialize({ apiKey: "test-api-key" });
      // If it doesn't throw, initialization succeeded
      expect(true).toBe(true);
    });

    it("should use environment variable if no API key provided", async () => {
      const originalEnv = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "env-api-key";

      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();

      await provider.initialize({});
      // If it doesn't throw, initialization succeeded
      expect(true).toBe(true);

      process.env.ANTHROPIC_API_KEY = originalEnv;
    });

    it("should throw if no API key available", async () => {
      const originalEnv = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();

      await expect(provider.initialize({})).rejects.toThrow();

      process.env.ANTHROPIC_API_KEY = originalEnv;
    });
  });

  describe("chat", () => {
    it("should send chat message and receive response", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const response = await provider.chat([
        { role: "user", content: "Hello!" },
      ]);

      expect(response.content).toBe("Hello! How can I help you?");
      expect(response.stopReason).toBe("end_turn");
    });

    it("should include usage information", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const response = await provider.chat([
        { role: "user", content: "Test" },
      ]);

      expect(response.usage).toBeDefined();
      expect(response.usage?.inputTokens).toBe(10);
      expect(response.usage?.outputTokens).toBe(20);
    });

    it("should handle system messages", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      await provider.chat(
        [{ role: "user", content: "Hello!" }],
        { system: "You are a helpful assistant." }
      );

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "You are a helpful assistant.",
        })
      );
    });

    it("should handle conversation history", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      await provider.chat([
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "And 3+3?" },
      ]);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "What is 2+2?" }),
            expect.objectContaining({ role: "assistant", content: "4" }),
            expect.objectContaining({ role: "user", content: "And 3+3?" }),
          ]),
        })
      );
    });
  });

  describe("chatWithTools", () => {
    it("should send tools with request", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const tools = [
        {
          name: "readFile",
          description: "Read a file",
          input_schema: {
            type: "object" as const,
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
      ];

      await provider.chatWithTools(
        [{ role: "user", content: "Read file.txt" }],
        { tools }
      );

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: "readFile",
              description: "Read a file",
            }),
          ]),
        })
      );
    });

    it("should parse tool use response", async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: "I'll read that file for you." },
          {
            type: "tool_use",
            id: "tool_123",
            name: "readFile",
            input: { path: "file.txt" },
          },
        ],
        model: "claude-sonnet-4-20250514",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 30 },
      });

      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const response = await provider.chatWithTools(
        [{ role: "user", content: "Read file.txt" }],
        { tools: [] }
      );

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0].name).toBe("readFile");
      expect(response.toolCalls?.[0].input).toEqual({ path: "file.txt" });
    });
  });

  describe("token counting", () => {
    it("should estimate token count", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const text = "Hello, world!";
      const count = provider.countTokens(text);

      // Rough estimate: ~4 chars per token
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(text.length);
    });

    it("should return context window size", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const contextWindow = provider.getContextWindow();

      expect(contextWindow).toBe(200000); // Claude's context window
    });
  });

  describe("error handling", () => {
    it("should handle API errors gracefully", async () => {
      mockMessagesCreate.mockRejectedValueOnce(
        new Error("API rate limit exceeded")
      );

      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      await expect(
        provider.chat([{ role: "user", content: "Hello" }])
      ).rejects.toThrow();
    });

    it("should handle timeout errors", async () => {
      mockMessagesCreate.mockRejectedValueOnce(
        new Error("Request timeout")
      );

      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      await expect(
        provider.chat([{ role: "user", content: "Hello" }])
      ).rejects.toThrow();
    });
  });

  describe("configuration", () => {
    it("should use custom model", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({
        apiKey: "test-key",
        model: "claude-opus-4-20250514",
      });

      await provider.chat([{ role: "user", content: "Hello" }]);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-opus-4-20250514",
        })
      );
    });

    it("should use custom max tokens", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({
        apiKey: "test-key",
        maxTokens: 4096,
      });

      await provider.chat([{ role: "user", content: "Hello" }]);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096,
        })
      );
    });

    it("should use custom temperature", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({
        apiKey: "test-key",
        temperature: 0.7,
      });

      await provider.chat([{ role: "user", content: "Hello" }]);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        })
      );
    });
  });

  describe("isAvailable", () => {
    it("should return true when client is available and working", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const available = await provider.isAvailable();

      expect(available).toBe(true);
    });

    it("should return false when not initialized", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });
  });
});

describe("createAnthropicProvider", () => {
  it("should create a provider instance", async () => {
    const { createAnthropicProvider } = await import("./anthropic.js");

    const provider = createAnthropicProvider();

    expect(provider).toBeDefined();
    expect(provider.id).toBe("anthropic");
  });

  it("should accept optional config", async () => {
    const { createAnthropicProvider } = await import("./anthropic.js");

    const provider = createAnthropicProvider({ apiKey: "test-key" });

    expect(provider).toBeDefined();
  });
});
