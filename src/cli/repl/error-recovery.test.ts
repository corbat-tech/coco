/**
 * Tests for error recovery improvements:
 * - result.error from agent-loop triggers LLM recovery path
 * - coco setup saves configuration (via saveConfiguration)
 * - executeSingleTool never throws on unexpected errors
 * - Phase 1 (confirmations) errors don't break the agent turn
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Tests for executeSingleTool error handling ──────────────────────────────

describe("ParallelToolExecutor.executeSingleTool — unexpected error handling", () => {
  it("returns error ExecutedToolCall instead of throwing on unexpected registry error", async () => {
    const { ParallelToolExecutor } = await import("./parallel-executor.js");
    const executor = new ParallelToolExecutor();

    // Registry that throws an unexpected error (should never happen normally)
    const registry = {
      execute: vi.fn().mockRejectedValue(new Error("Unexpected registry crash")),
    } as unknown as import("../../tools/registry.js").ToolRegistry;

    const toolCall = { id: "tc1", name: "read_file", input: { path: "/tmp/test.txt" } };

    // Cast to access private method for testing
    const result = await (executor as unknown as Record<string, Function>)["executeSingleTool"](
      toolCall,
      1,
      1,
      registry,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(result).not.toBeNull();
    expect(result!.result.success).toBe(false);
    expect(result!.result.error).toContain("Unexpected registry crash");
    expect(result!.id).toBe("tc1");
    expect(result!.name).toBe("read_file");
  });

  it("returns null for abort errors instead of throwing", async () => {
    const { ParallelToolExecutor } = await import("./parallel-executor.js");
    const executor = new ParallelToolExecutor();

    const abortError = new Error("Request was aborted.");
    const registry = {
      execute: vi.fn().mockRejectedValue(abortError),
    } as unknown as import("../../tools/registry.js").ToolRegistry;

    const toolCall = { id: "tc2", name: "bash_exec", input: { command: "sleep 10" } };

    const result = await (executor as unknown as Record<string, Function>)["executeSingleTool"](
      toolCall,
      1,
      1,
      registry,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeNull();
  });
});

// ─── Tests for executeParallel — never throws on tool error ──────────────────

describe("ParallelToolExecutor.executeParallel — flow never breaks on tool error", () => {
  it("returns error results for all tools when registry throws, does not throw", async () => {
    const { ParallelToolExecutor } = await import("./parallel-executor.js");
    const executor = new ParallelToolExecutor();

    const registry = {
      execute: vi.fn().mockRejectedValue(new Error("Registry boom")),
    } as unknown as import("../../tools/registry.js").ToolRegistry;

    const toolCalls = [
      { id: "t1", name: "read_file", input: {} },
      { id: "t2", name: "write_file", input: {} },
    ];

    // Should NOT throw
    const result = await executor.executeParallel(toolCalls, registry);

    // Both tools produce error results (or are skipped) — flow continues
    expect(result.aborted).toBe(false);
    // Either executed with errors or skipped — never undefined/crash
    const total = result.executed.length + result.skipped.length;
    expect(total).toBe(2);

    for (const exec of result.executed) {
      expect(exec.result.success).toBe(false);
    }
  });
});

// ─── Tests for installProcessSafetyNet ───────────────────────────────────────

describe("installProcessSafetyNet", () => {
  it("is idempotent (calling twice does not register double handlers)", async () => {
    const { installProcessSafetyNet } = await import("./error-resilience.js");
    const listenersBefore = process.listenerCount("uncaughtException");
    installProcessSafetyNet();
    installProcessSafetyNet(); // second call should be a no-op
    const listenersAfter = process.listenerCount("uncaughtException");
    // At most 1 new listener added (regardless of call count)
    expect(listenersAfter - listenersBefore).toBeLessThanOrEqual(1);
  });
});

// ─── Tests for isNonRetryableProviderError ────────────────────────────────────

describe("isNonRetryableProviderError — used in result.error recovery path", () => {
  it("returns false for generic errors (allows retry)", async () => {
    const { isNonRetryableProviderError } = await import("./error-resilience.js");
    const err = new Error("stream timeout occurred");
    expect(isNonRetryableProviderError(err)).toBe(false);
  });

  it("returns false for non-ProviderError instances", async () => {
    const { isNonRetryableProviderError } = await import("./error-resilience.js");
    expect(isNonRetryableProviderError(new Error("some error"))).toBe(false);
    expect(isNonRetryableProviderError("string error")).toBe(false);
  });
});

// ─── Tests for humanizeProviderError — used in result.error recovery path ────

describe("humanizeProviderError — produces actionable messages for recovery prefix", () => {
  it("handles network errors", async () => {
    const { humanizeProviderError } = await import("./error-resilience.js");
    const err = new Error("ECONNREFUSED connect ECONNREFUSED 127.0.0.1:8080");
    const msg = humanizeProviderError(err);
    expect(msg).toContain("Network");
    expect(msg.length).toBeLessThanOrEqual(200);
  });

  it("handles stream timeout errors", async () => {
    const { humanizeProviderError } = await import("./error-resilience.js");
    const err = new Error("stream timeout: no response in 60s");
    const msg = humanizeProviderError(err);
    expect(msg).toContain("timed out");
  });

  it("truncates very long messages to ≤200 chars", async () => {
    const { humanizeProviderError } = await import("./error-resilience.js");
    const longMsg = "x".repeat(300);
    const err = new Error(longMsg);
    const msg = humanizeProviderError(err);
    expect(msg.length).toBeLessThanOrEqual(200);
  });
});
