/**
 * Ship Step: Review
 *
 * Runs code review against the base branch and reports findings.
 * If critical/major issues are found, asks the user whether to proceed.
 */

import * as p from "@clack/prompts";
import { reviewCodeTool } from "../../../../../../tools/review.js";
import type { ShipContext, ShipStepResult } from "../types.js";

export async function runReview(ctx: ShipContext): Promise<ShipStepResult> {
  const start = performance.now();

  if (ctx.options.skipReview) {
    return {
      step: "review",
      status: "skipped",
      message: "Review skipped (--skip-review)",
      durationMs: performance.now() - start,
    };
  }

  try {
    const result = await reviewCodeTool.execute({
      baseBranch: ctx.options.baseBranch ?? ctx.profile.defaultBranch,
      includeUncommitted: true,
      runLinter: false, // Lint has its own step
      cwd: ctx.cwd,
    });

    if (result.diff.files.length === 0) {
      return {
        step: "review",
        status: "passed",
        message: "No files to review",
        durationMs: performance.now() - start,
      };
    }

    const criticalCount = result.required.filter((f) => f.severity === "critical").length;
    const majorCount = result.required.filter((f) => f.severity === "major").length;
    const suggestionCount = result.suggestions.length;

    if (criticalCount > 0 || majorCount > 0) {
      // Show findings
      p.log.warn(`Review found ${criticalCount} critical and ${majorCount} major issue(s)`);
      for (const finding of result.required.slice(0, 10)) {
        const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
        p.log.warn(`  [${finding.severity.toUpperCase()}] ${loc}: ${finding.message}`);
      }

      const proceed = await p.confirm({
        message: "Continue shipping despite review issues?",
        initialValue: false,
      });

      if (p.isCancel(proceed) || !proceed) {
        return {
          step: "review",
          status: "cancelled",
          message: "User chose to fix review issues first",
          durationMs: performance.now() - start,
        };
      }
    }

    return {
      step: "review",
      status: "passed",
      message:
        result.summary.status === "approved"
          ? `Review approved (${suggestionCount} suggestions)`
          : `Review: ${criticalCount} critical, ${majorCount} major — user acknowledged`,
      durationMs: performance.now() - start,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    p.log.warn(`Review could not run: ${msg}`);
    return {
      step: "review",
      status: "passed",
      message: `Review skipped (${msg})`,
      durationMs: performance.now() - start,
    };
  }
}
