/**
 * Ship Skill
 *
 * Complete release pipeline from the REPL:
 * review → test → lint → branch → version → commit → PR → CI → merge → release
 *
 * Usage:
 *   /ship                         Full workflow
 *   /ship --skip-tests            Skip test step
 *   /ship --skip-review           Skip review step
 *   /ship --draft                 Create draft PR
 *   /ship --patch|--minor|--major Force version bump type
 *   /ship --no-version            Skip version bumping
 *   /ship --no-changelog          Skip changelog update
 *   /ship --base develop          Override base branch
 *   /ship -m "feat: description"  Pre-set commit message
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import type { Skill, SkillContext, SkillResult } from "../../types.js";
import type { ShipContext, ShipOptions, ShipStepResult } from "./types.js";
import { runPreflight } from "./steps/preflight.js";
import { runReview } from "./steps/review.js";
import { runTestCoverage } from "./steps/test-coverage.js";
import { runLintSecurity } from "./steps/lint-security.js";
import { runBranch } from "./steps/branch.js";
import { runVersion } from "./steps/version.js";
import { runCommitPush } from "./steps/commit-push.js";
import { runPullRequest } from "./steps/pull-request.js";
import { runCIChecks } from "./steps/ci-checks.js";
import { runMergeRelease } from "./steps/merge-release.js";

// ============================================================================
// Argument parsing
// ============================================================================

function parseArgs(args: string): ShipOptions {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const options: ShipOptions = {
    skipTests: false,
    skipReview: false,
    draft: false,
    noVersion: false,
    noChangelog: false,
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    if (token === "--skip-tests" || token === "--no-tests") {
      options.skipTests = true;
    } else if (token === "--skip-review" || token === "--no-review") {
      options.skipReview = true;
    } else if (token === "--draft") {
      options.draft = true;
    } else if (token === "--patch") {
      options.forceBump = "patch";
    } else if (token === "--minor") {
      options.forceBump = "minor";
    } else if (token === "--major") {
      options.forceBump = "major";
    } else if (token === "--no-version") {
      options.noVersion = true;
    } else if (token === "--no-changelog") {
      options.noChangelog = true;
    } else if ((token === "--base" || token === "-b") && tokens[i + 1]) {
      options.baseBranch = tokens[i + 1]!;
      i++;
    } else if ((token === "-m" || token === "--message") && tokens[i + 1]) {
      // Collect everything after -m as the message
      options.commitMessage = tokens.slice(i + 1).join(" ");
      break;
    }
  }

  return options;
}

// ============================================================================
// Step execution helper
// ============================================================================

function logStep(index: number, total: number, name: string, status: ShipStepResult["status"]) {
  const icon =
    status === "passed"
      ? chalk.green("OK")
      : status === "failed"
        ? chalk.red("FAIL")
        : status === "skipped"
          ? chalk.gray("SKIP")
          : status === "cancelled"
            ? chalk.yellow("CANCEL")
            : chalk.cyan("...");

  p.log.info(`[${index}/${total}] ${name} ${icon}`);
}

function shouldAbort(result: ShipStepResult): boolean {
  return result.status === "failed" || result.status === "cancelled";
}

// ============================================================================
// Main execution
// ============================================================================

async function shipExecute(args: string, context: SkillContext): Promise<SkillResult> {
  const options = parseArgs(args);

  p.intro(chalk.cyan("Ship"));
  p.log.info("Starting release pipeline...\n");

  const totalSteps = 10;

  // ---- Step 1: Preflight ----
  const spinner = p.spinner();
  spinner.start("Running preflight checks...");

  const preflight = await runPreflight(context.cwd);
  spinner.stop(preflight.result.message);

  if (preflight.result.status === "failed" || !preflight.profile) {
    logStep(1, totalSteps, "Preflight", "failed");
    if (preflight.result.details) p.log.error(preflight.result.details);
    p.outro("");
    return { success: false, error: preflight.result.message };
  }
  logStep(1, totalSteps, "Preflight", "passed");

  // Build the shared context
  const ctx: ShipContext = {
    cwd: context.cwd,
    profile: preflight.profile,
    options,
    steps: [preflight.result],
  };

  // ---- Step 2: Review ----
  spinner.start("Running code review...");
  const reviewResult = await runReview(ctx);
  spinner.stop(reviewResult.message);
  ctx.steps.push(reviewResult);
  logStep(2, totalSteps, "Review", reviewResult.status);
  if (shouldAbort(reviewResult)) return buildResult(ctx);

  // ---- Step 3: Tests ----
  spinner.start("Running tests...");
  const testResult = await runTestCoverage(ctx);
  spinner.stop(testResult.message);
  ctx.steps.push(testResult);
  logStep(3, totalSteps, "Tests", testResult.status);
  if (shouldAbort(testResult)) return buildResult(ctx);

  // ---- Step 4: Lint & Security ----
  spinner.start("Running lint and security checks...");
  const lintResult = await runLintSecurity(ctx);
  spinner.stop(lintResult.message);
  ctx.steps.push(lintResult);
  logStep(4, totalSteps, "Lint/Security", lintResult.status);
  if (shouldAbort(lintResult)) return buildResult(ctx);

  // ---- Step 5: Branch ----
  const branchResult = await runBranch(ctx);
  ctx.steps.push(branchResult);
  logStep(5, totalSteps, "Branch", branchResult.status);
  if (shouldAbort(branchResult)) return buildResult(ctx);

  // ---- Step 6: Version ----
  const versionResult = await runVersion(ctx);
  ctx.steps.push(versionResult);
  logStep(6, totalSteps, "Version", versionResult.status);
  if (shouldAbort(versionResult)) return buildResult(ctx);

  // ---- Step 7: Commit & Push ----
  spinner.start("Committing and pushing...");
  const commitResult = await runCommitPush(ctx);
  spinner.stop(commitResult.message);
  ctx.steps.push(commitResult);
  logStep(7, totalSteps, "Commit/Push", commitResult.status);
  if (shouldAbort(commitResult)) return buildResult(ctx);

  // ---- Step 8: Pull Request ----
  spinner.start("Creating pull request...");
  const prResult = await runPullRequest(ctx);
  spinner.stop(prResult.message);
  ctx.steps.push(prResult);
  logStep(8, totalSteps, "Pull Request", prResult.status);
  if (shouldAbort(prResult)) return buildResult(ctx);

  if (ctx.prUrl) {
    p.log.info(`PR: ${ctx.prUrl}`);
  }

  // ---- Step 9: CI Checks ----
  const ciResult = await runCIChecks(ctx);
  ctx.steps.push(ciResult);
  logStep(9, totalSteps, "CI Checks", ciResult.status);
  if (shouldAbort(ciResult)) return buildResult(ctx);

  // ---- Step 10: Merge & Release ----
  const mergeResult = await runMergeRelease(ctx);
  ctx.steps.push(mergeResult);
  logStep(10, totalSteps, "Merge/Release", mergeResult.status);

  return buildResult(ctx);
}

// ============================================================================
// Result builder
// ============================================================================

function buildResult(ctx: ShipContext): SkillResult {
  const failed = ctx.steps.find((s) => s.status === "failed" || s.status === "cancelled");

  if (failed) {
    p.outro(chalk.yellow(`Ship stopped at step: ${failed.step}`));
    return {
      success: false,
      error: failed.message,
      output: formatSummary(ctx),
    };
  }

  p.outro(chalk.green("Ship complete!"));
  return {
    success: true,
    output: formatSummary(ctx),
  };
}

function formatSummary(ctx: ShipContext): string {
  const lines: string[] = ["## Ship Summary\n"];

  for (const step of ctx.steps) {
    const icon =
      step.status === "passed"
        ? "+"
        : step.status === "skipped"
          ? "~"
          : step.status === "failed"
            ? "x"
            : step.status === "cancelled"
              ? "!"
              : " ";
    lines.push(`[${icon}] ${step.step}: ${step.message}`);
  }

  if (ctx.prUrl) lines.push(`\nPR: ${ctx.prUrl}`);
  if (ctx.newVersion) lines.push(`Version: ${ctx.newVersion}`);

  return lines.join("\n");
}

// ============================================================================
// Skill definition
// ============================================================================

export const shipSkill: Skill = {
  name: "ship",
  description: "Ship changes: review, test, branch, version, commit, PR, merge, release",
  usage: "/ship [--skip-tests] [--skip-review] [--draft] [--patch|--minor|--major]",
  aliases: ["release", "deploy", "publish"],
  category: "git",
  execute: shipExecute,
};
