/**
 * Review Skill
 *
 * Performs code review on current changes compared to a base branch.
 * Shows findings ordered by severity with inline diffs for suggestions.
 *
 * Usage:
 *   /review                    Compare current branch vs main
 *   /review --base develop     Compare vs develop
 *   /review --no-lint          Skip linter
 */

import chalk from "chalk";
import * as p from "@clack/prompts";
import type { Skill, SkillContext, SkillResult } from "../types.js";
import {
  reviewCodeTool,
  type ReviewResult,
  type ReviewFinding,
  type ReviewSeverity,
} from "../../../../tools/review.js";
import { renderInlineDiff } from "../../output/diff-renderer.js";

// ============================================================================
// Argument parsing
// ============================================================================

function parseArgs(args: string): {
  baseBranch: string;
  runLinter: boolean;
} {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let baseBranch = "main";
  let runLinter = true;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if ((token === "--base" || token === "-b") && tokens[i + 1]) {
      baseBranch = tokens[i + 1]!;
      i++;
    } else if (token === "--no-lint") {
      runLinter = false;
    } else if (!token.startsWith("-")) {
      // Positional arg treated as base branch
      baseBranch = token;
    }
  }

  return { baseBranch, runLinter };
}

// ============================================================================
// Severity display
// ============================================================================

const SEVERITY_ICONS: Record<ReviewSeverity, string> = {
  critical: chalk.red.bold("CRITICAL"),
  major: chalk.red("MAJOR"),
  minor: chalk.yellow("minor"),
  info: chalk.dim("info"),
};

const CATEGORY_LABELS: Record<string, string> = {
  security: "Security",
  correctness: "Correctness",
  performance: "Performance",
  maintainability: "Maintainability",
  style: "Style",
  testing: "Testing",
  documentation: "Docs",
  "best-practice": "Best Practice",
};

// ============================================================================
// Rendering
// ============================================================================

function renderFinding(finding: ReviewFinding): void {
  const location = finding.line
    ? `${chalk.cyan(finding.file)}:${chalk.yellow(String(finding.line))}`
    : chalk.cyan(finding.file || "(project)");

  const category = CATEGORY_LABELS[finding.category] ?? finding.category;
  const severity = SEVERITY_ICONS[finding.severity];

  console.log(`\n  ${location}`);
  console.log(`  ${severity} ${chalk.dim(`[${category}]`)} ${finding.message}`);

  if (finding.suggestion) {
    console.log(renderInlineDiff(finding.suggestion.old, finding.suggestion.new));
  }
}

function renderResults(result: ReviewResult): void {
  const { summary, required, suggestions, maturity } = result;

  // Header
  console.log(chalk.cyan.bold(`\n═══ Code Review ═══\n`));

  console.log(`  ${chalk.dim("Branch:")} ${chalk.white(summary.branch)} → ${chalk.white(summary.baseBranch)}`);
  console.log(
    `  ${chalk.dim("Files:")} ${summary.filesChanged} changed | ` +
      chalk.green(`+${summary.additions}`) +
      " " +
      chalk.red(`-${summary.deletions}`),
  );
  console.log(`  ${chalk.dim("Maturity:")} ${maturity}`);

  // Status
  const statusIcon = summary.status === "approved" ? chalk.green("Approved") : chalk.yellow("Needs Work");
  console.log(`  ${chalk.dim("Status:")} ${statusIcon}`);

  // Required changes
  if (required.length > 0) {
    console.log(chalk.red.bold(`\n──── Required (${required.length}) ────`));
    for (const finding of required) {
      renderFinding(finding);
    }
  }

  // Suggestions
  if (suggestions.length > 0) {
    console.log(chalk.yellow.bold(`\n──── Suggestions (${suggestions.length}) ────`));
    for (const finding of suggestions) {
      renderFinding(finding);
    }
  }

  // Summary
  console.log(chalk.dim(`\n──── Summary ────\n`));
  if (required.length > 0) {
    console.log(`  Fix ${chalk.red.bold(String(required.length))} required issue${required.length !== 1 ? "s" : ""} before merging.`);
  }
  if (suggestions.length > 0) {
    console.log(`  ${chalk.yellow(String(suggestions.length))} suggestion${suggestions.length !== 1 ? "s" : ""} to improve quality.`);
  }
  if (required.length === 0 && suggestions.length === 0) {
    console.log(chalk.green("  No issues found. Looks good!"));
  }
  console.log();
}

// ============================================================================
// Skill definition
// ============================================================================

export const reviewSkill: Skill = {
  name: "review",
  description: "Review code changes against base branch",
  usage: "/review [--base main] [--no-lint]",
  aliases: ["r", "pr"],
  category: "git",

  async execute(args: string, context: SkillContext): Promise<SkillResult> {
    const { baseBranch, runLinter } = parseArgs(args);

    p.intro(chalk.cyan("Code Review"));
    const spinner = p.spinner();
    spinner.start(`Reviewing changes vs ${baseBranch}...`);

    try {
      const result = await reviewCodeTool.execute({
        baseBranch,
        includeUncommitted: true,
        runLinter,
        cwd: context.cwd,
      });

      spinner.stop("Review complete");

      if (result.diff.files.length === 0) {
        p.log.info("No changes to review");
        p.outro("Done");
        return { success: true, output: "No changes" };
      }

      renderResults(result);

      return {
        success: true,
        output: `${result.required.length} required, ${result.suggestions.length} suggestions`,
      };
    } catch (error) {
      spinner.stop("Review failed");
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(message);
      p.outro("");
      return { success: false, error: message };
    }
  },
};
