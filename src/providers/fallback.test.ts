/**
 * Tests for Provider Fallback with circuit breaker protection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LLMProvider,
  Message,
  ChatOptions,
  ChatResponse,
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  StreamChunk,
} from "./types.js";
import { ProviderFallback, createProviderFallback } from "./fallback.js";
import { ProviderError } from "../utils/errors.js";

/**
 * Helper: create a mock LLM provider with configurable behavior
 */
function createMockProvider(id: string, overrides?: Partial<LLMProvider>): LLMProvider {
  return {
    id,
    name: `Mock ${id}`,
    initialize: vi.fn().mockResolvedValue(undefined),
    chat: vi.fn().mockResolvedValue({
      id: `resp-${id}`,
      content: `Response from ${id}`,
      stopReason: "end_turn",
      model: "test-model",
      usage: { inputTokens: 10, outputTokens: 5 },
    } satisfies ChatResponse),
    chatWithTools: vi.fn().mockResolvedValue({
      id: `resp-${id}`,
      content: `Response from ${id}`,
      stopReason: "end_turn",
      model: "test-model",
      usage: { inputTokens: 10, outputTokens: 5 },
      toolCalls: [],
    } satisfies ChatWithToolsResponse),
    stream: vi.fn().mockImplementation(async function* () {
      yield { type: "text" as const, text: `Stream from ${id}` };
      yield { type: "done" as const };
    }),
    streamWithTools: vi.fn().mockImplementation(async function* () {
      yield { type: "text" as const, text: `Stream with tools from ${id}` };
      yield { type: "done" as const };
    }),
    countTokens: vi.fn().mockReturnValue(10),
    getContextWindow: vi.fn().mockReturnValue(128000),
    isAvailable: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const sampleMessages: Message[] = [{ role: "user", content: "Hello" }];

const sampleToolOptions: ChatWithToolsOptions = {
  tools: [
    {
      name: "read_file",
      description: "Read a file",
      input_schema: { type: "object", properties: { path: { type: "string" } } },
    },
  ],
};

describe("ProviderFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create with a single provider", () => {
      const provider = createMockProvider("primary");
      const fallback = new ProviderFallback([provider]);

      expect(fallback.id).toBe("fallback");
      expect(fallback.name).toBe("Provider Fallback");
    });

    it("should create with multiple providers", () => {
      const primary = createMockProvider("primary");
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary]);

      expect(fallback.id).toBe("fallback");
    });

    it("should throw if no providers given", () => {
      expect(() => new ProviderFallback([])).toThrow(/At least one provider/);
    });

    it("should accept optional circuit breaker config", () => {
      const provider = createMockProvider("primary");
      const fallback = new ProviderFallback([provider], {
        circuitBreaker: { failureThreshold: 3, resetTimeout: 10000 },
      });

      expect(fallback.id).toBe("fallback");
    });
  });

  describe("initialize", () => {
    it("should initialize all providers", async () => {
      const primary = createMockProvider("primary");
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary]);

      await fallback.initialize({ apiKey: "test" });

      expect(primary.initialize).toHaveBeenCalledWith({ apiKey: "test" });
      expect(secondary.initialize).toHaveBeenCalledWith({ apiKey: "test" });
    });

    it("should succeed if at least one provider initializes", async () => {
      const primary = createMockProvider("primary", {
        initialize: vi.fn().mockRejectedValue(new Error("Primary init failed")),
      });
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary]);

      // Should not throw
      await fallback.initialize({ apiKey: "test" });
    });

    it("should throw if all providers fail to initialize", async () => {
      const primary = createMockProvider("primary", {
        initialize: vi.fn().mockRejectedValue(new Error("Primary failed")),
      });
      const secondary = createMockProvider("secondary", {
        initialize: vi.fn().mockRejectedValue(new Error("Secondary failed")),
      });
      const fallback = new ProviderFallback([primary, secondary]);

      await expect(fallback.initialize({ apiKey: "test" })).rejects.toThrow(
        /All providers failed to initialize/,
      );
    });
  });

  describe("chat", () => {
    it("should use the primary provider when available", async () => {
      const primary = createMockProvider("primary");
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary]);

      const response = await fallback.chat(sampleMessages);

      expect(response.content).toBe("Response from primary");
      expect(primary.chat).toHaveBeenCalledWith(sampleMessages, undefined);
      expect(secondary.chat).not.toHaveBeenCalled();
    });

    it("should fallback to secondary when primary fails", async () => {
      const primary = createMockProvider("primary", {
        chat: vi.fn().mockRejectedValue(new Error("Primary down")),
      });
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary]);

      const response = await fallback.chat(sampleMessages);

      expect(response.content).toBe("Response from secondary");
    });

    it("should pass options through to provider", async () => {
      const primary = createMockProvider("primary");
      const fallback = new ProviderFallback([primary]);

      const options: ChatOptions = { model: "gpt-5", temperature: 0.5 };
      await fallback.chat(sampleMessages, options);

      expect(primary.chat).toHaveBeenCalledWith(sampleMessages, options);
    });

    it("should throw when all providers fail", async () => {
      const primary = createMockProvider("primary", {
        chat: vi.fn().mockRejectedValue(new Error("Primary down")),
      });
      const secondary = createMockProvider("secondary", {
        chat: vi.fn().mockRejectedValue(new Error("Secondary down")),
      });
      const fallback = new ProviderFallback([primary, secondary]);

      await expect(fallback.chat(sampleMessages)).rejects.toThrow(/All providers failed/);
    });

    it("should include provider names in the all-failed error message", async () => {
      const primary = createMockProvider("primary", {
        chat: vi.fn().mockRejectedValue(new Error("Primary timeout")),
      });
      const secondary = createMockProvider("secondary", {
        chat: vi.fn().mockRejectedValue(new Error("Secondary rate limited")),
      });
      const fallback = new ProviderFallback([primary, secondary]);

      await expect(fallback.chat(sampleMessages)).rejects.toThrow(/primary.*Primary timeout/);
    });

    it("should handle three providers in chain", async () => {
      const first = createMockProvider("first", {
        chat: vi.fn().mockRejectedValue(new Error("First down")),
      });
      const second = createMockProvider("second", {
        chat: vi.fn().mockRejectedValue(new Error("Second down")),
      });
      const third = createMockProvider("third");
      const fallback = new ProviderFallback([first, second, third]);

      const response = await fallback.chat(sampleMessages);

      expect(response.content).toBe("Response from third");
    });
  });

  describe("chatWithTools", () => {
    it("should use the primary provider for tool calls", async () => {
      const toolResponse: ChatWithToolsResponse = {
        id: "resp-tool",
        content: "",
        stopReason: "tool_use",
        model: "test",
        usage: { inputTokens: 20, outputTokens: 10 },
        toolCalls: [{ id: "call_1", name: "read_file", input: { path: "/test.txt" } }],
      };
      const primary = createMockProvider("primary", {
        chatWithTools: vi.fn().mockResolvedValue(toolResponse),
      });
      const fallback = new ProviderFallback([primary]);

      const response = await fallback.chatWithTools(sampleMessages, sampleToolOptions);

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0]?.name).toBe("read_file");
    });

    it("should fallback when primary fails with tools", async () => {
      const primary = createMockProvider("primary", {
        chatWithTools: vi.fn().mockRejectedValue(new Error("Tool failure")),
      });
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary]);

      const response = await fallback.chatWithTools(sampleMessages, sampleToolOptions);

      expect(response.content).toBe("Response from secondary");
    });

    it("should throw when all providers fail with tools", async () => {
      const primary = createMockProvider("primary", {
        chatWithTools: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const secondary = createMockProvider("secondary", {
        chatWithTools: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const fallback = new ProviderFallback([primary, secondary]);

      await expect(fallback.chatWithTools(sampleMessages, sampleToolOptions)).rejects.toThrow(
        /All providers failed/,
      );
    });
  });

  describe("stream", () => {
    it("should stream from primary provider", async () => {
      const primary = createMockProvider("primary");
      const fallback = new ProviderFallback([primary]);

      const chunks: StreamChunk[] = [];
      for await (const chunk of fallback.stream(sampleMessages)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.type).toBe("text");
      expect(chunks[0]?.text).toBe("Stream from primary");
      expect(chunks[1]?.type).toBe("done");
    });

    it("should fallback to secondary when primary stream fails", async () => {
      const primary = createMockProvider("primary", {
        stream: // eslint-disable-next-line require-yield
          vi.fn().mockImplementation(async function* () {
            throw new Error("Stream failure");
          }),
      });
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary]);

      const chunks: StreamChunk[] = [];
      for await (const chunk of fallback.stream(sampleMessages)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.text).toBe("Stream from secondary");
    });

    it("should throw when all providers fail streaming", async () => {
      const primary = createMockProvider("primary", {
        stream: // eslint-disable-next-line require-yield
          vi.fn().mockImplementation(async function* () {
            throw new Error("fail");
          }),
      });
      const secondary = createMockProvider("secondary", {
        stream: // eslint-disable-next-line require-yield
          vi.fn().mockImplementation(async function* () {
            throw new Error("fail");
          }),
      });
      const fallback = new ProviderFallback([primary, secondary]);

      await expect(
        (async () => {
          for await (const _chunk of fallback.stream(sampleMessages)) {
            // consume
          }
        })(),
      ).rejects.toThrow(/All providers failed for streaming/);
    });

    it("should pass options to stream", async () => {
      const primary = createMockProvider("primary");
      const fallback = new ProviderFallback([primary]);

      const options: ChatOptions = { temperature: 0.7 };
      for await (const _chunk of fallback.stream(sampleMessages, options)) {
        // consume
      }

      expect(primary.stream).toHaveBeenCalledWith(sampleMessages, options);
    });
  });

  describe("streamWithTools", () => {
    it("should stream with tools from primary provider", async () => {
      const primary = createMockProvider("primary");
      const fallback = new ProviderFallback([primary]);

      const chunks: StreamChunk[] = [];
      for await (const chunk of fallback.streamWithTools(sampleMessages, sampleToolOptions)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.text).toBe("Stream with tools from primary");
    });

    it("should fallback when primary streamWithTools fails", async () => {
      const primary = createMockProvider("primary", {
        streamWithTools: // eslint-disable-next-line require-yield
          vi.fn().mockImplementation(async function* () {
            throw new Error("fail");
          }),
      });
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary]);

      const chunks: StreamChunk[] = [];
      for await (const chunk of fallback.streamWithTools(sampleMessages, sampleToolOptions)) {
        chunks.push(chunk);
      }

      expect(chunks[0]?.text).toBe("Stream with tools from secondary");
    });

    it("should throw when all providers fail streamWithTools", async () => {
      const primary = createMockProvider("primary", {
        streamWithTools: // eslint-disable-next-line require-yield
          vi.fn().mockImplementation(async function* () {
            throw new Error("fail");
          }),
      });
      const secondary = createMockProvider("secondary", {
        streamWithTools: // eslint-disable-next-line require-yield
          vi.fn().mockImplementation(async function* () {
            throw new Error("fail");
          }),
      });
      const fallback = new ProviderFallback([primary, secondary]);

      await expect(
        (async () => {
          for await (const _chunk of fallback.streamWithTools(sampleMessages, sampleToolOptions)) {
            // consume
          }
        })(),
      ).rejects.toThrow(/All providers failed for streaming with tools/);
    });
  });

  describe("countTokens", () => {
    it("should delegate to current provider", () => {
      const primary = createMockProvider("primary", {
        countTokens: vi.fn().mockReturnValue(42),
      });
      const fallback = new ProviderFallback([primary]);

      expect(fallback.countTokens("test text")).toBe(42);
      expect(primary.countTokens).toHaveBeenCalledWith("test text");
    });
  });

  describe("getContextWindow", () => {
    it("should delegate to current provider", () => {
      const primary = createMockProvider("primary", {
        getContextWindow: vi.fn().mockReturnValue(200000),
      });
      const fallback = new ProviderFallback([primary]);

      expect(fallback.getContextWindow()).toBe(200000);
    });
  });

  describe("isAvailable", () => {
    it("should return true if any provider is available", async () => {
      const primary = createMockProvider("primary", {
        isAvailable: vi.fn().mockResolvedValue(false),
      });
      const secondary = createMockProvider("secondary", {
        isAvailable: vi.fn().mockResolvedValue(true),
      });
      const fallback = new ProviderFallback([primary, secondary]);

      expect(await fallback.isAvailable()).toBe(true);
    });

    it("should return false if all providers are unavailable", async () => {
      const primary = createMockProvider("primary", {
        isAvailable: vi.fn().mockResolvedValue(false),
      });
      const secondary = createMockProvider("secondary", {
        isAvailable: vi.fn().mockResolvedValue(false),
      });
      const fallback = new ProviderFallback([primary, secondary]);

      expect(await fallback.isAvailable()).toBe(false);
    });

    it("should return false for provider with open circuit breaker", async () => {
      // Need to trip the circuit breaker by causing enough failures
      const primary = createMockProvider("primary", {
        chat: vi.fn().mockRejectedValue(new Error("fail")),
        isAvailable: vi.fn().mockResolvedValue(true),
      });
      const fallback = new ProviderFallback([primary], {
        circuitBreaker: { failureThreshold: 2, resetTimeout: 60000, halfOpenRequests: 1 },
      });

      // Cause failures to open the circuit breaker
      try {
        await fallback.chat(sampleMessages);
      } catch {
        /* expected */
      }
      try {
        await fallback.chat(sampleMessages);
      } catch {
        /* expected */
      }

      // Circuit should now be open (2 failures >= threshold 2)
      // isAvailable should return false because circuit is open
      expect(await fallback.isAvailable()).toBe(false);
    });
  });

  describe("circuit breaker integration", () => {
    it("should open circuit after threshold failures", async () => {
      const primary = createMockProvider("primary", {
        chat: vi.fn().mockRejectedValue(new Error("Server error")),
      });
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary], {
        circuitBreaker: { failureThreshold: 2, resetTimeout: 60000, halfOpenRequests: 1 },
      });

      // First two calls fail on primary, fall back to secondary
      await fallback.chat(sampleMessages);
      await fallback.chat(sampleMessages);

      // After threshold, primary circuit is open
      const status = fallback.getCircuitStatus();
      const primaryStatus = status.find((s) => s.providerId === "primary");
      expect(primaryStatus?.failureCount).toBeGreaterThanOrEqual(2);
    });

    it("should skip provider with open circuit", async () => {
      const primary = createMockProvider("primary", {
        chat: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary], {
        circuitBreaker: { failureThreshold: 2, resetTimeout: 60000, halfOpenRequests: 1 },
      });

      // Trip the breaker on primary
      await fallback.chat(sampleMessages); // fails primary, succeeds secondary
      await fallback.chat(sampleMessages); // fails primary, succeeds secondary

      // Now the circuit is open for primary
      // Third call should go directly to secondary (primary circuit open)
      vi.mocked(secondary.chat).mockClear();
      await fallback.chat(sampleMessages);

      // Secondary was called
      expect(secondary.chat).toHaveBeenCalled();
    });

    it("should report circuit status for all providers", () => {
      const primary = createMockProvider("primary");
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary]);

      const status = fallback.getCircuitStatus();

      expect(status).toHaveLength(2);
      expect(status[0]?.providerId).toBe("primary");
      expect(status[0]?.state).toBe("closed");
      expect(status[0]?.failureCount).toBe(0);
      expect(status[1]?.providerId).toBe("secondary");
    });

    it("should reset all circuit breakers", async () => {
      const primary = createMockProvider("primary", {
        chat: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary], {
        circuitBreaker: { failureThreshold: 2, resetTimeout: 60000, halfOpenRequests: 1 },
      });

      // Trip the primary circuit
      await fallback.chat(sampleMessages);
      await fallback.chat(sampleMessages);

      // Reset circuits
      fallback.resetCircuits();

      const status = fallback.getCircuitStatus();
      const primaryStatus = status.find((s) => s.providerId === "primary");
      expect(primaryStatus?.state).toBe("closed");
      expect(primaryStatus?.failureCount).toBe(0);
    });
  });

  describe("getCurrentProvider", () => {
    it("should return the first provider", () => {
      const primary = createMockProvider("primary");
      const secondary = createMockProvider("secondary");
      const fallback = new ProviderFallback([primary, secondary]);

      const current = fallback.getCurrentProvider();

      expect(current.provider.id).toBe("primary");
    });
  });

  describe("error propagation", () => {
    it("should throw ProviderError with retryable=false when all fail", async () => {
      const primary = createMockProvider("primary", {
        chat: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const fallback = new ProviderFallback([primary], {
        circuitBreaker: { failureThreshold: 100, resetTimeout: 60000, halfOpenRequests: 1 },
      });

      try {
        await fallback.chat(sampleMessages);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).provider).toBe("fallback");
      }
    });

    it("should include all provider errors in the message", async () => {
      const primary = createMockProvider("primary", {
        chat: vi.fn().mockRejectedValue(new Error("Auth failed")),
      });
      const secondary = createMockProvider("secondary", {
        chat: vi.fn().mockRejectedValue(new Error("Rate limited")),
      });
      const fallback = new ProviderFallback([primary, secondary], {
        circuitBreaker: { failureThreshold: 100, resetTimeout: 60000, halfOpenRequests: 1 },
      });

      try {
        await fallback.chat(sampleMessages);
        expect.fail("Should have thrown");
      } catch (error) {
        const msg = (error as Error).message;
        expect(msg).toContain("primary");
        expect(msg).toContain("Auth failed");
        expect(msg).toContain("secondary");
        expect(msg).toContain("Rate limited");
      }
    });

    it("should handle non-Error thrown values in error messages", async () => {
      const primary = createMockProvider("primary", {
        chat: vi.fn().mockRejectedValue("string error"),
      });
      const fallback = new ProviderFallback([primary], {
        circuitBreaker: { failureThreshold: 100, resetTimeout: 60000, halfOpenRequests: 1 },
      });

      try {
        await fallback.chat(sampleMessages);
        expect.fail("Should have thrown");
      } catch (error) {
        const msg = (error as Error).message;
        expect(msg).toContain("string error");
      }
    });
  });
});

describe("createProviderFallback", () => {
  it("should create a ProviderFallback instance", () => {
    const primary = createMockProvider("primary");
    const fallback = createProviderFallback([primary]);

    expect(fallback).toBeInstanceOf(ProviderFallback);
    expect(fallback.id).toBe("fallback");
  });

  it("should pass config to the ProviderFallback", () => {
    const primary = createMockProvider("primary");
    const fallback = createProviderFallback([primary], {
      circuitBreaker: { failureThreshold: 10 },
    });

    expect(fallback).toBeInstanceOf(ProviderFallback);
  });

  it("should throw for empty provider array", () => {
    expect(() => createProviderFallback([])).toThrow(/At least one provider/);
  });
});
