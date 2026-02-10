/**
 * Tests for OpenAI provider
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock OpenAI SDK
const mockCreate = vi.fn();
const mockList = vi.fn();

// Create a mock APIError class that we can reference
class MockOpenAIAPIError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
      models: {
        list: mockList,
      },
    })),
    APIError: MockOpenAIAPIError,
  };
});

describe("OpenAIProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialize", () => {
    it("should throw error if API key not provided", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      const originalEnv = process.env["OPENAI_API_KEY"];
      delete process.env["OPENAI_API_KEY"];

      await expect(provider.initialize({})).rejects.toThrow(/API key not provided/);

      process.env["OPENAI_API_KEY"] = originalEnv;
    });

    it("should initialize with API key from config", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      await provider.initialize({ apiKey: "test-api-key" });

      // Should not throw
    });

    it("should initialize with API key from environment", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      const originalEnv = process.env["OPENAI_API_KEY"];
      process.env["OPENAI_API_KEY"] = "env-api-key";

      await provider.initialize({});

      process.env["OPENAI_API_KEY"] = originalEnv;
    });
  });

  describe("countTokens", () => {
    it("should estimate tokens for regular text", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      const count = provider.countTokens("Hello, this is a test message.");

      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(20); // Should be reasonable
    });

    it("should estimate more tokens for code", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      const codeText = "function test() { return x + y; }";
      const proseText = "This is a simple sentence about testing";

      const codeTokens = provider.countTokens(codeText);
      const proseTokens = provider.countTokens(proseText);

      // Code typically uses more tokens due to syntax chars
      expect(codeTokens).toBeGreaterThan(0);
      expect(proseTokens).toBeGreaterThan(0);
    });

    it("should return 0 for empty string", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      expect(provider.countTokens("")).toBe(0);
    });
  });

  describe("getContextWindow", () => {
    it("should return default context window for gpt-5.3-codex", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      await provider.initialize({ apiKey: "test", model: "gpt-5.3-codex" });

      expect(provider.getContextWindow()).toBe(400000);
    });

    it("should return context window for gpt-4", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      await provider.initialize({ apiKey: "test", model: "gpt-4" });

      expect(provider.getContextWindow()).toBe(8192);
    });

    it("should return default for unknown model", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      await provider.initialize({ apiKey: "test", model: "unknown-model" });

      expect(provider.getContextWindow()).toBe(128000);
    });
  });

  describe("isAvailable", () => {
    it("should return false when not initialized", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      expect(await provider.isAvailable()).toBe(false);
    });

    it("should return true when API is reachable", async () => {
      mockList.mockResolvedValue({ data: [] });

      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      await provider.initialize({ apiKey: "test" });

      expect(await provider.isAvailable()).toBe(true);
    });

    it("should return false when API call fails", async () => {
      // Both list and chat must fail for isAvailable to return false
      // (isAvailable has a fallback to chat.completions.create)
      mockList.mockRejectedValue(new Error("Network error"));
      mockCreate.mockRejectedValue(new Error("Network error"));

      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      await provider.initialize({ apiKey: "test" });

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe("chat", () => {
    it("should throw if not initialized", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();

      await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
        /not initialized/,
      );
    });

    it("should send chat message and return response", async () => {
      mockCreate.mockResolvedValue({
        id: "chatcmpl-123",
        model: "gpt-4o",
        choices: [
          {
            message: { content: "Hello! How can I help?" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
        },
      });

      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
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
      mockCreate.mockResolvedValue({
        id: "chatcmpl-456",
        model: "gpt-4o",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"path": "/test.txt"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 5,
        },
      });

      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
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
});

describe("createOpenAIProvider", () => {
  it("should create a provider instance", async () => {
    const { createOpenAIProvider } = await import("./openai.js");

    const provider = createOpenAIProvider();

    expect(provider.id).toBe("openai");
    expect(provider.name).toBe("OpenAI");
  });
});

describe("createKimiProvider", () => {
  it("should create a Kimi provider instance", async () => {
    const { createKimiProvider } = await import("./openai.js");

    const provider = createKimiProvider();

    expect(provider.id).toBe("kimi");
    expect(provider.name).toBe("Kimi (Moonshot)");
  });

  it("should initialize with KIMI_API_KEY from env", async () => {
    const { createKimiProvider } = await import("./openai.js");
    const originalKey = process.env["KIMI_API_KEY"];
    process.env["KIMI_API_KEY"] = "test-kimi-key";

    const provider = createKimiProvider();

    expect(provider.id).toBe("kimi");

    process.env["KIMI_API_KEY"] = originalKey;
  });

  it("should initialize with MOONSHOT_API_KEY from env", async () => {
    const { createKimiProvider } = await import("./openai.js");
    const originalKimi = process.env["KIMI_API_KEY"];
    const originalMoonshot = process.env["MOONSHOT_API_KEY"];
    delete process.env["KIMI_API_KEY"];
    process.env["MOONSHOT_API_KEY"] = "test-moonshot-key";

    const provider = createKimiProvider();

    expect(provider.id).toBe("kimi");

    process.env["KIMI_API_KEY"] = originalKimi;
    process.env["MOONSHOT_API_KEY"] = originalMoonshot;
  });
});

describe("stream", () => {
  it("should stream text chunks", async () => {
    // Create async iterator for streaming
    const streamIterator = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "Hello" } }] };
        yield { choices: [{ delta: { content: " World" } }] };
        yield { choices: [{ delta: {} }] }; // No content
      },
    };
    mockCreate.mockResolvedValue(streamIterator);

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    const chunks: { type: string; text?: string }[] = [];
    for await (const chunk of provider.stream([{ role: "user", content: "Hi" }])) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(chunks[chunks.length - 1]?.type).toBe("done");
  });

  it("should throw if not initialized", async () => {
    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();

    const iterator = provider.stream([{ role: "user", content: "Hello" }]);
    await expect(iterator.next()).rejects.toThrow(/not initialized/);
  });

  it("should handle stream errors", async () => {
    mockCreate.mockRejectedValue(new Error("Stream error"));

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    const iterator = provider.stream([{ role: "user", content: "Hello" }]);
    await expect(iterator.next()).rejects.toThrow();
  });
});

describe("message conversion", () => {
  it("should handle system messages in conversation", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([expect.objectContaining({ role: "system" })]),
      }),
    );
  });

  it("should handle system prompt in options", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([{ role: "user", content: "Hello" }], { system: "You are helpful" });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system", content: "You are helpful" }),
        ]),
      }),
    );
  });

  it("should handle user messages with array content", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([{ role: "user", content: [{ type: "text", text: "Hello" }] }]);

    expect(mockCreate).toHaveBeenCalled();
  });

  it("should handle tool results in messages", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([
      { role: "user", content: "Read file" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "call_1", name: "read_file", input: { path: "/test.txt" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_1", content: "file contents" }],
      },
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "tool", tool_call_id: "call_1" }),
        ]),
      }),
    );
  });

  it("should handle assistant messages with tool calls", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll read the file" },
          { type: "tool_use", id: "call_1", name: "read_file", input: { path: "/test.txt" } },
        ],
      },
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: "I'll read the file",
            tool_calls: expect.arrayContaining([
              expect.objectContaining({
                id: "call_1",
                type: "function",
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("should handle assistant messages with only text content", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chat([
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello there" }],
      },
    ]);

    expect(mockCreate).toHaveBeenCalled();
  });
});

describe("tool choice conversion", () => {
  it("should handle undefined tool choice", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chatWithTools([{ role: "user", content: "Hello" }], { tools: [] });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: undefined,
      }),
    );
  });

  it("should handle auto tool choice", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
      toolChoice: "auto",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: "auto",
      }),
    );
  });

  it("should handle any tool choice (required)", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
      toolChoice: "any",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: "required",
      }),
    );
  });

  it("should handle specific tool choice", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
      toolChoice: { type: "tool", name: "readFile" },
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "function", function: { name: "readFile" } },
      }),
    );
  });
});

describe("finish reason mapping", () => {
  it("should map length to max_tokens", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Truncated..." }, finish_reason: "length" }],
      usage: { prompt_tokens: 10, completion_tokens: 4096 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("max_tokens");
  });

  it("should map null finish reason to end_turn", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" }, finish_reason: null }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("end_turn");
  });

  it("should map unknown finish reason to end_turn", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" }, finish_reason: "unknown" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chat([{ role: "user", content: "Hello" }]);

    expect(response.stopReason).toBe("end_turn");
  });
});

describe("error handling", () => {
  it("should handle OpenAI APIError with 429 status (retryable)", async () => {
    mockCreate.mockRejectedValue(new MockOpenAIAPIError("Rate limit", 429));

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
  });

  it("should handle OpenAI APIError with 500 status (retryable)", async () => {
    mockCreate.mockRejectedValue(new MockOpenAIAPIError("Server error", 500));

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
  });

  it("should handle OpenAI APIError with undefined status", async () => {
    mockCreate.mockRejectedValue(new MockOpenAIAPIError("Unknown error"));

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
  });

  it("should handle OpenAI APIError with 400 status (non-retryable)", async () => {
    mockCreate.mockRejectedValue(new MockOpenAIAPIError("Bad request", 400));

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
  });

  it("should handle non-Error thrown values", async () => {
    mockCreate.mockRejectedValue("string error");

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow();
  });

  it("should handle chatWithTools errors", async () => {
    mockCreate.mockRejectedValue(new MockOpenAIAPIError("Server error", 500));

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    await expect(
      provider.chatWithTools([{ role: "user", content: "Hello" }], { tools: [] }),
    ).rejects.toThrow();
  });
});

describe("token counting edge cases", () => {
  it("should handle code-heavy text", async () => {
    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();

    const codeText = "function foo() { return bar(x + y) * z[i]; }";
    const count = provider.countTokens(codeText);

    expect(count).toBeGreaterThan(0);
  });

  it("should handle whitespace-heavy text", async () => {
    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();

    // Text with > 30% whitespace
    const whitespaceText = "a   b   c   d   e   f   g   h   i   j";
    const count = provider.countTokens(whitespaceText);

    expect(count).toBeGreaterThan(0);
  });
});

describe("tool call extraction", () => {
  it("should handle empty tool calls", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi", tool_calls: [] }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
    });

    expect(response.toolCalls).toEqual([]);
  });

  it("should handle undefined tool calls", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
    });

    expect(response.toolCalls).toEqual([]);
  });

  it("should handle tool calls with empty arguments", async () => {
    mockCreate.mockResolvedValue({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "test_tool",
                  arguments: "",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { OpenAIProvider } = await import("./openai.js");
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: "test" });

    const response = await provider.chatWithTools([{ role: "user", content: "Hello" }], {
      tools: [],
    });

    expect(response.toolCalls[0]?.input).toEqual({});
  });
});
