/**
 * Tests for /diff command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { diffCommand } from "./diff.js";
import type { ReplSession } from "../types.js";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => s,
    cyan: { bold: (s: string) => s },
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    bold: (s: string) => s,
  },
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("diffCommand", () => {
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
      expect(diffCommand.name).toBe("diff");
    });

    it("should have d alias", () => {
      expect(diffCommand.aliases).toContain("d");
    });

    it("should have description", () => {
      expect(diffCommand.description).toContain("diff");
    });

    it("should have usage", () => {
      expect(diffCommand.usage).toBe("/diff [--staged]");
    });
  });

  describe("execute with unstaged changes", () => {
    it("should show unstaged diff", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue(
        "diff --git a/file.ts b/file.ts\nindex abc..def 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+added line\n existing line\n-removed line"
      );

      await diffCommand.execute([], mockSession);

      expect(execSync).toHaveBeenCalledWith("git diff", expect.objectContaining({
        cwd: "/test/project",
      }));
      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Unstaged");
    });

    it("should show no changes message when diff is empty", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      await diffCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("No unstaged changes");
    });

    it("should return false (do not exit)", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      const result = await diffCommand.execute([], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("execute with --staged flag", () => {
    it("should show staged diff", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue(
        "diff --git a/file.ts b/file.ts\n+staged line"
      );

      await diffCommand.execute(["--staged"], mockSession);

      expect(execSync).toHaveBeenCalledWith("git diff --staged", expect.any(Object));
      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Staged");
    });

    it("should accept -s shorthand", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("diff output");

      await diffCommand.execute(["-s"], mockSession);

      expect(execSync).toHaveBeenCalledWith("git diff --staged", expect.any(Object));
    });

    it("should show no staged changes message", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      await diffCommand.execute(["--staged"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("No staged changes");
    });
  });

  describe("diff output formatting", () => {
    it("should truncate long diff output", async () => {
      const { execSync } = await import("node:child_process");
      const longDiff = Array(150).fill("line").join("\n");
      vi.mocked(execSync).mockReturnValue(longDiff);

      await diffCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("more lines");
    });
  });

  describe("error handling", () => {
    it("should handle non-git repository", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not a git repository");
      });

      await diffCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Not a git repository");
    });

    it("should return false on error", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("error");
      });

      const result = await diffCommand.execute([], mockSession);
      expect(result).toBe(false);
    });
  });
});
