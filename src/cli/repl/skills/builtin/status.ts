/**
 * Status Skill
 *
 * Shows session information including project path, provider, and context usage.
 */

import chalk from "chalk";
import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import type { Skill, SkillContext, SkillResult } from "../types.js";
import {
  getStateManager,
  formatStateStatus,
  getStateSummary,
} from "../../state/index.js";
import { createTrustStore } from "../../trust-store.js";
import { getContextUsageFormatted } from "../../session.js";

/**
 * Get git status information
 */
function getGitStatus(projectPath: string): {
  isRepo: boolean;
  branch: string;
  modified: number;
  staged: number;
  untracked: number;
  ahead: number;
  behind: number;
} {
  try {
    // Check if git repo
    execSync("git rev-parse --git-dir", { cwd: projectPath, stdio: "pipe" });

    const branch = execSync("git branch --show-current", {
      cwd: projectPath,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();

    const status = execSync("git status --porcelain", {
      cwd: projectPath,
      stdio: "pipe",
      encoding: "utf-8",
    });

    const lines = status.split("\n").filter(Boolean);

    let modified = 0;
    let staged = 0;
    let untracked = 0;

    for (const line of lines) {
      const stagedFlag = line[0];
      const unstagedFlag = line[1];

      if (stagedFlag !== " " && stagedFlag !== "?") {
        staged++;
      }
      if (unstagedFlag === "M" || unstagedFlag === "D") {
        modified++;
      }
      if (stagedFlag === "?") {
        untracked++;
      }
    }

    // Get ahead/behind
    let ahead = 0;
    let behind = 0;
    try {
      const upstream = execSync(
        "git rev-list --left-right --count HEAD...@{upstream}",
        {
          cwd: projectPath,
          stdio: "pipe",
          encoding: "utf-8",
        }
      ).trim();
      const [a, b] = upstream.split("\t").map(Number);
      ahead = a || 0;
      behind = b || 0;
    } catch {
      // No upstream
    }

    return {
      isRepo: true,
      branch,
      modified,
      staged,
      untracked,
      ahead,
      behind,
    };
  } catch {
    return {
      isRepo: false,
      branch: "",
      modified: 0,
      staged: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
    };
  }
}

/**
 * Status skill for showing session information
 */
export const statusSkill: Skill = {
  name: "status",
  description: "Show project and session status",
  usage: "/status",
  aliases: ["s", "st"],
  category: "general",

  async execute(_args: string, context: SkillContext): Promise<SkillResult> {
    const lines: string[] = [];

    p.intro("Project Status");

    const stateManager = getStateManager();
    const trustStore = createTrustStore();
    await trustStore.init();

    // Load project state
    const state = await stateManager.load(context.session.projectPath);
    const summary = getStateSummary(state);

    // COCO Status
    p.log.message("");
    p.log.step("COCO Phase");
    p.log.message(`  ${formatStateStatus(state)}`);

    // Phase indicators
    p.log.message("");
    p.log.message(chalk.dim("  Progress:"));
    p.log.message(`    ${summary.spec ? "ok" : "--"} Specification`);
    p.log.message(`    ${summary.architecture ? "ok" : "--"} Architecture`);
    p.log.message(`    ${summary.implementation ? "ok" : "--"} Implementation`);

    // Suggestion
    const suggestion = await stateManager.getSuggestion(
      context.session.projectPath
    );
    p.log.message("");
    p.log.info(`Tip: ${suggestion}`);

    // Trust status
    p.log.message("");
    p.log.step("Trust");
    const trustLevel = trustStore.getLevel(context.session.projectPath);
    if (trustLevel) {
      const levelStr =
        trustLevel === "full"
          ? "full"
          : trustLevel === "write"
            ? "write"
            : "read";
      p.log.message(`  [${levelStr}] access`);
    } else {
      p.log.message(`  [!] Not trusted`);
    }

    // Git status
    p.log.message("");
    p.log.step("Git");
    const git = getGitStatus(context.session.projectPath);

    if (!git.isRepo) {
      p.log.message("  [x] Not a git repository");
    } else {
      p.log.message(`  Branch: ${git.branch}`);

      if (git.ahead > 0 || git.behind > 0) {
        p.log.message(`  Sync: ${git.ahead} ahead, ${git.behind} behind`);
      }

      if (git.staged > 0 || git.modified > 0 || git.untracked > 0) {
        p.log.message("");
        if (git.staged > 0) {
          p.log.message(`  Staged: ${git.staged}`);
        }
        if (git.modified > 0) {
          p.log.message(`  Modified: ${git.modified}`);
        }
        if (git.untracked > 0) {
          p.log.message(`  Untracked: ${git.untracked}`);
        }
      } else {
        p.log.message("  Working directory clean");
      }
    }

    // Session info
    p.log.message("");
    p.log.step("Session");
    p.log.message(`  Path: ${context.session.projectPath}`);
    p.log.message(
      `  Provider: ${context.config.provider.type} / ${context.config.provider.model}`
    );

    // Context usage
    const contextUsage = getContextUsageFormatted(context.session);
    if (contextUsage !== "N/A") {
      p.log.message(`  Context: ${contextUsage}`);
    }

    // Message count
    p.log.message(`  Messages: ${context.session.messages.length}`);

    p.outro("Done");

    return {
      success: true,
      output: lines.join("\n"),
    };
  },
};
