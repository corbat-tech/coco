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

// Create a mock APIError class that we can reference
class MockAPIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

// Mock @anthropic-ai/sdk
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: mockMessagesCreate,
        stream: mockMessagesStream,
      },
    })),
    APIError: MockAPIError,
  };
});

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

      const response = await provider.chat([{ role: "user", content: "Hello!" }]);

      expect(response.content).toBe("Hello! How can I help you?");
      expect(response.stopReason).toBe("end_turn");
    });

    it("should include usage information", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const response = await provider.chat([{ role: "user", content: "Test" }]);

      expect(response.usage).toBeDefined();
      expect(response.usage?.inputTokens).toBe(10);
      expect(response.usage?.outputTokens).toBe(20);
    });

    it("should handle system messages", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      await provider.chat([{ role: "user", content: "Hello!" }], {
        system: "You are a helpful assistant.",
      });

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "You are a helpful assistant.",
        }),
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
        }),
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

      await provider.chatWithTools([{ role: "user", content: "Read file.txt" }], { tools });

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: "readFile",
              description: "Read a file",
            }),
          ]),
        }),
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

      const response = await provider.chatWithTools([{ role: "user", content: "Read file.txt" }], {
        tools: [],
      });

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
      mockMessagesCreate.mockRejectedValueOnce(new Error("API rate limit exceeded"));

      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
    });

    it("should handle timeout errors", async () => {
      mockMessagesCreate.mockRejectedValueOnce(new Error("Request timeout"));

      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
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
        }),
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
        }),
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
        }),
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

describe("stream", () => {
  it("should stream text chunks", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const chunks: { type: string; text?: string }[] = [];
    for await (const chunk of provider.stream([{ role: "user", content: "Hello" }])) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(chunks[chunks.length - 1]?.type).toBe("done");
  });

  it("should throw if not initialized", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();

    const iterator = provider.stream([{ role: "user", content: "Hello" }]);
    await expect(iterator.next()).rejects.toThrow(/not initialized/);
  });

  it("should handle stream errors", async () => {
    mockMessagesStream.mockReturnValueOnce({
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw new Error("Stream error");
      },
    });

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const iterator = provider.stream([{ role: "user", content: "Hello" }]);
    await expect(iterator.next()).rejects.toThrow();
  });

  it("should handle non-text delta events", async () => {
    mockMessagesStream.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield { type: "content_block_delta", delta: { type: "other_delta" } };
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } };
        yield { type: "message_start" }; // Non content_block_delta event
      },
    });

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const chunks: { type: string; text?: string }[] = [];
    for await (const chunk of provider.stream([{ role: "user", content: "Hello" }])) {
      chunks.push(chunk);
    }

    expect(chunks.filter((c) => c.type === "text").length).toBe(1);
    expect(chunks[chunks.length - 1]?.type).toBe("done");
  });
});

describe("token counting edge cases", () => {
  it("should return 0 for empty string", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();

    expect(provider.countTokens("")).toBe(0);
  });

  it("should handle code-heavy text", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();

    const codeText = "function foo() { return bar(x + y) * z[i]; }";
    const count = provider.countTokens(codeText);

    expect(count).toBeGreaterThan(0);
  });

  it("should handle whitespace-heavy text", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();

    // Text with > 30% whitespace
    const whitespaceText = "a   b   c   d   e   f   g   h   i   j";
    const count = provider.countTokens(whitespaceText);

    expect(count).toBeGreaterThan(0);
  });
});

describe("message content conversion", () => {
  it("should handle array content with text blocks", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await provider.chat([
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
    ]);

    expect(mockMessagesCreate).toHaveBeenCalled();
  });

  it("should handle tool_use content blocks", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await provider.chat([
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tool-1", name: "readFile", input: { path: "/test.txt" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "file contents" }],
      },
    ]);

    expect(mockMessagesCreate).toHaveBeenCalled();
  });

  it("should handle unknown content block types", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await provider.chat([
      {
        role: "user",
        content: [{ type: "unknown" as "text", text: "" }],
      },
    ]);

    expect(mockMessagesCreate).toHaveBeenCalled();
  });
});

describe("tool choice conversion", () => {
  it("should handle auto tool choice", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
      toolChoice: "auto",
    });

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "auto" },
      }),
    );
  });

  it("should handle any tool choice", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
      toolChoice: "any",
    });

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "any" },
      }),
    );
  });

  it("should handle specific tool choice", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
      toolChoice: { type: "tool", name: "readFile" },
    });

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "tool", name: "readFile" },
      }),
    );
  });
});

describe("stop reason mapping", () => {
  it("should map max_tokens stop reason", async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Truncated..." }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 8192 },
    });

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("max_tokens");
  });

  it("should map stop_sequence stop reason", async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "stop_sequence",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("stop_sequence");
  });

  it("should map tool_use stop reason", async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "test", input: {} }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const response = await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
    });

    expect(response.stopReason).toBe("tool_use");
  });

  it("should map unknown stop reason to end_turn", async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "unknown_reason",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("end_turn");
  });

  it("should map null stop reason to end_turn", async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      model: "claude-sonnet-4-20250514",
      stop_reason: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("end_turn");
  });
});

describe("error handling", () => {
  it("should handle Anthropic APIError with 429 status", async () => {
    mockMessagesCreate.mockRejectedValueOnce(new MockAPIError(429, "Rate limit exceeded"));

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
  });

  it("should handle Anthropic APIError with 500 status", async () => {
    mockMessagesCreate.mockRejectedValueOnce(new MockAPIError(500, "Internal server error"));

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
  });

  it("should handle Anthropic APIError with 400 status (non-retryable)", async () => {
    mockMessagesCreate.mockRejectedValueOnce(new MockAPIError(400, "Bad request"));

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
  });

  it("should handle non-Error thrown values", async () => {
    mockMessagesCreate.mockRejectedValueOnce("string error");

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
  });

  it("should handle chatWithTools errors", async () => {
    mockMessagesCreate.mockRejectedValueOnce(new MockAPIError(500, "Server error"));

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await expect(
      provider.chatWithTools([{ role: "user", content: "Hello" }], { tools: [] }),
    ).rejects.toThrow();
  });
});

describe("isAvailable", () => {
  it("should return false when API call fails", async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error("Network error"));

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const available = await provider.isAvailable();

    expect(available).toBe(false);
  });
});

describe("context window for different models", () => {
  it("should return context window for unknown model", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key", model: "unknown-model" });

    // Unknown models should get default context window
    expect(provider.getContextWindow()).toBe(200000);
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

describe("system prompt extraction (regression: bug fix)", () => {
  // Regression test for: system prompt was silently dropped from all API calls.
  // The messages array always contains a { role: "system" } entry from
  // getConversationContext(), but convertMessages() filters it out because
  // Anthropic requires it as a top-level parameter. Previously, streamWithTools
  // and chatWithTools never passed it, so the LLM ran without a system prompt.

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessagesCreate.mockResolvedValue({
      id: "msg_sys",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 5 },
    });
    mockMessagesStream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } };
      },
    });
  });

  it("chat() passes system message from messages array to Anthropic API", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await provider.chat([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "hello" },
    ]);

    const call = mockMessagesCreate.mock.calls[0]?.[0];
    expect(call?.system).toBe("You are a helpful assistant.");
    // The messages array must NOT contain the system entry (Anthropic rejects it)
    expect(call?.messages?.find((m: { role: string }) => m.role === "system")).toBeUndefined();
  });

  it("chatWithTools() passes system message from messages array to Anthropic API", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await provider.chatWithTools(
      [
        { role: "system", content: "You are a coding agent." },
        { role: "user", content: "write a file" },
      ],
      {
        tools: [
          {
            name: "write_file",
            description: "Write a file",
            input_schema: { type: "object", properties: {}, required: [] },
          },
        ],
      },
    );

    const call = mockMessagesCreate.mock.calls[0]?.[0];
    expect(call?.system).toBe("You are a coding agent.");
    expect(call?.messages?.find((m: { role: string }) => m.role === "system")).toBeUndefined();
  });

  it("stream() passes system message from messages array to Anthropic API", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const chunks = [];
    for await (const chunk of provider.stream([
      { role: "system", content: "Be concise." },
      { role: "user", content: "hello" },
    ])) {
      chunks.push(chunk);
    }

    const call = mockMessagesStream.mock.calls[0]?.[0];
    expect(call?.system).toBe("Be concise.");
    expect(call?.messages?.find((m: { role: string }) => m.role === "system")).toBeUndefined();
  });

  it("streamWithTools() passes system message from messages array to Anthropic API", async () => {
    // This is the PRIMARY code path used by agent-loop.ts — it MUST have a regression test.
    mockMessagesStream.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "content_block_start",
          content_block: { type: "tool_use", id: "tool_1", name: "write_file" },
        };
        yield {
          type: "content_block_delta",
          delta: {
            type: "input_json_delta",
            partial_json: '{"path":"out.html","content":"<h1>Hi</h1>"}',
          },
        };
        yield { type: "content_block_stop" };
      },
    });

    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    const chunks = [];
    for await (const chunk of provider.streamWithTools(
      [
        { role: "system", content: "You are an execution agent." },
        { role: "user", content: "create a file" },
      ],
      {
        tools: [
          {
            name: "write_file",
            description: "Write a file",
            input_schema: { type: "object", properties: {}, required: [] },
          },
        ],
      },
    )) {
      chunks.push(chunk);
    }

    const call = mockMessagesStream.mock.calls[0]?.[0];
    expect(call?.system).toBe("You are an execution agent.");
    expect(call?.messages?.find((m: { role: string }) => m.role === "system")).toBeUndefined();

    // Also verify the tool call was correctly assembled from streaming
    const toolEnd = chunks.find((c) => c.type === "tool_use_end");
    expect(toolEnd).toBeDefined();
    expect((toolEnd?.toolCall as { name?: string })?.name).toBe("write_file");
    expect((toolEnd?.toolCall as { input?: { path?: string } })?.input?.path).toBe("out.html");
  });

  it("options.system takes precedence over system message in array", async () => {
    const { AnthropicProvider } = await import("./anthropic.js");
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: "test-key" });

    await provider.chat(
      [
        { role: "system", content: "From messages array." },
        { role: "user", content: "hello" },
      ],
      { system: "From options — should win." },
    );

    const call = mockMessagesCreate.mock.calls[0]?.[0];
    expect(call?.system).toBe("From options — should win.");
  });
});
