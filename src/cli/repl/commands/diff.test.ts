/**
 * Tests for /diff command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { diffCommand, executeDiffCommand, getDiffHelp, getQuickDiffSummary } from "./diff.js";
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
    gray: (s: string) => s,
    white: (s: string) => s,
    magenta: { bold: (s: string) => s },
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
        ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100, showDiff: "on_request" },
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
      expect(diffCommand.usage).toBe("/diff [--summary|--staged|--unstaged|--all|--no-generated]");
    });
  });

  describe("executeDiffCommand", () => {
    it("should show no changes message when there are no changes", async () => {
      const { execSync } = await import("node:child_process");
      // git diff --quiet throws when there are changes
      vi.mocked(execSync).mockImplementation(() => {
        return "";
      });

      const result = await executeDiffCommand(mockSession, []);

      expect(result).toContain("No uncommitted changes");
    });

    it("should show diff summary when there are changes", async () => {
      const { execSync } = await import("node:child_process");
      let callCount = 0;
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        callCount++;
        if (cmd.includes("--quiet")) {
          // Throw to indicate there are changes
          throw new Error("changes exist");
        }
        if (cmd.includes("--numstat")) {
          return "10\t5\tfile.ts\n";
        }
        return "";
      });

      const result = await executeDiffCommand(mockSession, []);

      expect(result).toContain("Changed files");
      expect(result).toContain("file.ts");
    });

    it("should show staged changes only with --staged flag", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("--quiet")) {
          throw new Error("changes exist");
        }
        if (cmd.includes("--cached") && cmd.includes("--numstat")) {
          return "5\t2\tstaged.ts\n";
        }
        return "";
      });

      const result = await executeDiffCommand(mockSession, ["--staged"]);

      expect(result).toContain("Changed files");
      expect(result).toContain("staged.ts");
    });

    it("should accept -c shorthand for --staged", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("--quiet")) {
          throw new Error("changes exist");
        }
        if (cmd.includes("--cached") && cmd.includes("--numstat")) {
          return "3\t1\tfile.ts\n";
        }
        return "";
      });

      const result = await executeDiffCommand(mockSession, ["-c"]);

      expect(result).toContain("Changed files");
    });

    it("should show summary only with --summary flag", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("--quiet")) {
          throw new Error("changes exist");
        }
        if (cmd.includes("--numstat")) {
          return "10\t5\tfile.ts\n";
        }
        return "";
      });

      const result = await executeDiffCommand(mockSession, ["--summary"]);

      expect(result).toContain("Changed files");
      expect(result).toContain("file.ts");
      expect(result).not.toContain("Detailed changes");
    });

    it("should filter auto-generated files with --no-generated flag", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("--quiet")) {
          throw new Error("changes exist");
        }
        if (cmd.includes("--numstat")) {
          return "10\t5\tpackage-lock.json\n5\t2\tfile.ts\n";
        }
        return "";
      });

      const result = await executeDiffCommand(mockSession, ["--no-generated"]);

      expect(result).toContain("file.ts");
      expect(result).not.toContain("package-lock.json");
    });

    it("should handle git errors gracefully", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not a git repository");
      });

      const result = await executeDiffCommand(mockSession, []);

      expect(result).toContain("No changes");
    });
  });

  describe("diffCommand.execute", () => {
    it("should return false (do not exit)", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        return "";
      });

      const result = await diffCommand.execute([], mockSession);

      expect(result).toBe(false);
    });

    it("should log output to console", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        return "";
      });

      await diffCommand.execute([], mockSession);

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe("getDiffHelp", () => {
    it("should return help text", () => {
      const help = getDiffHelp();

      expect(help).toContain("/diff");
      expect(help).toContain("--summary");
      expect(help).toContain("--staged");
      expect(help).toContain("--all");
    });
  });

  describe("getQuickDiffSummary", () => {
    it("should return empty string when no changes", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        return "";
      });

      const result = getQuickDiffSummary("/test/project");

      expect(result).toBe("");
    });

    it("should return summary when there are changes", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("--quiet")) {
          throw new Error("changes exist");
        }
        if (cmd.includes("--numstat")) {
          return "5\t3\tfile.ts\n";
        }
        return "";
      });

      const result = getQuickDiffSummary("/test/project");

      expect(result).toContain("1 files");
      expect(result).toContain("+5/-3");
    });
  });
});
