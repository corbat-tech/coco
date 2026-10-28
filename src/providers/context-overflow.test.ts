import { describe, expect, it } from "vitest";
import { isContextOverflowError } from "./context-overflow.js";

describe("input context overflow classification", () => {
  it.each([
    { code: "context_length_exceeded" },
    { error: { type: "context_window_exceeded" } },
    new Error("provider rejected", {
      cause: { response: { data: { error: { code: "prompt_too_long" } } } },
    }),
    { body: JSON.stringify({ error: { code: "input_too_long" } }) },
    new Error("prompt token count of 12345 exceeds the limit of 10000"),
    new Error(
      "The input token count (12345) exceeds the maximum number of tokens allowed (10000).",
    ),
    new Error("prompt is too long: 2345 tokens > 1024 maximum"),
    new Error("Maximum context length exceeded"),
  ])("recognizes explicit context overflow %#", (error) => {
    expect(isContextOverflowError(error)).toBe(true);
  });
  it.each([
    { status: 400, message: "Invalid argument" },
    { status: 429, cause: { code: "context_length_exceeded" } },
    { name: "AbortError", cause: { code: "context_length_exceeded" } },
    { name: "APIUserAbortError", cause: { code: "context_length_exceeded" } },
    { code: "ETIMEDOUT", cause: { code: "context_length_exceeded" } },
    { stopReason: "max_tokens", cause: { code: "context_length_exceeded" } },
    new Error("Network timeout"),
    new Error("Tool result contains context_length_exceeded"),
    new Error("output token limit max_tokens"),
    null,
    undefined,
  ])("does not recover unrelated errors %#", (error) => {
    expect(isContextOverflowError(error)).toBe(false);
  });
  it("bounds cyclic nested errors", () => {
    const error: { cause?: unknown; code: string } = { code: "unknown" };
    error.cause = error;
    expect(isContextOverflowError(error)).toBe(false);
  });
  it.each(["input token count", "context window context length", "input too long"])(
    "handles repeated incomplete provider phrases: %s",
    (phrase) => {
      expect(isContextOverflowError(new Error(`${phrase} `.repeat(10000)))).toBe(false);
    },
  );
  it.each([
    "input token count\nexceeds maximum",
    "context window\nexceeded",
    "input too long\ntokens",
    "exceeds maximum input token count",
    "exceeded context window",
    "tokens input too long",
  ])("requires ordered phrases on the same line: %s", (message) => {
    expect(isContextOverflowError(new Error(message))).toBe(false);
  });
});
