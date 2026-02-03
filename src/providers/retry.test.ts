/**
 * Tests for retry utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProviderError } from "../utils/errors.js";

describe("DEFAULT_RETRY_CONFIG", () => {
  it("should have sensible defaults", async () => {
    const { DEFAULT_RETRY_CONFIG } = await import("./retry.js");

    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(1000);
    expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000);
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
    expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBe(0.1);
  });
});

describe("isRetryableError", () => {
  it("should return true for recoverable ProviderError", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new ProviderError("Rate limited", {
      provider: "test",
      retryable: true,
    });

    expect(isRetryableError(error)).toBe(true);
  });

  it("should return false for non-recoverable ProviderError", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new ProviderError("Invalid API key", {
      provider: "test",
      retryable: false,
    });

    expect(isRetryableError(error)).toBe(false);
  });

  it("should return true for 429 rate limit error", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("HTTP 429: Too Many Requests");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for rate limit message", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("Rate limit exceeded, please try again later");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for 500 server error", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("HTTP 500: Internal Server Error");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for 502 bad gateway", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("HTTP 502: Bad Gateway");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for 503 service unavailable", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("HTTP 503: Service Unavailable");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for 504 gateway timeout", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("HTTP 504: Gateway Timeout");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for ECONNRESET", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("read ECONNRESET");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for ECONNREFUSED", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("connect ECONNREFUSED 127.0.0.1:8080");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for ETIMEDOUT", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("connect ETIMEDOUT");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for socket hang up", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("socket hang up");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return false for generic error", async () => {
    const { isRetryableError } = await import("./retry.js");

    const error = new Error("Something went wrong");
    expect(isRetryableError(error)).toBe(false);
  });

  it("should return false for non-error values", async () => {
    const { isRetryableError } = await import("./retry.js");

    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError(123)).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return result on first success", async () => {
    const { withRetry } = await import("./retry.js");

    const fn = vi.fn().mockResolvedValue("success");

    const result = await withRetry(fn);

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on retryable error", async () => {
    const { withRetry } = await import("./retry.js");

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 500: Server Error"))
      .mockResolvedValue("success");

    const resultPromise = withRetry(fn, { initialDelayMs: 10 });

    // Advance timer for retry delay
    await vi.advanceTimersByTimeAsync(100);

    const result = await resultPromise;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should throw immediately for non-retryable error", async () => {
    const { withRetry } = await import("./retry.js");

    const fn = vi.fn().mockRejectedValue(new Error("Invalid input"));

    await expect(withRetry(fn)).rejects.toThrow("Invalid input");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should throw after max retries", async () => {
    vi.useRealTimers(); // Use real timers for rejection test
    const { withRetry } = await import("./retry.js");

    const fn = vi.fn().mockRejectedValue(new Error("HTTP 500: Server Error"));

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 1, // Minimal delay for fast test
        jitterFactor: 0,
      })
    ).rejects.toThrow("HTTP 500");

    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    vi.useFakeTimers(); // Restore
  });

  it("should use custom config", async () => {
    const { withRetry } = await import("./retry.js");

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 429"))
      .mockResolvedValue("success");

    const resultPromise = withRetry(fn, {
      maxRetries: 1,
      initialDelayMs: 50,
      jitterFactor: 0, // No jitter for predictable delay
    });

    // Advance timer
    await vi.advanceTimersByTimeAsync(100);

    const result = await resultPromise;

    expect(result).toBe("success");
  });

  it("should increase delay exponentially", async () => {
    const { withRetry } = await import("./retry.js");

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValue("success");

    const resultPromise = withRetry(fn, {
      maxRetries: 3,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      jitterFactor: 0,
      maxDelayMs: 10000,
    });

    // Advance timers
    await vi.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should cap delay at maxDelayMs", async () => {
    const { withRetry } = await import("./retry.js");

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValue("success");

    const resultPromise = withRetry(fn, {
      maxRetries: 5,
      initialDelayMs: 1000,
      backoffMultiplier: 10, // Would grow quickly
      maxDelayMs: 500, // But capped at 500ms
      jitterFactor: 0,
    });

    // Advance timers
    await vi.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;

    expect(result).toBe("success");
  });
});

describe("createRetryableMethod", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should wrap method with retry logic", async () => {
    const { createRetryableMethod } = await import("./retry.js");

    const originalMethod = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValue("result");

    const wrappedMethod = createRetryableMethod(originalMethod, {
      initialDelayMs: 10,
      jitterFactor: 0,
    });

    const resultPromise = wrappedMethod("arg1", "arg2");

    await vi.advanceTimersByTimeAsync(100);

    const result = await resultPromise;

    expect(result).toBe("result");
    expect(originalMethod).toHaveBeenCalledWith("arg1", "arg2");
    expect(originalMethod).toHaveBeenCalledTimes(2);
  });

  it("should pass arguments to wrapped method", async () => {
    const { createRetryableMethod } = await import("./retry.js");

    const originalMethod = vi.fn().mockResolvedValue("done");
    const wrappedMethod = createRetryableMethod(originalMethod);

    await wrappedMethod(1, "two", { three: 3 });

    expect(originalMethod).toHaveBeenCalledWith(1, "two", { three: 3 });
  });
});
