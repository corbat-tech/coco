/**
 * Ship Step: Pull Request
 *
 * Creates a GitHub PR using the `gh` CLI.
 * If a PR already exists for the branch, shows the existing one.
 */

import * as p from "@clack/prompts";
import { ghPrCreateTool, ghPrListTool } from "../../../../../../tools/github.js";
import { sanitizeCommitMessage } from "../commit-message.js";
import type { ShipContext, ShipStepResult } from "../types.js";

/**
 * Build a PR body from the ship context.
 */
function buildPRBody(ctx: ShipContext): string {
  const lines: string[] = [];

  lines.push("## Summary\n");
  if (ctx.commitMessage) {
    // Use the commit body (everything after the first line) as summary
    const parts = ctx.commitMessage.split("\n");
    const body = parts.slice(1).join("\n").trim();
    if (body) {
      lines.push(body);
    } else {
      lines.push(`- ${parts[0]}`);
    }
  }
  lines.push("");

  if (ctx.newVersion) {
    lines.push(`## Version\n`);
    lines.push(`\`${ctx.profile.versionFile?.currentVersion}\` → \`${ctx.newVersion}\``);
    lines.push("");
  }

  lines.push("## Test Plan\n");
  const testStep = ctx.steps.find((s) => s.step === "test-coverage");
  if (testStep) {
    lines.push(`- [${testStep.status === "passed" ? "x" : " "}] Tests: ${testStep.message}`);
  }

  const lintStep = ctx.steps.find((s) => s.step === "lint-security");
  if (lintStep) {
    lines.push(`- [${lintStep.status === "passed" ? "x" : " "}] Lint: ${lintStep.message}`);
  }

  const reviewStep = ctx.steps.find((s) => s.step === "review");
  if (reviewStep) {
    lines.push(`- [${reviewStep.status === "passed" ? "x" : " "}] Review: ${reviewStep.message}`);
  }

  return sanitizeCommitMessage(lines.join("\n"));
}

export async function runPullRequest(ctx: ShipContext): Promise<ShipStepResult> {
  const start = performance.now();
  const baseBranch = ctx.options.baseBranch ?? ctx.profile.defaultBranch;

  // Check if a PR already exists for this branch
  try {
    const existing = await ghPrListTool.execute({
      head: ctx.branchName,
      state: "open",
      cwd: ctx.cwd,
    });

    if (existing.prs.length > 0) {
      const pr = existing.prs[0]!;
      ctx.prNumber = pr.number;
      ctx.prUrl = pr.url;
      p.log.info(`PR already exists: ${pr.url}`);
      return {
        step: "pull-request",
        status: "passed",
        message: `PR #${pr.number} already exists`,
        details: pr.url,
        durationMs: performance.now() - start,
      };
    }
  } catch {
    // No existing PR, continue to create
  }

  // Build PR title and body
  const title = ctx.commitMessage?.split("\n")[0] ?? "Ship changes";
  const body = buildPRBody(ctx);

  try {
    const pr = await ghPrCreateTool.execute({
      title: sanitizeCommitMessage(title),
      body,
      base: baseBranch,
      draft: ctx.options.draft,
      cwd: ctx.cwd,
    });

    ctx.prNumber = pr.number;
    ctx.prUrl = pr.url;

    return {
      step: "pull-request",
      status: "passed",
      message: `PR #${pr.number} created`,
      details: pr.url,
      durationMs: performance.now() - start,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      step: "pull-request",
      status: "failed",
      message: `PR creation failed: ${msg}`,
      durationMs: performance.now() - start,
    };
  }
}
