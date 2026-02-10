/**
 * Ship Step: CI Checks
 *
 * Polls GitHub PR checks until they all pass, fail, or timeout.
 * Reports progress via spinner and gives the user control on failure.
 */

import * as p from "@clack/prompts";
import { ghPrChecksTool } from "../../../../../../tools/github.js";
import type { ShipContext, ShipStepResult } from "../types.js";
import { DEFAULT_SHIP_CONFIG } from "../types.js";

export async function runCIChecks(ctx: ShipContext): Promise<ShipStepResult> {
  const start = performance.now();

  if (!ctx.prNumber) {
    return {
      step: "ci-checks",
      status: "skipped",
      message: "No PR to check",
      durationMs: performance.now() - start,
    };
  }

  if (ctx.profile.ci.type === "none") {
    return {
      step: "ci-checks",
      status: "skipped",
      message: "No CI system detected",
      durationMs: performance.now() - start,
    };
  }

  const timeoutMs = DEFAULT_SHIP_CONFIG.ciCheckTimeoutMs;
  const pollMs = DEFAULT_SHIP_CONFIG.ciCheckPollMs;
  const deadline = start + timeoutMs;

  const spinner = p.spinner();
  spinner.start("Waiting for CI checks...");

  while (performance.now() < deadline) {
    try {
      const result = await ghPrChecksTool.execute({
        number: ctx.prNumber,
        cwd: ctx.cwd,
      });

      if (result.checks.length === 0) {
        // No checks configured yet, wait a bit for them to register
        await sleep(pollMs);
        continue;
      }

      if (result.allPassed) {
        spinner.stop("All CI checks passed");
        return {
          step: "ci-checks",
          status: "passed",
          message: `${result.checks.length} check(s) passed`,
          durationMs: performance.now() - start,
        };
      }

      if (result.anyFailed) {
        spinner.stop("CI checks failed");
        const failedChecks = result.checks.filter((c) => c.status === "fail");
        p.log.error("Failed checks:");
        for (const check of failedChecks) {
          p.log.error(`  ${check.name}: ${check.url}`);
        }

        const action = await p.select({
          message: "CI checks failed. What do you want to do?",
          options: [
            { value: "wait", label: "Wait more" },
            { value: "continue", label: "Continue anyway" },
            { value: "abort", label: "Abort" },
          ],
        });

        if (p.isCancel(action) || action === "abort") {
          return {
            step: "ci-checks",
            status: "cancelled",
            message: "CI checks failed — user aborted",
            durationMs: performance.now() - start,
          };
        }

        if (action === "continue") {
          return {
            step: "ci-checks",
            status: "passed",
            message: "CI checks failed — user continued",
            durationMs: performance.now() - start,
          };
        }

        // "wait" — restart the spinner and continue polling
        spinner.start("Waiting for CI checks...");
      }

      // Still pending — update spinner message
      const pending = result.checks.filter((c) => c.status === "pending").length;
      const passed = result.checks.filter((c) => c.status === "pass").length;
      spinner.message(`CI: ${passed}/${result.checks.length} passed, ${pending} pending...`);
    } catch {
      // gh command failed, retry after delay
    }

    await sleep(pollMs);
  }

  // Timeout
  spinner.stop("CI check timeout");

  const action = await p.select({
    message: "CI checks timed out. What do you want to do?",
    options: [
      { value: "continue", label: "Continue without CI" },
      { value: "abort", label: "Abort" },
    ],
  });

  if (p.isCancel(action) || action === "abort") {
    return {
      step: "ci-checks",
      status: "cancelled",
      message: "CI checks timed out — user aborted",
      durationMs: performance.now() - start,
    };
  }

  return {
    step: "ci-checks",
    status: "passed",
    message: "CI checks timed out — user continued",
    durationMs: performance.now() - start,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
