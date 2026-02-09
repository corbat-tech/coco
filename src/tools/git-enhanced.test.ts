/**
 * Tests for git-enhanced tool
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { analyzeRepoHealth, getCommitStats } from "./git-enhanced.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Mock the registry
vi.mock("./registry.js", () => ({
  defineTool: (def: unknown) => def,
}));

const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;

describe("git-enhanced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("analyzeRepoHealth", () => {
    it("should return perfect score when no issues found", () => {
      // git status --porcelain returns empty (called twice in the source)
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "git status --porcelain") return "";
        if (cmd === "git ls-files --others --exclude-standard") return "";
        if (cmd === "git rev-parse --abbrev-ref HEAD") return "main";
        if (cmd === "git rev-parse HEAD") return "abc123";
        if (cmd === "git rev-parse origin/main") return "abc123";
        if (cmd === "git ls-files") return "file1.ts\nfile2.ts";
        if (cmd === "git diff --name-only --diff-filter=U") return "";
        return "";
      });

      const result = analyzeRepoHealth();

      expect(result.score).toBe(100);
      expect(result.issues).toEqual([]);
    });

    it("should detect uncommitted changes and deduct 10 points", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "git status --porcelain") return "M src/index.ts";
        if (cmd === "git ls-files --others --exclude-standard") return "";
        if (cmd === "git rev-parse --abbrev-ref HEAD") return "main";
        if (cmd === "git rev-parse HEAD") return "abc123";
        if (cmd === "git rev-parse origin/main") return "abc123";
        if (cmd === "git ls-files") return "file1.ts";
        if (cmd === "git diff --name-only --diff-filter=U") return "";
        return "";
      });

      const result = analyzeRepoHealth();

      expect(result.score).toBe(90);
      expect(result.issues).toContain("Uncommitted changes present");
    });

    it("should detect untracked files and deduct 5 points", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "git status --porcelain") return "";
        if (cmd === "git ls-files --others --exclude-standard") return "new-file.ts";
        if (cmd === "git rev-parse --abbrev-ref HEAD") return "main";
        if (cmd === "git rev-parse HEAD") return "abc123";
        if (cmd === "git rev-parse origin/main") return "abc123";
        if (cmd === "git ls-files") return "file1.ts";
        if (cmd === "git diff --name-only --diff-filter=U") return "";
        return "";
      });

      const result = analyzeRepoHealth();

      expect(result.score).toBe(95);
      expect(result.issues).toContain("1 untracked files");
      expect(result.recommendations).toContain("Add files to .gitignore or commit them");
    });

    it("should detect branch not up-to-date with remote and deduct 15 points", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "git status --porcelain") return "";
        if (cmd === "git ls-files --others --exclude-standard") return "";
        if (cmd === "git rev-parse --abbrev-ref HEAD") return "main";
        if (cmd === "git rev-parse HEAD") return "abc123";
        if (cmd === "git rev-parse origin/main") return "def456";
        if (cmd === "git ls-files") return "file1.ts";
        if (cmd === "git diff --name-only --diff-filter=U") return "";
        return "";
      });

      const result = analyzeRepoHealth();

      expect(result.score).toBe(85);
      expect(result.issues).toContain("Branch is not up-to-date with remote");
      expect(result.recommendations).toContain("Pull latest changes from remote");
    });

    it("should detect merge conflicts and deduct 30 points", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "git status --porcelain") return "";
        if (cmd === "git ls-files --others --exclude-standard") return "";
        if (cmd === "git rev-parse --abbrev-ref HEAD") return "main";
        if (cmd === "git rev-parse HEAD") return "abc123";
        if (cmd === "git rev-parse origin/main") return "abc123";
        if (cmd === "git ls-files") return "file1.ts";
        if (cmd === "git diff --name-only --diff-filter=U") return "conflicted-file.ts";
        return "";
      });

      const result = analyzeRepoHealth();

      expect(result.score).toBe(70);
      expect(result.issues).toContain("Merge conflicts present");
      expect(result.recommendations).toContain("Resolve merge conflicts before proceeding");
    });

    it("should recommend .gitignore for large repos (>1000 files)", () => {
      const manyFiles = Array.from({ length: 1001 }, (_, i) => `file${i}.ts`).join("\n");
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "git status --porcelain") return "";
        if (cmd === "git ls-files --others --exclude-standard") return "";
        if (cmd === "git rev-parse --abbrev-ref HEAD") return "main";
        if (cmd === "git rev-parse HEAD") return "abc123";
        if (cmd === "git rev-parse origin/main") return "abc123";
        if (cmd === "git ls-files") return manyFiles;
        if (cmd === "git diff --name-only --diff-filter=U") return "";
        return "";
      });

      const result = analyzeRepoHealth();

      expect(result.recommendations).toContain(
        "Repository has many files, consider using .gitignore",
      );
    });

    it("should gracefully handle all commands failing individually", () => {
      // When all inner commands fail, each is caught by its own try/catch
      // The outer catch only fires for unexpected errors outside inner try/catches
      mockExecSync.mockImplementation(() => {
        throw new Error("Not a git repository");
      });

      const result = analyzeRepoHealth();

      // Since each inner check catches its own error, score stays at 100
      // and no issues are added (each catch is a no-op)
      expect(result.score).toBe(100);
      expect(result.issues).toEqual([]);
    });

    it("should handle graceful failure of individual checks", () => {
      // First call succeeds, subsequent calls fail
      let callCount = 0;
      mockExecSync.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) return ""; // git status --porcelain (called twice)
        throw new Error("Command failed");
      });

      const result = analyzeRepoHealth();

      // Score should still be 100 because individual check failures are caught
      expect(result.score).toBe(100);
    });

    it("should accumulate multiple deductions", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "git status --porcelain") return "M file.ts"; // -10
        if (cmd === "git ls-files --others --exclude-standard") return "new.ts"; // -5
        if (cmd === "git rev-parse --abbrev-ref HEAD") return "main";
        if (cmd === "git rev-parse HEAD") return "abc123";
        if (cmd === "git rev-parse origin/main") return "def456"; // -15
        if (cmd === "git ls-files") return "file1.ts";
        if (cmd === "git diff --name-only --diff-filter=U") return ""; // no conflict
        return "";
      });

      const result = analyzeRepoHealth();

      // 100 - 10 - 5 - 15 = 70
      expect(result.score).toBe(70);
      expect(result.issues.length).toBe(3);
    });
  });

  describe("getCommitStats", () => {
    it("should return commit count, authors, and recent activity", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "git rev-list --count HEAD") return "42";
        if (cmd.includes("sort")) return "Alice\nBob\nCharlie";
        if (cmd.includes("git log -1")) return "2 hours ago";
        return "";
      });

      const result = getCommitStats();

      expect(result.totalCommits).toBe(42);
      expect(result.authors).toEqual(["Alice", "Bob", "Charlie"]);
      expect(result.recentActivity).toBe("2 hours ago");
    });

    it("should return defaults when git commands fail", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Not a git repo");
      });

      const result = getCommitStats();

      expect(result.totalCommits).toBe(0);
      expect(result.authors).toEqual([]);
      expect(result.recentActivity).toBe("unknown");
    });

    it("should parse single-digit commit count", () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "git rev-list --count HEAD") return "1";
        if (cmd.includes("git log --format")) {
          if (cmd.includes("sort")) return "Dev";
          return "just now";
        }
        return "";
      });

      const result = getCommitStats();

      expect(result.totalCommits).toBe(1);
      expect(result.authors).toEqual(["Dev"]);
    });
  });

  describe("recommendBranchTool", () => {
    it("should recommend feature prefix for generic tasks", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Branch not found");
      });

      // Import the tool definition
      const { recommendBranchTool } = await import("./git-enhanced.js");
      const result = await recommendBranchTool.execute({ task: "Add user authentication" });

      expect(result.prefix).toBe("feature");
      expect(result.recommendedBranch).toContain("feature/");
      expect(result.exists).toBe(false);
    });

    it("should recommend fix prefix for bug tasks", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Branch not found");
      });

      const { recommendBranchTool } = await import("./git-enhanced.js");
      const result = await recommendBranchTool.execute({ task: "Fix login bug" });

      expect(result.prefix).toBe("fix");
      expect(result.recommendedBranch).toContain("fix/");
    });

    it("should recommend refactor prefix for refactoring tasks", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Branch not found");
      });

      const { recommendBranchTool } = await import("./git-enhanced.js");
      const result = await recommendBranchTool.execute({ task: "Refactor payment module" });

      expect(result.prefix).toBe("refactor");
    });

    it("should recommend docs prefix for documentation tasks", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Branch not found");
      });

      const { recommendBranchTool } = await import("./git-enhanced.js");
      const result = await recommendBranchTool.execute({ task: "Update docs for API" });

      expect(result.prefix).toBe("docs");
    });

    it("should recommend test prefix for test tasks", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Branch not found");
      });

      const { recommendBranchTool } = await import("./git-enhanced.js");
      const result = await recommendBranchTool.execute({ task: "Add unit test for parser" });

      expect(result.prefix).toBe("test");
    });

    it("should recommend chore prefix for chore tasks", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Branch not found");
      });

      const { recommendBranchTool } = await import("./git-enhanced.js");
      const result = await recommendBranchTool.execute({ task: "Chore: update dependencies" });

      expect(result.prefix).toBe("chore");
    });

    it("should detect when branch already exists", async () => {
      mockExecSync.mockImplementation(() => {
        // Does not throw = branch exists
        return "";
      });

      const { recommendBranchTool } = await import("./git-enhanced.js");
      const result = await recommendBranchTool.execute({ task: "Add feature" });

      expect(result.exists).toBe(true);
      expect(result.warning).toBe("Branch already exists, consider a different name");
    });

    it("should slugify the task description", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Branch not found");
      });

      const { recommendBranchTool } = await import("./git-enhanced.js");
      const result = await recommendBranchTool.execute({
        task: "Add User Authentication!!! @#$%",
      });

      expect(result.recommendedBranch).toMatch(/^feature\/[a-z0-9-]+$/);
      expect(result.recommendedBranch).not.toContain(" ");
      expect(result.recommendedBranch).not.toContain("!");
    });

    it("should truncate long task names to 40 chars in slug", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("Branch not found");
      });

      const { recommendBranchTool } = await import("./git-enhanced.js");
      const result = await recommendBranchTool.execute({
        task: "Implement a very long feature description that goes on and on and on",
      });

      const slug = result.recommendedBranch.replace("feature/", "");
      expect(slug.length).toBeLessThanOrEqual(40);
    });
  });
});
