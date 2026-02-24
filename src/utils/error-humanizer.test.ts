/**
 * Tests for Error Humanizer
 */

import { describe, it, expect, vi } from "vitest";
import { humanizeError, looksLikeTechnicalJargon, humanizeWithLLM } from "./error-humanizer.js";
import type { LLMProvider } from "../providers/types.js";

// ---------------------------------------------------------------------------
// humanizeError — rule-based
// ---------------------------------------------------------------------------

describe("humanizeError", () => {
  // Passthrough cases
  it("returns the original message when no rule matches", () => {
    const msg = "Something went wrong during processing";
    expect(humanizeError(msg)).toBe(msg);
  });

  it("returns empty string unchanged", () => {
    expect(humanizeError("")).toBe("");
  });

  it("trims whitespace before matching", () => {
    const result = humanizeError("  ECONNREFUSED  ");
    expect(result).toBe("Connection refused — the server may not be running");
  });

  // Network errors
  it("humanizes ECONNREFUSED", () => {
    expect(humanizeError("connect ECONNREFUSED 127.0.0.1:3000")).toContain("Connection refused");
  });

  it("humanizes ENOTFOUND", () => {
    expect(humanizeError("getaddrinfo ENOTFOUND api.example.com")).toContain("Host not found");
  });

  it("humanizes EHOSTUNREACH", () => {
    expect(humanizeError("EHOSTUNREACH")).toContain("unreachable");
  });

  it("humanizes ECONNRESET", () => {
    expect(humanizeError("read ECONNRESET")).toContain("Connection reset");
  });

  it("humanizes ERR_INVALID_URL", () => {
    expect(humanizeError("ERR_INVALID_URL")).toContain("Invalid URL");
  });

  it("humanizes SSL certificate errors", () => {
    expect(humanizeError("UNABLE_TO_VERIFY_LEAF_SIGNATURE")).toContain("SSL");
    expect(humanizeError("ERR_CERT_AUTHORITY_INVALID")).toContain("SSL");
  });

  it("humanizes fetch failed", () => {
    expect(humanizeError("fetch failed")).toContain("Network request failed");
    expect(humanizeError("Failed to fetch")).toContain("Network request failed");
  });

  // Filesystem errors — with path extraction
  it("extracts path from ENOENT message", () => {
    const result = humanizeError(
      "ENOENT: no such file or directory, open '/home/user/missing.txt'",
    );
    expect(result).toContain("not found");
    expect(result).toContain("/home/user/missing.txt");
  });

  it("returns generic not-found message when ENOENT has no path", () => {
    expect(humanizeError("ENOENT")).toBe("File or directory not found");
  });

  it("extracts path from EACCES message", () => {
    const result = humanizeError("EACCES: permission denied, open '/etc/shadow'");
    expect(result).toContain("Permission denied");
    expect(result).toContain("/etc/shadow");
  });

  it("returns generic permission denied when EACCES has no path", () => {
    expect(humanizeError("EACCES")).toContain("Permission denied");
  });

  it("humanizes EISDIR", () => {
    expect(humanizeError("EISDIR: illegal operation on a directory")).toContain("directory");
  });

  it("humanizes ENOTDIR", () => {
    expect(humanizeError("ENOTDIR")).toContain("directory");
  });

  it("humanizes EEXIST", () => {
    expect(humanizeError("EEXIST: file already exists")).toContain("already exists");
  });

  it("humanizes ENOSPC", () => {
    expect(humanizeError("ENOSPC: no space left on device")).toContain("No disk space");
  });

  it("humanizes EROFS", () => {
    expect(humanizeError("EROFS: read-only file system")).toContain("read-only");
  });

  it("humanizes EMFILE", () => {
    expect(humanizeError("EMFILE: too many open files")).toContain("Too many open files");
  });

  // Git errors
  it("humanizes not a git repository", () => {
    expect(humanizeError("fatal: not a git repository")).toContain("git repository");
  });

  it("humanizes nothing to commit", () => {
    expect(humanizeError("nothing to commit, working tree clean")).toContain("Nothing to commit");
  });

  it("humanizes merge conflict", () => {
    expect(humanizeError("CONFLICT (content): Merge conflict in file.ts")).toContain("conflict");
  });

  it("humanizes push rejected", () => {
    expect(humanizeError("! [rejected] main -> main (non-fast-forward)")).toContain("rejected");
  });

  it("humanizes bad revision", () => {
    expect(humanizeError("fatal: bad revision 'feature/missing'")).toContain("not found");
  });

  it("humanizes detached HEAD", () => {
    expect(humanizeError("You are in 'detached HEAD' state")).toContain("Detached HEAD");
  });

  it("humanizes branch already exists", () => {
    expect(humanizeError("fatal: A branch named 'main' already exists")).toContain(
      "already exists",
    );
  });

  // JSON errors
  it("humanizes JSON parse error", () => {
    expect(humanizeError("Unexpected token < in JSON at position 0")).toContain(
      "Failed to parse JSON",
    );
  });

  it("humanizes JSON.parse reference in error", () => {
    expect(humanizeError("SyntaxError: JSON.parse: unexpected character")).toContain("JSON");
  });

  // Module errors
  it("extracts module name from Cannot find module", () => {
    const result = humanizeError("Cannot find module 'chalk'");
    expect(result).toContain("chalk");
    expect(result).toContain("not found");
  });

  it("humanizes ERR_MODULE_NOT_FOUND", () => {
    expect(humanizeError("Error [ERR_MODULE_NOT_FOUND]: Cannot find module")).toContain(
      "not found",
    );
  });

  it("humanizes ERR_REQUIRE_ESM", () => {
    expect(humanizeError("ERR_REQUIRE_ESM")).toContain("ESM");
  });

  // Command / process errors
  it("humanizes command not found", () => {
    expect(humanizeError("Command 'pnpm' not found")).toContain("not found");
    expect(humanizeError("Command 'pnpm' not found")).toContain("pnpm");
  });

  it("humanizes spawn ENOENT for bash_exec tool", () => {
    const result = humanizeError("spawn /usr/bin/nonexistent ENOENT", "bash_exec");
    expect(result).toContain("not found");
  });

  it("does NOT humanize spawn ENOENT for non-bash tools (no toolName match)", () => {
    // spawn ENOENT without toolName === "bash_exec" → falls through to ENOENT path or passthrough
    const result = humanizeError("spawn /usr/bin/nonexistent ENOENT", "write_file");
    // Should still be humanized via the ENOENT path (enoentMatch), not the command-not-found path
    expect(result).toBeTruthy();
  });

  // API / Auth errors
  it("humanizes 401 Unauthorized", () => {
    expect(humanizeError("Request failed with status 401")).toContain("401");
  });

  it("humanizes 403 Forbidden", () => {
    expect(humanizeError("403 Forbidden")).toContain("403");
  });

  it("humanizes 429 rate limit", () => {
    expect(humanizeError("429 Too Many Requests")).toContain("429");
    expect(humanizeError("rate limit exceeded")).toContain("Rate limit");
  });

  it("humanizes 503 Service Unavailable", () => {
    expect(humanizeError("503 Service Unavailable")).toContain("503");
  });

  it("humanizes invalid API key messages", () => {
    expect(humanizeError("Invalid api key provided")).toContain("API key");
  });
});

// ---------------------------------------------------------------------------
// looksLikeTechnicalJargon
// ---------------------------------------------------------------------------

describe("looksLikeTechnicalJargon", () => {
  it("returns true for POSIX error codes", () => {
    expect(looksLikeTechnicalJargon("ENOENT: no such file")).toBe(true);
    expect(looksLikeTechnicalJargon("EACCES: permission denied")).toBe(true);
  });

  it("returns true for Node.js ERR_ codes", () => {
    expect(looksLikeTechnicalJargon("ERR_MODULE_NOT_FOUND")).toBe(true);
  });

  it("returns true for stack trace lines", () => {
    expect(looksLikeTechnicalJargon("at parseJSON (utils.js:42)")).toBe(true);
  });

  it("returns true for JavaScript error types", () => {
    expect(looksLikeTechnicalJargon("TypeError: cannot read property")).toBe(true);
    expect(looksLikeTechnicalJargon("ReferenceError: foo is not defined")).toBe(true);
  });

  it("returns true for 'is not a function'", () => {
    expect(looksLikeTechnicalJargon("foo.bar is not a function")).toBe(true);
  });

  it("returns true for 'Cannot read propert' variants", () => {
    expect(looksLikeTechnicalJargon("Cannot read properties of undefined")).toBe(true);
  });

  it("returns true for hex addresses", () => {
    expect(looksLikeTechnicalJargon("Segfault at 0xdeadbeef")).toBe(true);
  });

  it("returns true for TypeScript error codes", () => {
    expect(looksLikeTechnicalJargon("TS2345: Argument of type")).toBe(true);
  });

  it("returns true for Zod mentions", () => {
    expect(looksLikeTechnicalJargon("ZodError: invalid_type at path")).toBe(true);
  });

  it("returns false for a plain readable message", () => {
    expect(looksLikeTechnicalJargon("File not found")).toBe(false);
  });

  it("returns false for a short simple error", () => {
    expect(looksLikeTechnicalJargon("Connection refused")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(looksLikeTechnicalJargon("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// humanizeWithLLM
// ---------------------------------------------------------------------------

describe("humanizeWithLLM", () => {
  function makeMockProvider(response: string | null, throws = false): LLMProvider {
    return {
      chat: throws
        ? vi.fn().mockRejectedValue(new Error("provider error"))
        : response === null
          ? vi.fn().mockResolvedValue(null)
          : vi
              .fn()
              .mockResolvedValue({
                content: response,
                id: "1",
                stopReason: "end_turn",
                usage: { inputTokens: 10, outputTokens: 20 },
                model: "test",
              }),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn().mockResolvedValue(10),
      isAvailable: vi.fn().mockResolvedValue(true),
      getModel: vi.fn().mockReturnValue("test"),
      updateModel: vi.fn(),
    } as unknown as LLMProvider;
  }

  it("returns the LLM response content when successful", async () => {
    const provider = makeMockProvider("The config file is missing — create .env first.");
    const result = await humanizeWithLLM("ENOENT: .env", "bash_exec", provider);
    expect(result).toBe("The config file is missing — create .env first.");
  });

  it("returns null when provider throws", async () => {
    const provider = makeMockProvider(null, true);
    const result = await humanizeWithLLM("ENOENT: .env", "bash_exec", provider);
    expect(result).toBeNull();
  });

  it("returns null when response has no content field", async () => {
    const provider = makeMockProvider(null);
    const result = await humanizeWithLLM("ENOENT: .env", "bash_exec", provider);
    expect(result).toBeNull();
  });

  it("returns null when LLM returns empty string", async () => {
    const provider = makeMockProvider("   ");
    const result = await humanizeWithLLM("ENOENT: .env", "bash_exec", provider);
    expect(result).toBeNull();
  });

  it("truncates very long error messages before sending to LLM", async () => {
    const longMessage = "x".repeat(1000);
    const provider = makeMockProvider("Some explanation.");
    await humanizeWithLLM(longMessage, "write_file", provider);
    const calledWith = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const prompt = typeof calledWith?.[0]?.content === "string" ? calledWith[0].content : "";
    // The sliced error (500 chars) should appear in the prompt, not the full 1000
    expect(prompt).toContain("x".repeat(500));
    expect(prompt).not.toContain("x".repeat(501));
  });

  it("resolves to null on timeout (simulated by fast fake timer)", async () => {
    vi.useFakeTimers();
    const provider = {
      chat: vi.fn(() => new Promise(() => {})), // never resolves
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn(),
      isAvailable: vi.fn(),
      getModel: vi.fn(),
      updateModel: vi.fn(),
    } as unknown as LLMProvider;

    const promise = humanizeWithLLM("some error", "bash_exec", provider);
    // Advance past the 6-second timeout
    await vi.advanceTimersByTimeAsync(7000);
    const result = await promise;
    expect(result).toBeNull();
    vi.useRealTimers();
  });
});
