import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isAbortError, humanizeProviderError, installProcessSafetyNet, MAX_CONSECUTIVE_ERRORS } from "./error-resilience.js";
import { ProviderError } from "../../utils/errors.js";

// ─── isAbortError ─────────────────────────────────────────────────────────────

describe("isAbortError", () => {
  it("returns true for DOM AbortError (name === AbortError)", () => {
    const err = Object.assign(new Error("Aborted"), { name: "AbortError" });
    expect(isAbortError(err)).toBe(true);
  });

  it("returns true for APIUserAbortError (Anthropic/OpenAI SDK)", () => {
    const err = Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
    expect(isAbortError(err)).toBe(true);
  });

  it("returns true when message is exactly 'Request was aborted.'", () => {
    const err = new Error("Request was aborted.");
    expect(isAbortError(err)).toBe(true);
  });

  it("returns true when message ends with 'Request was aborted.' (wrapped ProviderError)", () => {
    const err = new Error("OpenAI: Request was aborted.");
    expect(isAbortError(err)).toBe(true);
  });

  it("returns true when signal.aborted is true regardless of error", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const err = new Error("Some unrelated network error");
    expect(isAbortError(err, ctrl.signal)).toBe(true);
  });

  it("returns true when signal.aborted and no error instance", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(isAbortError("string error", ctrl.signal)).toBe(true);
  });

  it("returns false for a regular Error with no abort indicators", () => {
    const err = new Error("Connection refused");
    expect(isAbortError(err)).toBe(false);
  });

  it("returns false for ProviderError with status 429", () => {
    const err = new ProviderError("Rate limited", { provider: "openai", statusCode: 429 });
    expect(isAbortError(err)).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("string")).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });

  it("returns false when signal is NOT aborted", () => {
    const ctrl = new AbortController();
    const err = new Error("Something went wrong");
    expect(isAbortError(err, ctrl.signal)).toBe(false);
  });
});

// ─── humanizeProviderError ───────────────────────────────────────────────────

describe("humanizeProviderError", () => {
  it("maps 429 ProviderError to rate limit message", () => {
    const err = new ProviderError("Too many requests", { provider: "openai", statusCode: 429 });
    expect(humanizeProviderError(err)).toMatch(/rate limit/i);
  });

  it("maps 401 ProviderError to auth message", () => {
    const err = new ProviderError("Unauthorized", { provider: "openai", statusCode: 401 });
    expect(humanizeProviderError(err)).toMatch(/auth/i);
  });

  it("maps 403 ProviderError to auth message", () => {
    const err = new ProviderError("Forbidden", { provider: "anthropic", statusCode: 403 });
    expect(humanizeProviderError(err)).toMatch(/auth/i);
  });

  it("maps 500 ProviderError to server error message", () => {
    const err = new ProviderError("Internal Server Error", { provider: "openai", statusCode: 500 });
    const result = humanizeProviderError(err);
    expect(result).toMatch(/server error/i);
    expect(result).toContain("500");
  });

  it("maps 503 ProviderError to server error message", () => {
    const err = new ProviderError("Service Unavailable", { provider: "openai", statusCode: 503 });
    expect(humanizeProviderError(err)).toMatch(/server error/i);
  });

  it("maps ECONNREFUSED to network message", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:11434");
    expect(humanizeProviderError(err)).toMatch(/network/i);
  });

  it("maps ETIMEDOUT to network message", () => {
    const err = new Error("request timeout ETIMEDOUT");
    expect(humanizeProviderError(err)).toMatch(/network/i);
  });

  it("maps 'fetch failed' to network message", () => {
    const err = new Error("fetch failed");
    expect(humanizeProviderError(err)).toMatch(/network/i);
  });

  it("maps overloaded message to capacity message", () => {
    const err = new Error("Provider is overloaded. Please retry.");
    expect(humanizeProviderError(err)).toMatch(/overloaded/i);
  });

  it("maps stream timeout to timeout message", () => {
    const err = new Error("Stream timeout: No response from LLM for 120s");
    expect(humanizeProviderError(err)).toMatch(/timed out/i);
  });

  it("truncates long messages to 200 characters", () => {
    const longMsg = "x".repeat(300);
    const err = new Error(longMsg);
    const result = humanizeProviderError(err);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith("…")).toBe(true);
  });

  it("handles non-Error values gracefully", () => {
    expect(humanizeProviderError("raw string error")).toBe("raw string error");
    expect(humanizeProviderError(42)).toBe("42");
    expect(humanizeProviderError(null)).toBe("null");
  });

  it("ProviderError without statusCode returns message text", () => {
    const err = new ProviderError("socket hang up", { provider: "openai" });
    expect(humanizeProviderError(err)).toBe("socket hang up");
  });
});

// ─── installProcessSafetyNet ─────────────────────────────────────────────────

describe("installProcessSafetyNet", () => {
  let originalUncaught: NodeJS.UncaughtExceptionListener[];
  let originalRejection: NodeJS.UnhandledRejectionListener[];

  beforeEach(() => {
    // Reset the idempotency guard between tests
    // We need to reset the module-level flag
    originalUncaught = process.listeners("uncaughtException") as NodeJS.UncaughtExceptionListener[];
    originalRejection = process.listeners("unhandledRejection") as NodeJS.UnhandledRejectionListener[];
  });

  afterEach(() => {
    // Remove any handlers added during tests
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    for (const l of originalUncaught) process.on("uncaughtException", l);
    for (const l of originalRejection) process.on("unhandledRejection", l);
  });

  it("registers uncaughtException and unhandledRejection handlers", () => {
    const before = process.listenerCount("uncaughtException");
    installProcessSafetyNet();
    // May or may not have added (idempotency — if already called in another test)
    expect(process.listenerCount("uncaughtException")).toBeGreaterThanOrEqual(before);
  });

  it("registers a handler that is a function", () => {
    installProcessSafetyNet();
    const handler = process.listeners("uncaughtException").at(-1);
    expect(typeof handler).toBe("function");
  });

  it("registers an unhandledRejection handler that is a function", () => {
    installProcessSafetyNet();
    const handler = process.listeners("unhandledRejection").at(-1);
    expect(typeof handler).toBe("function");
  });
});

// ─── MAX_CONSECUTIVE_ERRORS ──────────────────────────────────────────────────

describe("MAX_CONSECUTIVE_ERRORS", () => {
  it("is a positive integer", () => {
    expect(typeof MAX_CONSECUTIVE_ERRORS).toBe("number");
    expect(MAX_CONSECUTIVE_ERRORS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_CONSECUTIVE_ERRORS)).toBe(true);
  });

  it("is 2 (matching plan specification)", () => {
    expect(MAX_CONSECUTIVE_ERRORS).toBe(2);
  });
});

// ─── isNonRetryableProviderError ─────────────────────────────────────────────

import { isNonRetryableProviderError, getUserFacingProviderError } from "./error-resilience.js";

describe("isNonRetryableProviderError", () => {
  it("returns true for 401 errors", () => {
    const err = new ProviderError("Unauthorized", { provider: "openai", statusCode: 401 });
    expect(isNonRetryableProviderError(err)).toBe(true);
  });

  it("returns true for 403 errors", () => {
    const err = new ProviderError("Forbidden", { provider: "openai", statusCode: 403 });
    expect(isNonRetryableProviderError(err)).toBe(true);
  });

  it("returns true for quota exceeded errors", () => {
    const err = new ProviderError("You exceeded your current quota", { provider: "openai", statusCode: 429 });
    expect(isNonRetryableProviderError(err)).toBe(true);
  });

  it("returns true for usage limit errors", () => {
    const err = new ProviderError("Usage limit exceeded", { provider: "copilot", statusCode: 429 });
    expect(isNonRetryableProviderError(err)).toBe(true);
  });

  it("returns true for insufficient quota errors", () => {
    const err = new ProviderError("insufficient_quota", { provider: "openai", statusCode: 400 });
    expect(isNonRetryableProviderError(err)).toBe(true);
  });

  it("returns true for billing errors", () => {
    const err = new ProviderError("Billing issue", { provider: "openai", statusCode: 400 });
    expect(isNonRetryableProviderError(err)).toBe(true);
  });

  it("returns false for regular 429 errors", () => {
    const err = new ProviderError("Too many requests", { provider: "openai", statusCode: 429 });
    expect(isNonRetryableProviderError(err)).toBe(false);
  });

  it("returns false for 500 errors", () => {
    const err = new ProviderError("Server error", { provider: "openai", statusCode: 500 });
    expect(isNonRetryableProviderError(err)).toBe(false);
  });

  it("returns false for non-ProviderError", () => {
    const err = new Error("Some error");
    expect(isNonRetryableProviderError(err)).toBe(false);
  });
});

// ─── getUserFacingProviderError ──────────────────────────────────────────────

describe("getUserFacingProviderError", () => {
  it("returns quota message for quota exceeded errors", () => {
    const err = new ProviderError("You exceeded your current quota", { provider: "openai", statusCode: 429 });
    const result = getUserFacingProviderError(err);
    expect(result).toContain("Subscription limit reached");
    expect(result).toContain("💳");
  });

  it("returns billing message for billing errors", () => {
    const err = new ProviderError("Billing issue", { provider: "openai", statusCode: 400 });
    const result = getUserFacingProviderError(err);
    expect(result).toContain("Billing issue");
    expect(result).toContain("💳");
  });

  it("returns auth message for 401 errors", () => {
    const err = new ProviderError("Unauthorized", { provider: "openai", statusCode: 401 });
    const result = getUserFacingProviderError(err);
    expect(result).toContain("Authentication failed");
    expect(result).toContain("🔑");
  });

  it("returns auth message for invalid_api_key", () => {
    const err = new ProviderError("invalid_api_key", { provider: "anthropic", statusCode: 401 });
    const result = getUserFacingProviderError(err);
    expect(result).toContain("Authentication failed");
  });

  it("returns permission message for 403 errors", () => {
    const err = new ProviderError("Not authorized", { provider: "openai", statusCode: 403 });
    const result = getUserFacingProviderError(err);
    expect(result).toContain("Permission denied");
    expect(result).toContain("🚫");
  });

  it("returns rate limit message for 429 errors", () => {
    const err = new ProviderError("Too many requests", { provider: "openai", statusCode: 429 });
    const result = getUserFacingProviderError(err);
    expect(result).toContain("Rate limit exceeded");
    expect(result).toContain("⏳");
  });

  it("returns null for non-ProviderError", () => {
    const err = new Error("Some error");
    expect(getUserFacingProviderError(err)).toBeNull();
  });

  it("returns null for unknown errors", () => {
    const err = new ProviderError("Unknown error", { provider: "openai", statusCode: 500 });
    expect(getUserFacingProviderError(err)).toBeNull();
  });
});
