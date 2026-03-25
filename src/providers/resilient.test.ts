import { describe, it, expect } from "vitest";
import type {
  LLMProvider,
  Message,
  ChatOptions,
  ChatResponse,
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  StreamChunk,
  ProviderConfig,
} from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { ResilientProvider } from "./resilient.js";
import { CircuitOpenError } from "./circuit-breaker.js";

class MockProvider implements LLMProvider {
  readonly id = "mock";
  readonly name = "Mock";

  constructor(
    private readonly impl: {
      chat?: (messages: Message[], options?: ChatOptions) => Promise<ChatResponse>;
      chatWithTools?: (
        messages: Message[],
        options: ChatWithToolsOptions,
      ) => Promise<ChatWithToolsResponse>;
      stream?: (messages: Message[], options?: ChatOptions) => AsyncIterable<StreamChunk>;
      streamWithTools?: (
        messages: Message[],
        options: ChatWithToolsOptions,
      ) => AsyncIterable<StreamChunk>;
    },
  ) {}

  async initialize(_config: ProviderConfig): Promise<void> {}
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    return this.impl.chat!(messages, options);
  }
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    return this.impl.chatWithTools!(messages, options);
  }
  stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    return this.impl.stream!(messages, options);
  }
  streamWithTools(messages: Message[], options: ChatWithToolsOptions): AsyncIterable<StreamChunk> {
    return this.impl.streamWithTools!(messages, options);
  }
  countTokens(text: string): number {
    return text.length;
  }
  getContextWindow(): number {
    return 100000;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

describe("ResilientProvider", () => {
  it("retries chat for retryable errors", async () => {
    let calls = 0;
    const provider = new MockProvider({
      chat: async () => {
        calls++;
        if (calls === 1) {
          throw new ProviderError("503 temporary", { provider: "mock", retryable: true });
        }
        return {
          id: "ok",
          content: "done",
          stopReason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "mock",
        };
      },
    });
    const resilient = new ResilientProvider(provider, {
      retry: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 },
    });

    const response = await resilient.chat([{ role: "user", content: "hi" }]);
    expect(response.content).toBe("done");
    expect(calls).toBe(2);
  });

  it("does not retry non-retryable errors", async () => {
    let calls = 0;
    const provider = new MockProvider({
      chat: async () => {
        calls++;
        throw new ProviderError("401 unauthorized", { provider: "mock", retryable: false });
      },
    });
    const resilient = new ResilientProvider(provider, {
      retry: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 },
    });

    await expect(resilient.chat([{ role: "user", content: "hi" }])).rejects.toThrow("401");
    expect(calls).toBe(1);
  });

  it("retries stream only if no chunk has been emitted", async () => {
    let calls = 0;
    const provider = new MockProvider({
      streamWithTools: async function* () {
        calls++;
        if (calls === 1) {
          throw new ProviderError("503 temporary", { provider: "mock", retryable: true });
        }
        yield { type: "text", text: "ok" };
        yield { type: "done" };
      },
    });
    const resilient = new ResilientProvider(provider, {
      streamRetry: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 },
    });

    const chunks: StreamChunk[] = [];
    for await (const chunk of resilient.streamWithTools([{ role: "user", content: "hi" }], {
      tools: [],
    })) {
      chunks.push(chunk);
    }

    expect(calls).toBe(2);
    expect(chunks.some((c) => c.type === "text")).toBe(true);
  });

  it("does not retry stream after partial output", async () => {
    const provider = new MockProvider({
      streamWithTools: async function* () {
        yield { type: "text", text: "partial" };
        throw new ProviderError("503 after partial", { provider: "mock", retryable: true });
      },
    });
    const resilient = new ResilientProvider(provider, {
      streamRetry: { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 },
    });

    const iterator = resilient.streamWithTools([{ role: "user", content: "hi" }], { tools: [] });
    await expect(
      (async () => {
        for await (const _chunk of iterator) {
          // consume
        }
      })(),
    ).rejects.toThrow("503 after partial");
  });

  it("opens circuit after repeated failures", async () => {
    const provider = new MockProvider({
      chat: async () => {
        throw new ProviderError("500", { provider: "mock", retryable: true });
      },
    });
    const resilient = new ResilientProvider(provider, {
      retry: { maxRetries: 0 },
      circuitBreaker: { failureThreshold: 1, resetTimeout: 60000 },
    });

    await expect(resilient.chat([{ role: "user", content: "hi" }])).rejects.toThrow("500");
    await expect(resilient.chat([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
  });

  it("returns false from isAvailable when circuit is open", async () => {
    const provider = new MockProvider({
      chat: async () => {
        throw new ProviderError("500", { provider: "mock", retryable: true });
      },
    });
    const resilient = new ResilientProvider(provider, {
      retry: { maxRetries: 0 },
      circuitBreaker: { failureThreshold: 1, resetTimeout: 60000 },
    });

    await expect(resilient.chat([{ role: "user", content: "hi" }])).rejects.toThrow();
    await expect(resilient.isAvailable()).resolves.toBe(false);
  });
});
