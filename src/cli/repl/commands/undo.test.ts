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
  execSync: vi.fn(),
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
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      await undoCommand.execute(["--last-commit"], mockSession);

      expect(execSync).toHaveBeenCalledWith(
        "git reset --soft HEAD~1",
        expect.objectContaining({ cwd: "/test/project" })
      );
    });

    it("should show success message", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      await undoCommand.execute(["--last-commit"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Last commit undone");
      expect(allOutput).toContain("preserved");
    });

    it("should return false", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      const result = await undoCommand.execute(["--last-commit"], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("execute with file argument", () => {
    it("should checkout specific file", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      await undoCommand.execute(["src/file.ts"], mockSession);

      expect(execSync).toHaveBeenCalledWith(
        'git checkout -- "src/file.ts"',
        expect.any(Object)
      );
    });

    it("should handle file paths with spaces", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      await undoCommand.execute(["path", "with", "spaces.ts"], mockSession);

      expect(execSync).toHaveBeenCalledWith(
        'git checkout -- "path with spaces.ts"',
        expect.any(Object)
      );
    });

    it("should show success message with filename", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      await undoCommand.execute(["file.ts"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Restored");
      expect(allOutput).toContain("file.ts");
    });
  });

  describe("execute with no arguments", () => {
    it("should show usage help", async () => {
      await undoCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Usage");
      expect(allOutput).toContain("/undo <file>");
      expect(allOutput).toContain("--last-commit");
    });

    it("should show warning about discarding changes", async () => {
      await undoCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Warning");
      expect(allOutput).toContain("discards");
    });

    it("should return false", async () => {
      const result = await undoCommand.execute([], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should handle git errors", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("pathspec 'file.ts' did not match any file(s)");
      });

      await undoCommand.execute(["file.ts"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("failed");
    });

    it("should return false on error", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("error");
      });

      const result = await undoCommand.execute(["--last-commit"], mockSession);
      expect(result).toBe(false);
    });
  });
});
