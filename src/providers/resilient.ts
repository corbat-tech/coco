import type {
  LLMProvider,
  ProviderConfig,
  Message,
  ChatOptions,
  ChatResponse,
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  StreamChunk,
} from "./types.js";
import { withRetry, type RetryConfig, DEFAULT_RETRY_CONFIG, isRetryableError } from "./retry.js";
import {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitBreakerConfig,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from "./circuit-breaker.js";

export interface ResilientProviderConfig {
  retry?: Partial<RetryConfig>;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  streamRetry?: Partial<RetryConfig>;
}

const DEFAULT_STREAM_RETRY: RetryConfig = {
  maxRetries: 1,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelay(attempt: number, config: RetryConfig): number {
  const exp = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const capped = Math.min(exp, config.maxDelayMs);
  const jitter = capped * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.min(capped + jitter, config.maxDelayMs));
}

export class ResilientProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;

  private readonly provider: LLMProvider;
  private readonly breaker: CircuitBreaker;
  private readonly retryConfig: RetryConfig;
  private readonly streamRetryConfig: RetryConfig;

  constructor(provider: LLMProvider, config: ResilientProviderConfig = {}) {
    this.provider = provider;
    this.id = provider.id;
    this.name = provider.name;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
    this.streamRetryConfig = { ...DEFAULT_STREAM_RETRY, ...config.streamRetry };
    this.breaker = new CircuitBreaker(
      { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config.circuitBreaker },
      provider.id,
    );
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await this.provider.initialize(config);
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    return this.breaker.execute(() =>
      withRetry(() => this.provider.chat(messages, options), this.retryConfig),
    );
  }

  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    return this.breaker.execute(() =>
      withRetry(() => this.provider.chatWithTools(messages, options), this.retryConfig),
    );
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    yield* this.streamWithPolicy(() => this.provider.stream(messages, options));
  }

  async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    yield* this.streamWithPolicy(() => this.provider.streamWithTools(messages, options));
  }

  countTokens(text: string): number {
    return this.provider.countTokens(text);
  }

  getContextWindow(): number {
    return this.provider.getContextWindow();
  }

  async isAvailable(): Promise<boolean> {
    try {
      return await this.breaker.execute(() => this.provider.isAvailable());
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return false;
      }
      return false;
    }
  }

  getCircuitState(): "closed" | "open" | "half-open" {
    return this.breaker.getState();
  }

  resetCircuit(): void {
    this.breaker.reset();
  }

  private async *streamWithPolicy(
    createStream: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    let attempt = 0;

    while (attempt <= this.streamRetryConfig.maxRetries) {
      if (this.breaker.isOpen()) {
        throw new CircuitOpenError(this.id, 0);
      }

      let emittedChunk = false;
      try {
        for await (const chunk of createStream()) {
          emittedChunk = true;
          yield chunk;
        }
        this.breaker.recordSuccess();
        return;
      } catch (error) {
        this.breaker.recordFailure();
        const shouldRetry =
          !emittedChunk && attempt < this.streamRetryConfig.maxRetries && isRetryableError(error);

        if (!shouldRetry) {
          throw error;
        }

        const delay = computeRetryDelay(attempt, this.streamRetryConfig);
        await sleep(delay);
        attempt++;
      }
    }
  }
}

export function getDefaultResilienceConfig(providerId: string): ResilientProviderConfig {
  if (providerId === "ollama" || providerId === "lmstudio") {
    return {
      retry: {
        maxRetries: 1,
        initialDelayMs: 300,
        maxDelayMs: 1500,
      },
      streamRetry: {
        maxRetries: 0,
      },
      circuitBreaker: {
        failureThreshold: 3,
        resetTimeout: 10000,
      },
    };
  }

  return {
    retry: {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
    },
    streamRetry: {
      maxRetries: 1,
      initialDelayMs: 500,
      maxDelayMs: 5000,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 30000,
    },
  };
}

export function createResilientProvider(
  provider: LLMProvider,
  config?: ResilientProviderConfig,
): ResilientProvider {
  return new ResilientProvider(provider, config ?? getDefaultResilienceConfig(provider.id));
}
