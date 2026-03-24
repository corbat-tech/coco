/**
 * Error resilience helpers for the REPL main loop.
 *
 * Provides:
 * - isAbortError()           — robust abort detection across SDK types
 * - humanizeProviderError()  — short, LLM-friendly error summaries
 * - installProcessSafetyNet() — uncaughtException / unhandledRejection guards
 * - MAX_CONSECUTIVE_ERRORS   — recovery attempt budget
 */

import chalk from "chalk";
import { ProviderError } from "../../utils/errors.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum consecutive failed recovery attempts before giving up. */
export const MAX_CONSECUTIVE_ERRORS = 2;

// ─── Abort detection ─────────────────────────────────────────────────────────

/**
 * Returns true if the error represents an intentional request abort.
 *
 * Covers:
 * - DOM standard AbortError (`{ name: "AbortError" }`)
 * - Anthropic SDK APIUserAbortError (`{ name: "APIUserAbortError" }`)
 * - OpenAI SDK APIUserAbortError (same class name, different package)
 * - Message-based fallback for wrapped abort errors
 * - Any error that occurred while the turn's AbortSignal was already aborted
 *
 * @param error - The caught value (may not be an Error instance)
 * @param signal - Optional AbortSignal from the current turn's AbortController
 */
export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  // If the controlling signal is already aborted, any error is an abort side-effect
  if (signal?.aborted) return true;

  if (!(error instanceof Error)) return false;

  // DOM standard + node:events AbortController
  if (error.name === "AbortError") return true;

  // Anthropic SDK: APIUserAbortError
  // OpenAI SDK:    APIUserAbortError
  // Both SDKs use the same class name for user-initiated aborts
  if (error.name === "APIUserAbortError") return true;

  // Fallback: match the canonical abort message used by both SDKs
  // ("Request was aborted." — from APIUserAbortError constructor)
  if (error.message === "Request was aborted.") return true;

  // Wrapped ProviderError with the abort message
  if (error.message.endsWith("Request was aborted.")) return true;

  return false;
}

// ─── Error humanization ───────────────────────────────────────────────────────

/**
 * Check if an error is a non-retryable provider error.
 * These are configuration/auth/quota errors that won't be fixed by retrying.
 */
export function isNonRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    const code = error.statusCode;
    // Auth errors - won't be fixed by retrying
    if (code === 401 || code === 403) return true;
    // Specific non-retryable messages
    const msg = error.message.toLowerCase();
    if (
      msg.includes("exceeded your current quota") ||
      msg.includes("usage limit") ||
      msg.includes("insufficient_quota") ||
      msg.includes("billing") ||
      msg.includes("payment") ||
      msg.includes("invalid_api_key") ||
      msg.includes("incorrect api key") ||
      msg.includes("bad credentials") ||
      msg.includes("not authorized")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Get a user-friendly error message for provider errors.
 * This is shown to the user immediately without retry attempts.
 */
export function getUserFacingProviderError(error: unknown): string | null {
  if (!(error instanceof ProviderError)) return null;

  const code = error.statusCode;
  const msg = error.message.toLowerCase();

  // Quota/Billing errors
  if (
    msg.includes("exceeded your current quota") ||
    msg.includes("usage limit") ||
    msg.includes("insufficient_quota") ||
    msg.includes("you have exceeded")
  ) {
    return `💳 Subscription limit reached: You've used all your available tokens/credits for this billing period.`;
  }

  // Billing/Payment issues
  if (msg.includes("billing") || msg.includes("payment") || msg.includes("active billing")) {
    return `💳 Billing issue: Please check your billing settings and payment method.`;
  }

  // Auth errors
  if (
    code === 401 ||
    msg.includes("invalid_api_key") ||
    msg.includes("incorrect api key") ||
    msg.includes("bad credentials")
  ) {
    return `🔑 Authentication failed: Your API key or token is invalid or has expired. Run 'coco --setup' to reconfigure.`;
  }

  // Permission errors
  if (code === 403 || msg.includes("not authorized") || msg.includes("permission")) {
    return `🚫 Permission denied: Your account doesn't have access to this model or feature.`;
  }

  // Rate limit
  if (code === 429) {
    return `⏳ Rate limit exceeded: Too many requests. Please wait a moment and try again.`;
  }

  return null;
}

/**
 * Produces a short, actionable summary of a provider error for LLM injection.
 *
 * Maximum 200 characters. Focused on provider-level failures (network, rate
 * limits, server errors). Does NOT replace the user-facing humanizeError() in
 * error-humanizer.ts — this variant is optimised for the recovery message
 * that gets sent back to the LLM.
 */
export function humanizeProviderError(error: unknown): string {
  if (error instanceof ProviderError) {
    const code = error.statusCode;
    const msg = error.message.toLowerCase();

    // Quota/Billing errors
    if (
      msg.includes("exceeded your current quota") ||
      msg.includes("usage limit") ||
      msg.includes("insufficient_quota")
    ) {
      return "Quota exceeded — your subscription limit has been reached. Check billing or upgrade plan.";
    }

    // Auth errors
    if (code === 401 || code === 403) {
      return "Authentication error — API key may be invalid or missing permissions.";
    }

    // Rate limit
    if (code === 429) {
      return "Rate limited by provider — too many requests. Consider slowing down or switching models.";
    }

    // Server errors
    if (code !== undefined && code >= 500) {
      return `Provider server error (${code}) — temporary issue, retry may help.`;
    }

    // ProviderError with no statusCode (e.g. network-level)
    return truncate(error.message, 200);
  }

  if (error instanceof Error) {
    const msg = error.message;

    // Network-level errors
    if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(msg)) {
      return "Network connection failed — check your internet connection or provider endpoint.";
    }

    // Provider capacity
    if (/overloaded|capacity|too many requests/i.test(msg)) {
      return "Provider is overloaded — retry in a moment or switch to a different model.";
    }

    // Stream timeout (from our own timeout guard)
    if (/stream timeout/i.test(msg)) {
      return "Response stream timed out — the model took too long. Try a shorter prompt or faster model.";
    }

    return truncate(msg, 200);
  }

  return truncate(String(error), 200);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ─── Process-level safety net ────────────────────────────────────────────────

let _safetyNetInstalled = false;

/**
 * Registers process-level handlers for uncaughtException and
 * unhandledRejection.
 *
 * These handlers prevent the Coco process from crashing on unexpected throws
 * that escape all other catch blocks. The REPL loop continues after logging.
 *
 * Idempotent — safe to call multiple times.
 * Set COCO_DEBUG=1 to include full stack traces in the output.
 */
export function installProcessSafetyNet(): void {
  if (_safetyNetInstalled) return;
  _safetyNetInstalled = true;

  const debug = Boolean(process.env["COCO_DEBUG"]);

  process.on("uncaughtException", (error: Error) => {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n× Unexpected error (uncaught): ${msg}`));
    if (debug) console.error(error.stack);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error(chalk.red(`\n× Unhandled rejection: ${msg}`));
    if (debug && reason instanceof Error) console.error(reason.stack);
  });
}
