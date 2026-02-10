/**
 * Simple Git Auto-Commit
 *
 * Simplified git automation without complex bash tool integration
 */

import { z } from "zod";
import { defineTool } from "./registry.js";
import { execSync } from "node:child_process";

/**
 * Generate simple commit message from git diff
 */
function generateSimpleCommitMessage(): string {
  const cwd = process.cwd();
  try {
    const diff = execSync("git diff --cached --name-only", {
      encoding: "utf-8",
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });

    const files = diff.trim().split("\n").filter(Boolean);

    if (files.length === 0) return "chore: update files";

    // Detect type
    let type = "chore";
    if (files.some((f) => f.includes("test") || f.includes(".test."))) {
      type = "test";
    } else if (files.some((f) => f.endsWith(".md"))) {
      type = "docs";
    } else if (files.some((f) => f.startsWith("src/"))) {
      type = "feat";
    }

    // Detect scope
    let scope = "";
    const srcFiles = files.filter((f) => f.startsWith("src/"));
    if (srcFiles.length > 0 && srcFiles[0]) {
      const match = srcFiles[0].match(/src\/([^/]+)\//);
      if (match && match[1]) {
        scope = match[1];
      }
    }

    const scopeStr = scope ? `(${scope})` : "";
    return `${type}${scopeStr}: update code`;
  } catch {
    return "chore: update files";
  }
}

/**
 * Check if on protected branch
 */
export const checkProtectedBranchTool = defineTool({
  name: "checkProtectedBranch",
  description: "Check if current branch is protected (main/master)",
  category: "git" as const,
  parameters: z.object({}),

  async execute() {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf-8",
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();

      const protected_branches = ["main", "master", "develop", "production"];
      const isProtected = protected_branches.includes(branch);

      return {
        stdout: JSON.stringify({
          branch,
          isProtected,
          warning: isProtected
            ? `⚠️  On protected branch '${branch}'. Consider creating a feature branch.`
            : `✓ Safe to commit on '${branch}'`,
        }),
        stderr: "",
        exitCode: 0,
        duration: 0,
      };
    } catch {
      return {
        stdout: "",
        stderr: "Failed to check branch",
        exitCode: 1,
        duration: 0,
      };
    }
  },
});

/**
 * Simple auto-commit tool
 */
const SimpleAutoCommitSchema = z.object({
  message: z.string().optional(),
});

export const simpleAutoCommitTool = defineTool({
  name: "simpleAutoCommit",
  description: "Auto-commit staged changes with generated message",
  category: "git" as const,
  parameters: SimpleAutoCommitSchema,

  async execute(input: { message?: string }) {
    try {
      // Check if there are staged changes
      try {
        execSync("git diff --cached --quiet", { cwd: process.cwd(), stdio: "ignore" });
        return {
          stdout: "",
          stderr: "No staged changes to commit",
          exitCode: 1,
          duration: 0,
        };
      } catch {
        // Has changes (diff --quiet returns non-zero if there are changes)
      }

      // Generate or use provided message
      const message = (input.message as string | undefined) || generateSimpleCommitMessage();

      // Commit
      execSync(`git commit -m "${message}"`, {
        encoding: "utf-8",
        cwd: process.cwd(),
        stdio: "pipe",
      });

      return {
        stdout: `✓ Committed: ${message}`,
        stderr: "",
        exitCode: 0,
        duration: 0,
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : "Commit failed",
        exitCode: 1,
        duration: 0,
      };
    }
  },
});

export const gitSimpleTools = [checkProtectedBranchTool, simpleAutoCommitTool];
