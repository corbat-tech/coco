/**
 * Retry utility with exponential backoff for Corbat-Coco providers
 */

import { ProviderError } from "../utils/errors.js";

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Jitter factor 0-1 to add randomness (default: 0.1) */
  jitterFactor: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay with jitter
 */
function calculateDelay(
  baseDelay: number,
  jitterFactor: number,
  maxDelay: number
): number {
  // Add jitter: +/- jitterFactor * baseDelay
  const jitter = baseDelay * jitterFactor * (Math.random() * 2 - 1);
  const delay = baseDelay + jitter;
  return Math.min(Math.max(delay, 0), maxDelay);
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  // Check ProviderError recoverable flag
  if (error instanceof ProviderError) {
    return error.recoverable;
  }

  // Check for common retryable error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Rate limiting
    if (message.includes("429") || message.includes("rate limit")) {
      return true;
    }

    // Server errors
    if (message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504")) {
      return true;
    }

    // Network errors
    if (
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("etimedout") ||
      message.includes("socket hang up")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Execute a function with retry and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;
  let delay = fullConfig.initialDelayMs;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (!isRetryableError(error) || attempt === fullConfig.maxRetries) {
        throw error;
      }

      // Calculate delay with jitter
      const actualDelay = calculateDelay(
        delay,
        fullConfig.jitterFactor,
        fullConfig.maxDelayMs
      );

      // Wait before retry
      await sleep(actualDelay);

      // Increase delay for next attempt
      delay = Math.min(delay * fullConfig.backoffMultiplier, fullConfig.maxDelayMs);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}

/**
 * Create a retry wrapper for a provider method
 */
export function createRetryableMethod<TArgs extends unknown[], TResult>(
  method: (...args: TArgs) => Promise<TResult>,
  config: Partial<RetryConfig> = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => method(...args), config);
}
