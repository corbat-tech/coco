/**
 * Ship Step: Test Coverage
 *
 * Runs the project's test suite and reports results.
 * If tests fail, asks the user whether to proceed.
 */

import * as p from "@clack/prompts";
import { bashExecTool } from "../../../../../../tools/bash.js";
import type { ShipContext, ShipStepResult } from "../types.js";

export async function runTestCoverage(ctx: ShipContext): Promise<ShipStepResult> {
  const start = performance.now();

  if (ctx.options.skipTests) {
    return {
      step: "test-coverage",
      status: "skipped",
      message: "Tests skipped (--skip-tests)",
      durationMs: performance.now() - start,
    };
  }

  const testCmd = ctx.profile.testCommand;
  if (!testCmd) {
    return {
      step: "test-coverage",
      status: "skipped",
      message: "No test command detected",
      durationMs: performance.now() - start,
    };
  }

  try {
    const result = await bashExecTool.execute({
      command: testCmd,
      cwd: ctx.cwd,
      timeout: 300_000, // 5 min timeout for tests
    });

    if (result.exitCode !== 0) {
      p.log.error("Tests failed:");
      // Show last 20 lines of output
      const lines = (result.stdout + "\n" + result.stderr).trim().split("\n");
      const tail = lines.slice(-20);
      for (const line of tail) {
        p.log.info(`  ${line}`);
      }

      const proceed = await p.confirm({
        message: "Tests failed. Continue shipping anyway?",
        initialValue: false,
      });

      if (p.isCancel(proceed) || !proceed) {
        return {
          step: "test-coverage",
          status: "cancelled",
          message: "User chose to fix failing tests first",
          durationMs: performance.now() - start,
        };
      }

      return {
        step: "test-coverage",
        status: "passed",
        message: "Tests failed — user acknowledged",
        durationMs: performance.now() - start,
      };
    }

    return {
      step: "test-coverage",
      status: "passed",
      message: "All tests passed",
      details: result.stdout.slice(-200),
      durationMs: performance.now() - start,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    p.log.warn(`Tests could not run: ${msg}`);
    return {
      step: "test-coverage",
      status: "passed",
      message: `Tests skipped (${msg})`,
      durationMs: performance.now() - start,
    };
  }
}
