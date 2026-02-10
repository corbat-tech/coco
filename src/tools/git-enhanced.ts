/**
 * Enhanced Git Tools
 * Advanced git operations with intelligence
 */

import { defineTool } from "./registry.js";
import { z } from "zod";
import { execSync } from "node:child_process";

/** Shorthand for execSync with explicit cwd to avoid issues on global npm installs */
function gitExec(cmd: string, opts: Record<string, unknown> = {}): string {
  return execSync(cmd, { encoding: "utf-8", cwd: process.cwd(), ...opts }) as string;
}

/**
 * Analyze git repository health
 */
export function analyzeRepoHealth(): {
  score: number;
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  try {
    // Check for uncommitted changes
    try {
      gitExec("git status --porcelain", { stdio: "pipe" });
      const status = gitExec("git status --porcelain");
      if (status.trim()) {
        issues.push("Uncommitted changes present");
        score -= 10;
      }
    } catch {
      // No changes
    }

    // Check for untracked files
    try {
      const untracked = gitExec("git ls-files --others --exclude-standard");
      if (untracked.trim()) {
        const count = untracked.trim().split("\n").length;
        issues.push(`${count} untracked files`);
        score -= 5;
        recommendations.push("Add files to .gitignore or commit them");
      }
    } catch {
      // No untracked
    }

    // Check if behind remote
    try {
      const branch = gitExec("git rev-parse --abbrev-ref HEAD").trim();
      const local = gitExec("git rev-parse HEAD").trim();
      const remote = gitExec(`git rev-parse origin/${branch}`).trim();

      if (local !== remote) {
        issues.push("Branch is not up-to-date with remote");
        score -= 15;
        recommendations.push("Pull latest changes from remote");
      }
    } catch {
      // No remote or not tracked
    }

    // Check for large files
    try {
      const files = gitExec("git ls-files").trim().split("\n");
      // Sample check (full check would be expensive)
      if (files.length > 1000) {
        recommendations.push("Repository has many files, consider using .gitignore");
      }
    } catch {
      // Can't check
    }

    // Check for merge conflicts
    try {
      const conflicts = gitExec("git diff --name-only --diff-filter=U");
      if (conflicts.trim()) {
        issues.push("Merge conflicts present");
        score -= 30;
        recommendations.push("Resolve merge conflicts before proceeding");
      }
    } catch {
      // No conflicts
    }
  } catch {
    issues.push("Failed to analyze repository");
    score = 0;
  }

  return { score, issues, recommendations };
}

/**
 * Get commit statistics
 */
export function getCommitStats(): {
  totalCommits: number;
  authors: string[];
  recentActivity: string;
} {
  try {
    const count = gitExec("git rev-list --count HEAD").trim();
    const authors = gitExec('git log --format="%an" | sort -u', {
      shell: "/bin/bash",
    })
      .trim()
      .split("\n");

    const lastCommit = gitExec('git log -1 --format="%cr"').trim();

    return {
      totalCommits: parseInt(count, 10),
      authors,
      recentActivity: lastCommit,
    };
  } catch {
    return {
      totalCommits: 0,
      authors: [],
      recentActivity: "unknown",
    };
  }
}

/**
 * Tool: Analyze repository health
 */
export const analyzeRepoHealthTool = defineTool({
  name: "analyzeRepoHealth",
  description: "Analyze git repository health and get recommendations",
  category: "git" as const,
  parameters: z.object({}),

  async execute() {
    const health = analyzeRepoHealth();

    return {
      score: health.score,
      grade: health.score >= 90 ? "A" : health.score >= 70 ? "B" : health.score >= 50 ? "C" : "D",
      issues: health.issues,
      recommendations: health.recommendations,
      message:
        health.score >= 90
          ? "Repository is in excellent health"
          : health.score >= 70
            ? "Repository is in good health with minor issues"
            : "Repository needs attention",
    };
  },
});

/**
 * Tool: Get commit statistics
 */
export const getCommitStatsTool = defineTool({
  name: "getCommitStats",
  description: "Get commit statistics and repository activity",
  category: "git" as const,
  parameters: z.object({}),

  async execute() {
    const stats = getCommitStats();

    return {
      totalCommits: stats.totalCommits,
      authorCount: stats.authors.length,
      authors: stats.authors.slice(0, 10), // Top 10
      recentActivity: stats.recentActivity,
      active: stats.totalCommits > 0,
    };
  },
});

/**
 * Tool: Smart branch recommendation
 */
export const recommendBranchTool = defineTool({
  name: "recommendBranch",
  description: "Recommend a branch name based on task description",
  category: "git" as const,
  parameters: z.object({
    task: z.string().describe("Task description"),
  }),

  async execute(input) {
    const { task } = input as { task: string };

    // Parse task to determine type
    const taskLower = task.toLowerCase();

    let prefix = "feature";
    if (taskLower.includes("fix") || taskLower.includes("bug")) {
      prefix = "fix";
    } else if (taskLower.includes("refactor")) {
      prefix = "refactor";
    } else if (taskLower.includes("docs") || taskLower.includes("documentation")) {
      prefix = "docs";
    } else if (taskLower.includes("test")) {
      prefix = "test";
    } else if (taskLower.includes("chore")) {
      prefix = "chore";
    }

    // Create slug from task
    const slug = task
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 40);

    const branchName = `${prefix}/${slug}`;

    // Check if branch exists
    let exists = false;
    try {
      execSync(`git rev-parse --verify ${branchName}`, { cwd: process.cwd(), stdio: "ignore" });
      exists = true;
    } catch {
      exists = false;
    }

    return {
      recommendedBranch: branchName,
      prefix,
      exists,
      command: `git checkout -b ${branchName}`,
      warning: exists ? "Branch already exists, consider a different name" : undefined,
    };
  },
});

export const gitEnhancedTools = [analyzeRepoHealthTool, getCommitStatsTool, recommendBranchTool];
