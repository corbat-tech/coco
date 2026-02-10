/**
 * Review Skill
 *
 * Performs code review on current changes compared to a base branch.
 * Shows findings as formatted markdown tables ordered by severity.
 *
 * Usage:
 *   /review                    Compare current branch vs main
 *   /review --base develop     Compare vs develop
 *   /review --no-lint          Skip linter
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import type { Skill, SkillContext, SkillResult } from "../types.js";
import {
  reviewCodeTool,
  type ReviewResult,
  type ReviewFinding,
  type ReviewSeverity,
} from "../../../../tools/review.js";
import { renderMarkdown } from "../../output/markdown.js";

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
// Severity labels (plain text for markdown)
// ============================================================================

const SEVERITY_LABELS: Record<ReviewSeverity, string> = {
  critical: "**CRITICAL**",
  major: "**MAJOR**",
  minor: "minor",
  info: "info",
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
// Markdown builder
// ============================================================================

/**
 * Format a finding's file location for a table cell.
 */
function findingLocation(f: ReviewFinding): string {
  return f.line ? `\`${f.file}:${f.line}\`` : f.file ? `\`${f.file}\`` : "(project)";
}

/**
 * Build a markdown table from a list of findings.
 */
function buildFindingsTable(findings: ReviewFinding[]): string {
  const lines: string[] = [];
  lines.push("| File | Severity | Category | Issue |");
  lines.push("|------|----------|----------|-------|");

  for (const f of findings) {
    const severity = SEVERITY_LABELS[f.severity];
    const category = CATEGORY_LABELS[f.category] ?? f.category;
    lines.push(`| ${findingLocation(f)} | ${severity} | ${category} | ${f.message} |`);
  }

  return lines.join("\n");
}

/**
 * Build the full review output as a markdown string.
 */
function buildReviewMarkdown(result: ReviewResult): string {
  const { summary, required, suggestions, maturity } = result;
  const lines: string[] = [];

  // Header
  lines.push("## Code Review\n");

  const statusIcon = summary.status === "approved" ? "Approved" : "Needs Work";
  lines.push(`**Branch:** \`${summary.branch}\` → \`${summary.baseBranch}\``);
  lines.push(
    `**Files:** ${summary.filesChanged} changed | +${summary.additions} -${summary.deletions}`,
  );
  lines.push(`**Maturity:** ${maturity}`);
  lines.push(`**Status:** ${statusIcon}`);
  lines.push("");

  // Required changes
  if (required.length > 0) {
    lines.push(`### Required (${required.length})\n`);
    lines.push(buildFindingsTable(required));
    lines.push("");
  }

  // Suggestions
  if (suggestions.length > 0) {
    lines.push(`### Suggestions (${suggestions.length})\n`);
    lines.push(buildFindingsTable(suggestions));
    lines.push("");
  }

  // Summary
  lines.push("---\n");
  if (required.length > 0) {
    lines.push(
      `Fix **${required.length}** required issue${required.length !== 1 ? "s" : ""} before merging.`,
    );
  }
  if (suggestions.length > 0) {
    lines.push(
      `${suggestions.length} suggestion${suggestions.length !== 1 ? "s" : ""} to improve quality.`,
    );
  }
  if (required.length === 0 && suggestions.length === 0) {
    lines.push("No issues found. Looks good!");
  }

  return lines.join("\n");
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

      const markdown = buildReviewMarkdown(result);
      console.log(renderMarkdown(markdown));

      return {
        success: true,
        output: markdown,
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
