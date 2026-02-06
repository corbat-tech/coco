/**
 * Provider fallback with circuit breaker protection
 *
 * Wraps multiple LLM providers with automatic failover when providers
 * experience issues. Each provider has its own circuit breaker.
 */

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
import { CircuitBreaker, CircuitOpenError, type CircuitBreakerConfig } from "./circuit-breaker.js";
import { ProviderError } from "../utils/errors.js";

/**
 * Provider fallback configuration
 *
 * @description Configuration options for the ProviderFallback wrapper,
 * including circuit breaker settings for failure protection.
 */
export interface ProviderFallbackConfig {
  /**
   * Circuit breaker configuration for each provider
   * @description Controls failure thresholds and reset behavior
   */
  circuitBreaker?: Partial<CircuitBreakerConfig>;
}

/**
 * Provider with its circuit breaker
 */
interface ProtectedProvider {
  provider: LLMProvider;
  breaker: CircuitBreaker;
}

/**
 * Provider fallback implementation
 *
 * Wraps multiple providers and automatically falls back to the next
 * available provider when one fails or has an open circuit.
 *
 * @example
 * ```typescript
 * const fallback = new ProviderFallback([
 *   anthropicProvider,
 *   openaiProvider,
 *   geminiProvider,
 * ]);
 *
 * // Will try anthropic first, then openai if anthropic fails
 * const response = await fallback.chat(messages);
 * ```
 */
export class ProviderFallback implements LLMProvider {
  readonly id = "fallback";
  readonly name = "Provider Fallback";

  private readonly providers: ProtectedProvider[];
  private readonly config: ProviderFallbackConfig;
  private currentProviderIndex = 0;

  /**
   * Create a provider fallback
   *
   * @param providers - Array of providers in priority order
   * @param config - Optional fallback configuration
   */
  constructor(providers: LLMProvider[], config?: ProviderFallbackConfig) {
    if (providers.length === 0) {
      throw new ProviderError("At least one provider is required for fallback", {
        provider: "fallback",
      });
    }

    this.config = config ?? {};
    this.providers = providers.map((provider) => ({
      provider,
      breaker: new CircuitBreaker(this.config.circuitBreaker, provider.id),
    }));
  }

  /**
   * Initialize all providers
   *
   * @description Attempts to initialize all providers in parallel. At least one
   * provider must initialize successfully for the fallback to be usable.
   *
   * @param config - Provider configuration to pass to each provider
   * @throws ProviderError if all providers fail to initialize
   */
  async initialize(config: ProviderConfig): Promise<void> {
    // Initialize all providers
    const results = await Promise.allSettled(
      this.providers.map((p) => p.provider.initialize(config)),
    );

    // At least one provider must initialize successfully
    const anySuccess = results.some((r) => r.status === "fulfilled");
    if (!anySuccess) {
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => r.reason)
        .join("; ");
      throw new ProviderError(`All providers failed to initialize: ${errors}`, {
        provider: "fallback",
      });
    }
  }

  /**
   * Send a chat message with fallback
   *
   * @description Sends a chat message, automatically falling back to the next
   * available provider if the current one fails or has an open circuit.
   *
   * @param messages - Conversation messages to send
   * @param options - Optional chat configuration
   * @returns Chat response from the first successful provider
   * @throws ProviderError if all providers fail
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    return this.executeWithFallback((provider) => provider.chat(messages, options));
  }

  /**
   * Send a chat message with tools and fallback
   *
   * @description Sends a chat message with tool definitions, automatically
   * falling back to the next provider on failure.
   *
   * @param messages - Conversation messages to send
   * @param options - Chat options including tool definitions
   * @returns Chat response potentially including tool calls
   * @throws ProviderError if all providers fail
   */
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    return this.executeWithFallback((provider) => provider.chatWithTools(messages, options));
  }

  /**
   * Stream a chat response with fallback
   *
   * Note: Streaming with fallback will restart from the beginning
   * if a provider fails mid-stream.
   */
  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    const providers = this.getAvailableProviders();

    for (const { provider, breaker } of providers) {
      if (breaker.isOpen()) {
        continue;
      }

      try {
        for await (const chunk of provider.stream(messages, options)) {
          yield chunk;
        }
        breaker.recordSuccess();
        return;
      } catch {
        breaker.recordFailure();
        // Continue to next provider
      }
    }

    throw new ProviderError("All providers failed for streaming", {
      provider: "fallback",
      retryable: false,
    });
  }

  /**
   * Stream a chat response with tools and fallback
   */
  async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    const providers = this.getAvailableProviders();

    for (const { provider, breaker } of providers) {
      if (breaker.isOpen()) {
        continue;
      }

      try {
        for await (const chunk of provider.streamWithTools(messages, options)) {
          yield chunk;
        }
        breaker.recordSuccess();
        return;
      } catch {
        breaker.recordFailure();
        // Continue to next provider
      }
    }

    throw new ProviderError("All providers failed for streaming with tools", {
      provider: "fallback",
      retryable: false,
    });
  }

  /**
   * Count tokens using the current provider
   *
   * @description Estimates token count using the current primary provider's tokenizer.
   *
   * @param text - Text to count tokens for
   * @returns Estimated token count
   */
  countTokens(text: string): number {
    const provider = this.getCurrentProvider();
    return provider.provider.countTokens(text);
  }

  /**
   * Get context window from current provider
   *
   * @description Returns the context window size of the current primary provider.
   *
   * @returns Maximum context window in tokens
   */
  getContextWindow(): number {
    const provider = this.getCurrentProvider();
    return provider.provider.getContextWindow();
  }

  /**
   * Check if any provider is available
   *
   * @description Checks all providers to see if at least one is available
   * and doesn't have an open circuit breaker.
   *
   * @returns true if at least one provider is available
   */
  async isAvailable(): Promise<boolean> {
    const results = await Promise.all(
      this.providers.map(async (p) => {
        if (p.breaker.isOpen()) {
          return false;
        }
        return p.provider.isAvailable();
      }),
    );
    return results.some((available) => available);
  }

  /**
   * Get the current primary provider
   *
   * @description Returns the provider that will be tried first for requests.
   *
   * @returns The current primary provider with its circuit breaker
   * @throws ProviderError if no provider is available
   */
  getCurrentProvider(): ProtectedProvider {
    const provider = this.providers[this.currentProviderIndex];
    if (!provider) {
      throw new ProviderError("No provider available", {
        provider: "fallback",
      });
    }
    return provider;
  }

  /**
   * Get circuit breaker status for all providers
   *
   * @description Returns the circuit breaker state and failure count for each provider.
   * Useful for monitoring and debugging provider health.
   *
   * @returns Array of provider status objects
   */
  getCircuitStatus(): Array<{
    providerId: string;
    state: string;
    failureCount: number;
  }> {
    return this.providers.map((p) => ({
      providerId: p.provider.id,
      state: p.breaker.getState(),
      failureCount: p.breaker.getFailureCount(),
    }));
  }

  /**
   * Reset circuit breakers for all providers
   *
   * @description Resets all circuit breakers to closed state, allowing
   * previously failing providers to be tried again.
   */
  resetCircuits(): void {
    for (const p of this.providers) {
      p.breaker.reset();
    }
  }

  /**
   * Execute a function with provider fallback
   */
  private async executeWithFallback<T>(fn: (provider: LLMProvider) => Promise<T>): Promise<T> {
    const providers = this.getAvailableProviders();
    const errors: Array<{ provider: string; error: unknown }> = [];

    for (const { provider, breaker } of providers) {
      try {
        const result = await breaker.execute(() => fn(provider));
        return result;
      } catch (error) {
        // Circuit open errors are expected, try next provider
        if (error instanceof CircuitOpenError) {
          errors.push({ provider: provider.id, error });
          continue;
        }

        // For other errors, the circuit breaker has already recorded the failure
        errors.push({ provider: provider.id, error });
      }
    }

    // All providers failed
    const errorMessages = errors
      .map((e) => {
        const msg = e.error instanceof Error ? e.error.message : String(e.error);
        return `${e.provider}: ${msg}`;
      })
      .join("; ");

    throw new ProviderError(`All providers failed: ${errorMessages}`, {
      provider: "fallback",
      retryable: false,
    });
  }

  /**
   * Get providers in priority order (starting from current index)
   */
  private getAvailableProviders(): ProtectedProvider[] {
    const result: ProtectedProvider[] = [];

    // Start from current index and wrap around
    for (let i = 0; i < this.providers.length; i++) {
      const index = (this.currentProviderIndex + i) % this.providers.length;
      const provider = this.providers[index];
      if (provider) {
        result.push(provider);
      }
    }

    return result;
  }
}

/**
 * Create a provider fallback from an array of providers
 *
 * @param providers - Array of providers in priority order
 * @param config - Optional fallback configuration
 * @returns Configured provider fallback
 */
export function createProviderFallback(
  providers: LLMProvider[],
  config?: ProviderFallbackConfig,
): ProviderFallback {
  return new ProviderFallback(providers, config);
}
