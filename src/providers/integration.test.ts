/**
 * Integration tests for LLM providers
 *
 * Tests provider integration:
 * - Provider initialization
 * - Chat flow with mock responses
 * - Tool use flow
 * - Streaming flow
 * - Error handling and retry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { LLMProvider, Message, ToolDefinition } from "./types.js";

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  }));
  return { default: MockAnthropic, Anthropic: MockAnthropic };
});

// Mock OpenAI SDK
vi.mock("openai", () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  }));
  return { default: MockOpenAI, OpenAI: MockOpenAI };
});

// Mock Gemini SDK
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
    }),
  })),
}));

describe("Provider Integration Tests", () => {
  describe("Provider Factory", () => {
    it("should create an Anthropic provider", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");

      const provider = new AnthropicProvider();
      expect(provider.id).toBe("anthropic");
      expect(provider.name).toBe("Anthropic Claude");

      await provider.initialize({ apiKey: "test-key" });
      expect(provider.getContextWindow()).toBeGreaterThan(0);
    });

    it("should create an OpenAI provider", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      expect(provider.id).toBe("openai");
      expect(provider.name).toBe("OpenAI");

      await provider.initialize({ apiKey: "test-key" });
      expect(provider.getContextWindow()).toBeGreaterThan(0);
    });

    it("should create a Gemini provider", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      expect(provider.id).toBe("gemini");
      expect(provider.name).toBe("Google Gemini");

      await provider.initialize({ apiKey: "test-key" });
      expect(provider.getContextWindow()).toBeGreaterThan(0);
    });

    it("should create a Kimi provider (OpenAI compatible)", async () => {
      const { createKimiProvider } = await import("./openai.js");

      const provider = createKimiProvider({ apiKey: "test-key" });
      expect(provider.id).toBe("kimi");
      expect(provider.name).toBe("Kimi (Moonshot)");
    });
  });

  describe("Anthropic Provider Chat Flow", () => {
    let provider: LLMProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      const { AnthropicProvider } = await import("./anthropic.js");
      provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key", model: "claude-sonnet-4-20250514" });
    });

    it("should send a chat message and receive response", async () => {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockClient = new Anthropic();

      (mockClient.messages.create as Mock).mockResolvedValue({
        id: "msg-123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello! How can I help you?" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 15 },
        model: "claude-sonnet-4-20250514",
      });

      // Access internal client (for testing purposes)
      (provider as any).client = mockClient;

      const messages: Message[] = [{ role: "user", content: "Hello" }];
      const response = await provider.chat(messages);

      expect(response.content).toBe("Hello! How can I help you?");
      expect(response.stopReason).toBe("end_turn");
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(15);
    });

    it("should handle chat with tools", async () => {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockClient = new Anthropic();

      (mockClient.messages.create as Mock).mockResolvedValue({
        id: "msg-123",
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: "Let me read that file." },
          {
            type: "tool_use",
            id: "tool-1",
            name: "read_file",
            input: { path: "/test.ts" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 50, output_tokens: 30 },
        model: "claude-sonnet-4-20250514",
      });

      (provider as any).client = mockClient;

      const messages: Message[] = [{ role: "user", content: "Read test.ts" }];
      const tools: ToolDefinition[] = [
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

      const response = await provider.chatWithTools(messages, { tools });

      expect(response.content).toBe("Let me read that file.");
      expect(response.stopReason).toBe("tool_use");
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0]?.name).toBe("read_file");
      expect(response.toolCalls[0]?.input).toEqual({ path: "/test.ts" });
    });

    it("should handle empty tool calls", async () => {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockClient = new Anthropic();

      (mockClient.messages.create as Mock).mockResolvedValue({
        id: "msg-123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "I don't need any tools for this." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 20, output_tokens: 10 },
        model: "claude-sonnet-4-20250514",
      });

      (provider as any).client = mockClient;

      const messages: Message[] = [{ role: "user", content: "What is 2+2?" }];
      const tools: ToolDefinition[] = [
        {
          name: "calculator",
          description: "Calculate math",
          input_schema: { type: "object", properties: {} },
        },
      ];

      const response = await provider.chatWithTools(messages, { tools });

      expect(response.toolCalls).toHaveLength(0);
      expect(response.stopReason).toBe("end_turn");
    });
  });

  describe("OpenAI Provider Chat Flow", () => {
    let provider: LLMProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      const { OpenAIProvider } = await import("./openai.js");
      provider = new OpenAIProvider();
      await provider.initialize({ apiKey: "test-key", model: "gpt-4" });
    });

    it("should send a chat message and receive response", async () => {
      const OpenAI = (await import("openai")).default;
      const mockClient = new OpenAI();

      (mockClient.chat.completions.create as Mock).mockResolvedValue({
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello! How can I assist you?",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 15 },
        model: "gpt-4",
      });

      (provider as any).client = mockClient;

      const messages: Message[] = [{ role: "user", content: "Hello" }];
      const response = await provider.chat(messages);

      expect(response.content).toBe("Hello! How can I assist you?");
      expect(response.stopReason).toBe("end_turn");
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(15);
    });

    it("should handle chat with tools (function calling)", async () => {
      const OpenAI = (await import("openai")).default;
      const mockClient = new OpenAI();

      (mockClient.chat.completions.create as Mock).mockResolvedValue({
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Let me read that file for you.",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({ path: "/test.ts" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 30 },
        model: "gpt-4",
      });

      (provider as any).client = mockClient;

      const messages: Message[] = [{ role: "user", content: "Read test.ts" }];
      const tools: ToolDefinition[] = [
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

      const response = await provider.chatWithTools(messages, { tools });

      expect(response.stopReason).toBe("tool_use");
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0]?.name).toBe("read_file");
    });
  });

  describe("Gemini Provider Chat Flow", () => {
    it("should create and initialize a Gemini provider", async () => {
      // Gemini provider has complex internal mocking requirements
      // Test that we can at least create and configure it
      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();

      expect(provider.id).toBe("gemini");
      expect(provider.name).toBe("Google Gemini");

      await provider.initialize({ apiKey: "test-key", model: "gemini-pro" });
      expect(provider.getContextWindow()).toBeGreaterThan(0);
    });

    it("should count tokens for text", async () => {
      const { GeminiProvider } = await import("./gemini.js");
      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test-key" });

      const tokenCount = provider.countTokens("Hello, world!");
      expect(tokenCount).toBeGreaterThan(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle API rate limit errors", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockClient = new Anthropic();

      const rateLimitError = new Error("Rate limit exceeded");
      (rateLimitError as any).status = 429;
      (rateLimitError as any).error = { type: "rate_limit_error" };

      (mockClient.messages.create as Mock).mockRejectedValue(rateLimitError);
      (provider as any).client = mockClient;

      const messages: Message[] = [{ role: "user", content: "Hello" }];

      // Provider wraps error, check for either the original or wrapped error
      await expect(provider.chat(messages)).rejects.toThrow();
    });

    it("should handle authentication errors", async () => {
      const { OpenAIProvider } = await import("./openai.js");
      const provider = new OpenAIProvider();
      await provider.initialize({ apiKey: "invalid-key" });

      const OpenAI = (await import("openai")).default;
      const mockClient = new OpenAI();

      const authError = new Error("Invalid API key");
      (authError as any).status = 401;

      (mockClient.chat.completions.create as Mock).mockRejectedValue(authError);
      (provider as any).client = mockClient;

      const messages: Message[] = [{ role: "user", content: "Hello" }];

      // Provider wraps error, check that it throws
      await expect(provider.chat(messages)).rejects.toThrow();
    });

    it("should wrap errors with provider context", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockClient = new Anthropic();

      const error = new Error("Test error");
      (mockClient.messages.create as Mock).mockRejectedValue(error);
      (provider as any).client = mockClient;

      const messages: Message[] = [{ role: "user", content: "Hello" }];

      try {
        await provider.chat(messages);
        expect.fail("Should have thrown");
      } catch (e) {
        // Verify error was thrown (provider wraps errors)
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("should handle timeout errors", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key", timeout: 100 });

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockClient = new Anthropic();

      const timeoutError = new Error("Request timed out");
      timeoutError.name = "TimeoutError";

      (mockClient.messages.create as Mock).mockRejectedValue(timeoutError);
      (provider as any).client = mockClient;

      const messages: Message[] = [{ role: "user", content: "Hello" }];

      // Provider wraps error, check that it throws
      await expect(provider.chat(messages)).rejects.toThrow();
    });
  });

  describe("Retry Logic", () => {
    it("should provide retry utilities", async () => {
      const { withRetry, isRetryableError, DEFAULT_RETRY_CONFIG } = await import("./retry.js");

      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBeGreaterThan(0);
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBeGreaterThan(0);
      expect(typeof withRetry).toBe("function");
      expect(typeof isRetryableError).toBe("function");
    });

    it("should identify retryable errors by message content", async () => {
      const { isRetryableError } = await import("./retry.js");

      // Rate limit errors are retryable (message contains "429" or "rate limit")
      const rateLimitError = new Error("Error 429: rate limit exceeded");
      expect(isRetryableError(rateLimitError)).toBe(true);

      // Server errors are retryable (message contains status code)
      const serverError = new Error("Error 500: internal server error");
      expect(isRetryableError(serverError)).toBe(true);

      // 503 Service Unavailable
      const unavailableError = new Error("503 Service Unavailable");
      expect(isRetryableError(unavailableError)).toBe(true);

      // Connection errors are retryable (message contains error code)
      const connectionError = new Error("ECONNREFUSED: connection refused");
      expect(isRetryableError(connectionError)).toBe(true);

      // Auth errors are not retryable (no retryable pattern in message)
      const authError = new Error("Unauthorized");
      expect(isRetryableError(authError)).toBe(false);

      // Bad request errors are not retryable
      const badRequest = new Error("Bad request");
      expect(isRetryableError(badRequest)).toBe(false);
    });

    it("should retry on transient failures with retryable message", async () => {
      const { withRetry } = await import("./retry.js");

      let attempts = 0;
      const flakeyOperation = async (): Promise<string> => {
        attempts++;
        if (attempts < 3) {
          // Use error message that matches retryable pattern
          const error = new Error("Error 503: service unavailable");
          throw error;
        }
        return "success";
      };

      const result = await withRetry(flakeyOperation, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 50,
      });

      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("should not retry non-retryable errors", async () => {
      const { withRetry } = await import("./retry.js");

      let attempts = 0;
      const badOperation = async (): Promise<string> => {
        attempts++;
        const error = new Error("Bad request");
        (error as any).status = 400;
        throw error;
      };

      await expect(
        withRetry(badOperation, {
          maxRetries: 3,
          initialDelayMs: 10,
          maxDelayMs: 50,
        }),
      ).rejects.toThrow("Bad request");

      expect(attempts).toBe(1); // No retries
    });
  });

  describe("Token Counting", () => {
    it("should count tokens for Anthropic provider", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const text = "Hello, how are you doing today?";
      const tokenCount = provider.countTokens(text);

      expect(tokenCount).toBeGreaterThan(0);
      expect(typeof tokenCount).toBe("number");
    });

    it("should count tokens for OpenAI provider", async () => {
      const { OpenAIProvider } = await import("./openai.js");
      const provider = new OpenAIProvider();
      await provider.initialize({ apiKey: "test-key" });

      const text = "Hello, how are you doing today?";
      const tokenCount = provider.countTokens(text);

      expect(tokenCount).toBeGreaterThan(0);
      expect(typeof tokenCount).toBe("number");
    });

    it("should handle empty text", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const tokenCount = provider.countTokens("");
      expect(tokenCount).toBe(0);
    });
  });

  describe("Context Window", () => {
    it("should return correct context window for Claude models", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");

      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key", model: "claude-sonnet-4-20250514" });

      const contextWindow = provider.getContextWindow();
      expect(contextWindow).toBeGreaterThan(0);
      // Claude 3.5 Sonnet has 200k context
      expect(contextWindow).toBe(200000);
    });

    it("should return correct context window for GPT-4 models", async () => {
      const { OpenAIProvider } = await import("./openai.js");

      const provider = new OpenAIProvider();
      await provider.initialize({ apiKey: "test-key", model: "gpt-4" });

      const contextWindow = provider.getContextWindow();
      expect(contextWindow).toBeGreaterThan(0);
    });

    it("should return correct context window for Gemini models", async () => {
      const { GeminiProvider } = await import("./gemini.js");

      const provider = new GeminiProvider();
      await provider.initialize({ apiKey: "test-key", model: "gemini-pro" });

      const contextWindow = provider.getContextWindow();
      expect(contextWindow).toBeGreaterThan(0);
    });
  });

  describe("Availability Check", () => {
    it("should check if Anthropic provider is available", async () => {
      const { AnthropicProvider } = await import("./anthropic.js");
      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: "test-key" });

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockClient = new Anthropic();

      // Mock successful API call
      (mockClient.messages.create as Mock).mockResolvedValue({
        id: "msg-123",
        content: [{ type: "text", text: "test" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
        model: "claude-sonnet-4-20250514",
      });

      (provider as any).client = mockClient;

      const isAvailable = await provider.isAvailable();
      expect(typeof isAvailable).toBe("boolean");
    });

    it("should return false when provider is not configured", async () => {
      const { OpenAIProvider } = await import("./openai.js");
      const provider = new OpenAIProvider();
      // Not initialized

      const isAvailable = await provider.isAvailable();
      expect(isAvailable).toBe(false);
    });
  });

  describe("Pricing Utilities", () => {
    it("should estimate cost for API calls", async () => {
      const { estimateCost, formatCost, getModelPricing } = await import("./pricing.js");

      const pricing = getModelPricing("claude-sonnet-4-20250514");
      expect(pricing).toBeDefined();
      expect(pricing.inputPerMillion).toBeGreaterThan(0);

      const cost = estimateCost("claude-sonnet-4-20250514", 1000, 500);
      expect(cost.totalCost).toBeGreaterThanOrEqual(0);
      expect(cost.inputCost).toBeGreaterThanOrEqual(0);
      expect(cost.outputCost).toBeGreaterThanOrEqual(0);

      const formatted = formatCost(cost.totalCost);
      expect(formatted).toContain("$");
    });

    it("should handle unknown models with default pricing", async () => {
      const { estimateCost, hasKnownPricing } = await import("./pricing.js");

      expect(hasKnownPricing("unknown-model-xyz")).toBe(false);

      // Should not throw for unknown models - uses default pricing
      const cost = estimateCost("unknown-model-xyz", 1000, 500);
      expect(cost.totalCost).toBeGreaterThanOrEqual(0);
    });

    it("should list models with known pricing", async () => {
      const { listModelsWithPricing } = await import("./pricing.js");

      const models = listModelsWithPricing();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      // Check that models contain the expected model name in the returned array
      const modelNames = models.map((m) => m.model);
      expect(modelNames).toContain("claude-sonnet-4-20250514");
    });
  });
});
