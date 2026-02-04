/**
 * Circuit breaker pattern for LLM provider calls
 *
 * Prevents cascading failures by temporarily blocking requests to providers
 * that are experiencing issues. The circuit has three states:
 *
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Provider is failing, requests are blocked
 * - HALF-OPEN: Testing if provider has recovered
 */

import { ProviderError } from "../utils/errors.js";

/**
 * Circuit breaker states
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Milliseconds before attempting half-open state (default: 30000) */
  resetTimeout: number;
  /** Number of requests to allow in half-open state (default: 1) */
  halfOpenRequests: number;
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenRequests: 1,
};

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends ProviderError {
  readonly remainingTime: number;

  constructor(provider: string, remainingTime: number) {
    super(`Circuit breaker is open for provider: ${provider}`, {
      provider,
      retryable: true,
    });
    this.name = "CircuitOpenError";
    this.remainingTime = remainingTime;
  }
}

/**
 * Circuit breaker implementation
 *
 * Tracks failures and automatically opens/closes based on configured thresholds.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({ failureThreshold: 3 });
 *
 * // Wrap provider calls
 * const result = await breaker.execute(async () => {
 *   return provider.chat(messages);
 * });
 * ```
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private halfOpenSuccesses = 0;
  private readonly providerId: string;

  /**
   * Create a new circuit breaker
   *
   * @param config - Circuit breaker configuration
   * @param providerId - Provider identifier for error messages
   */
  constructor(config?: Partial<CircuitBreakerConfig>, providerId = "unknown") {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.providerId = providerId;
  }

  /**
   * Get the current circuit state
   */
  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  /**
   * Check if the circuit is currently open (blocking requests)
   */
  isOpen(): boolean {
    this.checkStateTransition();
    return this.state === "open";
  }

  /**
   * Get the current failure count
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Record a successful request
   * Resets failure count in closed state, or counts toward closing in half-open
   */
  recordSuccess(): void {
    if (this.state === "half-open") {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenRequests) {
        this.close();
      }
    } else if (this.state === "closed") {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed request
   * Increments failure count and may open the circuit
   */
  recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === "half-open") {
      // Any failure in half-open state opens the circuit again
      this.open();
    } else if (
      this.state === "closed" &&
      this.failureCount >= this.config.failureThreshold
    ) {
      this.open();
    }
  }

  /**
   * Execute a function with circuit breaker protection
   *
   * @param fn - Async function to execute
   * @returns Result of the function
   * @throws CircuitOpenError if circuit is open
   * @throws Original error if function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkStateTransition();

    if (this.state === "open") {
      const elapsed = Date.now() - (this.lastFailureTime ?? Date.now());
      const remaining = this.config.resetTimeout - elapsed;
      throw new CircuitOpenError(this.providerId, remaining);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Manually reset the circuit breaker to closed state
   */
  reset(): void {
    this.close();
  }

  /**
   * Check and perform state transitions based on time
   */
  private checkStateTransition(): void {
    if (this.state === "open" && this.lastFailureTime !== null) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.resetTimeout) {
        this.halfOpen();
      }
    }
  }

  /**
   * Transition to closed state
   */
  private close(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.halfOpenSuccesses = 0;
    this.lastFailureTime = null;
  }

  /**
   * Transition to open state
   */
  private open(): void {
    this.state = "open";
    this.halfOpenSuccesses = 0;
  }

  /**
   * Transition to half-open state
   */
  private halfOpen(): void {
    this.state = "half-open";
    this.halfOpenSuccesses = 0;
  }
}

/**
 * Create a circuit breaker with the given configuration
 *
 * @param config - Optional circuit breaker configuration
 * @param providerId - Optional provider identifier
 * @returns Configured circuit breaker instance
 */
export function createCircuitBreaker(
  config?: Partial<CircuitBreakerConfig>,
  providerId?: string
): CircuitBreaker {
  return new CircuitBreaker(config, providerId);
}
