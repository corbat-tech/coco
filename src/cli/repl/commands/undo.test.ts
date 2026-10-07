/**
 * Tests for /undo command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { undoCommand } from "./undo.js";
import type { ReplSession } from "../types.js";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => s,
    cyan: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("undoCommand", () => {
  let mockSession: ReplSession;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSession = {
      id: "test-session",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      config: {
        provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
        ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100 },
        agent: { systemPrompt: "test", maxToolIterations: 25, confirmDestructive: true },
      },
      trustedTools: new Set(),
    };
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("metadata", () => {
    it("should have correct name", () => {
      expect(undoCommand.name).toBe("undo");
    });

    it("should have empty aliases", () => {
      expect(undoCommand.aliases).toEqual([]);
    });

    it("should have description", () => {
      expect(undoCommand.description).toContain("Undo");
    });

    it("should have usage", () => {
      expect(undoCommand.usage).toContain("--last-commit");
    });
  });

  describe("execute with --last-commit flag", () => {
    it("should soft reset last commit", async () => {
      const { execFileSync } = await import("node:child_process");
      vi.mocked(execFileSync).mockReturnValue("");

      await undoCommand.execute(["--last-commit"], mockSession);

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["reset", "--soft", "HEAD~1"],
        expect.objectContaining({ cwd: "/test/project" }),
      );
    });

    it("should show success message", async () => {
      const { execFileSync } = await import("node:child_process");
      vi.mocked(execFileSync).mockReturnValue("");

      await undoCommand.execute(["--last-commit"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Last local commit undone");
      expect(allOutput).toContain("preserved");
    });

    it("should return false", async () => {
      const { execFileSync } = await import("node:child_process");
      vi.mocked(execFileSync).mockReturnValue("");

      const result = await undoCommand.execute(["--last-commit"], mockSession);
      expect(result).toBe(false);
    });
  });

  it.each([["src/file.ts"], ["path", "with", "spaces.ts"], ["--last-commit", "file.ts"], []])(
    "does not restore unverified file changes for %j",
    async (...args) => {
      const { execFileSync } = await import("node:child_process");
      const result = await undoCommand.execute(args as string[], mockSession);
      expect(execFileSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(output).toContain("unavailable");
      expect(output).toContain("No files were changed");
      expect(result).toBe(false);
    },
  );

  describe("error handling", () => {
    it("should handle git errors", async () => {
      const { execFileSync } = await import("node:child_process");
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("pathspec 'file.ts' did not match any file(s)");
      });

      await undoCommand.execute(["--last-commit"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("failed");
    });

    it("should return false on error", async () => {
      const { execFileSync } = await import("node:child_process");
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("error");
      });

      const result = await undoCommand.execute(["--last-commit"], mockSession);
      expect(result).toBe(false);
    });
  });
});
