/**
 * Tests for /commit command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { commitCommand } from "./commit.js";
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

// Mock readline
vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_prompt: string, callback: (answer: string) => void) => {
      callback("test commit message");
    }),
    close: vi.fn(),
  })),
}));

describe("commitCommand", () => {
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
      expect(commitCommand.name).toBe("commit");
    });

    it("should have ci alias", () => {
      expect(commitCommand.aliases).toContain("ci");
    });

    it("should have description", () => {
      expect(commitCommand.description).toContain("Commit");
    });

    it("should have usage", () => {
      expect(commitCommand.usage).toBe("/commit [message]");
    });
  });

  describe("execute with no staged changes", () => {
    it("should show message when no staged changes", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      await commitCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("No staged changes");
    });

    it("should return false", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("");

      const result = await commitCommand.execute([], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("execute with staged changes and message argument", () => {
    it("should commit with provided message", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync)
        .mockReturnValueOnce("file1.ts\nfile2.ts") // git diff --staged --name-only
        .mockReturnValueOnce(""); // git commit

      await commitCommand.execute(["fix:", "bug"], mockSession);

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git commit -m "fix: bug"'),
        expect.any(Object)
      );
    });

    it("should show files to be committed", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync)
        .mockReturnValueOnce("file1.ts\nfile2.ts")
        .mockReturnValueOnce("");

      await commitCommand.execute(["test message"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("file1.ts");
      expect(allOutput).toContain("file2.ts");
    });

    it("should show success message", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync)
        .mockReturnValueOnce("file.ts")
        .mockReturnValueOnce("");

      await commitCommand.execute(["my message"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Committed");
      expect(allOutput).toContain("my message");
    });
  });

  describe("execute with staged changes and no message (prompt)", () => {
    it("should prompt for message when none provided", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync)
        .mockReturnValueOnce("file.ts")
        .mockReturnValueOnce("");

      await commitCommand.execute([], mockSession);

      // Should have called git commit with prompted message
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("test commit message"),
        expect.any(Object)
      );
    });

    it("should cancel when prompt is empty", async () => {
      const { execSync } = await import("node:child_process");
      const readline = await import("node:readline");

      vi.mocked(execSync).mockReturnValueOnce("file.ts");
      vi.mocked(readline.createInterface).mockReturnValue({
        question: vi.fn((_prompt: string, callback: (answer: string) => void) => {
          callback(""); // Empty response
        }),
        close: vi.fn(),
      } as any);

      await commitCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("cancelled");
    });
  });

  describe("error handling", () => {
    it("should handle git errors", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync)
        .mockReturnValueOnce("file.ts")
        .mockImplementationOnce(() => {
          throw new Error("pre-commit hook failed");
        });

      await commitCommand.execute(["message"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("failed");
    });

    it("should escape quotes in commit message", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync)
        .mockReturnValueOnce("file.ts")
        .mockReturnValueOnce("");

      await commitCommand.execute(['fix: handle "quotes"'], mockSession);

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('\\"quotes\\"'),
        expect.any(Object)
      );
    });

    it("should return false on error", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("error");
      });

      const result = await commitCommand.execute([], mockSession);
      expect(result).toBe(false);
    });
  });
});
