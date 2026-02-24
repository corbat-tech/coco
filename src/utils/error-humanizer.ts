/**
 * Error Humanizer — converts technical error messages into plain language.
 *
 * Two-tier approach:
 *   1. Rule-based: fast synchronous lookup for common system / runtime errors.
 *   2. LLM fallback: async hint for unknown technical messages (non-blocking).
 */

import type { LLMProvider } from "../providers/types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the first single- or double-quoted path from a Node.js-style error
 * message (e.g. `"ENOENT: no such file or directory, open '/tmp/foo'"` → `/tmp/foo`).
 * Returns null when no quoted segment is found.
 */
function extractQuotedPath(msg: string): string | null {
  const single = msg.match(/'([^']+)'/);
  if (single?.[1]) return single[1];
  const double = msg.match(/"([^"]+)"/);
  return double?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Rule-based humanization
// ---------------------------------------------------------------------------

/**
 * Apply rule-based humanization to a raw error message.
 *
 * Returns a plain-language version when the error matches a known pattern,
 * or the original message unchanged when no rule applies.
 */
export function humanizeError(message: string, toolName?: string): string {
  const msg = message.trim();
  if (!msg) return msg;

  // --- Network errors ---
  if (/ECONNREFUSED/i.test(msg)) {
    return "Connection refused — the server may not be running";
  }
  if (/ENOTFOUND/i.test(msg)) {
    return "Host not found — check the URL or your internet connection";
  }
  if (/EHOSTUNREACH/i.test(msg)) {
    return "Host unreachable — check your network connection";
  }
  if (/ECONNRESET/i.test(msg)) {
    return "Connection reset — the server closed the connection unexpectedly";
  }
  if (/ERR_INVALID_URL/i.test(msg)) {
    return "Invalid URL format — check the URL syntax";
  }
  if (/CERT_|ERR_CERT_|SSL_ERROR|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(msg)) {
    return "SSL/TLS certificate error — the server certificate may be untrusted";
  }
  if (/fetch failed|network error|Failed to fetch/i.test(msg)) {
    return "Network request failed — check your internet connection";
  }

  // --- Filesystem errors (with path extraction) ---
  // Node.js error format: "ECODE: human message, operation '/path/to/file'"
  // We extract the first single- or double-quoted path segment when present.
  if (/ENOENT/i.test(msg)) {
    const path = extractQuotedPath(msg);
    return path ? `File or directory not found: ${path}` : "File or directory not found";
  }
  if (/EACCES/i.test(msg)) {
    const path = extractQuotedPath(msg);
    return path ? `Permission denied: ${path}` : "Permission denied — check file permissions";
  }
  if (/EISDIR/i.test(msg)) {
    return "Expected a file but found a directory at the specified path";
  }
  if (/ENOTDIR/i.test(msg)) {
    return "Expected a directory but found a file in the path";
  }
  if (/EEXIST/i.test(msg)) {
    return "File or directory already exists";
  }
  if (/ENOSPC/i.test(msg)) {
    return "No disk space left — free up some space and try again";
  }
  if (/EROFS/i.test(msg)) {
    return "Write failed — the file system is read-only";
  }
  if (/EMFILE|ENFILE/i.test(msg)) {
    return "Too many open files — try restarting and running again";
  }

  // --- Git errors ---
  if (/not a git repository/i.test(msg)) {
    return "Not a git repository — run 'git init' to initialize one";
  }
  if (/nothing to commit/i.test(msg)) {
    return "Nothing to commit — the working tree is clean";
  }
  if (/merge conflict|CONFLICT/i.test(msg)) {
    return "Merge conflict detected — resolve the conflicts before continuing";
  }
  if (/non-fast-forward|rejected.*push/i.test(msg)) {
    return "Push rejected — pull the latest changes first (git pull)";
  }
  if (/authentication failed/i.test(msg) && /git/i.test(msg)) {
    return "Git authentication failed — check your credentials or SSH key";
  }
  if (/branch.*already exists/i.test(msg)) {
    return "Branch already exists — choose a different name or use the existing branch";
  }
  if (/detached HEAD/i.test(msg)) {
    return "Detached HEAD — checkout a branch to start committing";
  }
  if (/(bad revision|does not exist on|unknown revision)/i.test(msg)) {
    return "Git reference not found — the branch or commit may not exist";
  }

  // --- JSON / Parse errors ---
  if (/Unexpected token.*JSON|JSON\.parse|Unexpected end of JSON/i.test(msg)) {
    return "Failed to parse JSON — the data may be malformed";
  }
  if (/SyntaxError.*Unexpected token/i.test(msg)) {
    return "Syntax error in the data — check for formatting issues";
  }

  // --- Module / Import errors ---
  const moduleMatch = msg.match(/Cannot find module ['"]([^'"]+)['"]/i);
  if (moduleMatch) {
    return `Module not found: '${moduleMatch[1]}' — run the install command to add it`;
  }
  if (/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i.test(msg)) {
    return "Required module not found — run the install command first";
  }
  if (/ERR_REQUIRE_ESM/i.test(msg)) {
    return "Module format mismatch — this package requires ESM (type: module)";
  }

  // --- Command / Process errors ---
  if (/command not found/i.test(msg) || (/spawn.*ENOENT/i.test(msg) && toolName === "bash_exec")) {
    const cmdMatch = msg.match(/Command '([^']+)' not found|spawn ([^\s]+) ENOENT/);
    const cmd = cmdMatch?.[1] ?? cmdMatch?.[2];
    return cmd
      ? `Command '${cmd}' not found — is it installed and in your PATH?`
      : "Command not found — check it is installed and available in PATH";
  }
  if (/permission denied/i.test(msg) && /spawn|exec/i.test(msg)) {
    return "Permission denied — the script may not be executable (try: chmod +x)";
  }

  // --- API / Auth errors ---
  if (/\b401\b|Unauthorized/i.test(msg)) {
    return "Authentication failed (401) — check your API key or credentials";
  }
  if (/\b403\b|Forbidden/i.test(msg)) {
    return "Access denied (403) — you don't have permission for this action";
  }
  if (/\b429\b|rate.?limit/i.test(msg)) {
    return "Rate limit exceeded (429) — too many requests, wait a moment and retry";
  }
  if (/\b503\b|Service Unavailable/i.test(msg)) {
    return "Service temporarily unavailable (503) — try again in a few minutes";
  }
  if (/invalid.*api.?key|api.?key.*invalid|api.?key.*not.*found/i.test(msg)) {
    return "Invalid or missing API key — check your provider credentials";
  }

  // No rule matched — return original
  return msg;
}

// ---------------------------------------------------------------------------
// Technical jargon detector
// ---------------------------------------------------------------------------

/** Patterns that indicate a message is hard to read without technical context. */
const JARGON_PATTERNS: RegExp[] = [
  /\bE[A-Z]{3,}\b/, // POSIX error codes: EPERM, ENOENT, EACCES, …
  /0x[0-9a-f]{4,}/i, // hex addresses
  /at \w[\w.]*\s*\(/, // stack trace "at functionName ("
  /ERR_[A-Z_]{3,}/, // Node.js ERR_ codes
  /TypeError:|ReferenceError:|RangeError:|SyntaxError:/,
  /zod|ZodError|ZodIssue/i,
  /Cannot read propert/i,
  /is not a function\b/i,
  /Cannot destructure property/i,
  /undefined is not/i,
  /null is not/i,
  /TS\d{4}:/, // TypeScript error codes
];

/**
 * Returns true when the message contains technical jargon that a regular user
 * is unlikely to understand without additional context.
 */
export function looksLikeTechnicalJargon(message: string): boolean {
  return JARGON_PATTERNS.some((p) => p.test(message));
}

// ---------------------------------------------------------------------------
// LLM-powered fallback
// ---------------------------------------------------------------------------

const LLM_TIMEOUT_MS = 6000;

/**
 * Ask the LLM for a plain-language explanation of an error message.
 *
 * This is intentionally non-blocking: callers should fire-and-forget and
 * await the returned promise only after the main agent turn has completed.
 * Returns null on failure or timeout so callers can safely ignore it.
 */
export async function humanizeWithLLM(
  errorMessage: string,
  toolName: string,
  provider: LLMProvider,
): Promise<string | null> {
  const prompt = [
    `A developer tool called "${toolName}" produced this error:`,
    ``,
    `"""`,
    errorMessage.slice(0, 500),
    `"""`,
    ``,
    `In 1–2 sentences, explain what went wrong in plain English and suggest the most likely fix.`,
    `Reply with only the explanation — no preamble, no code blocks.`,
  ].join("\n");

  try {
    const response = await Promise.race([
      provider.chat([{ role: "user", content: prompt }], { maxTokens: 120, temperature: 0 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LLM_TIMEOUT_MS)),
    ]);

    if (!response || !("content" in response)) return null;
    return response.content.trim() || null;
  } catch {
    return null;
  }
}
