/**
 * Ship Step: Lint & Security
 *
 * Runs the project linter (if available), attempts auto-fix,
 * and runs a dependency audit for known vulnerabilities.
 */

import * as p from "@clack/prompts";
import { bashExecTool } from "../../../../../../tools/bash.js";
import type { ShipContext, ShipStepResult } from "../types.js";

export async function runLintSecurity(ctx: ShipContext): Promise<ShipStepResult> {
  const start = performance.now();
  const issues: string[] = [];

  // ---- Lint ----
  const lintCmd = ctx.profile.lintCommand;
  if (lintCmd) {
    try {
      const lintResult = await bashExecTool.execute({
        command: lintCmd,
        cwd: ctx.cwd,
        timeout: 120_000,
      });

      if (lintResult.exitCode !== 0) {
        issues.push(`Lint errors found`);

        // Try auto-fix
        const fixCmd = lintCmd.replace(/\blint\b/, "lint:fix").replace(/\blint$/, "lint --fix");
        if (fixCmd !== lintCmd) {
          p.log.info("Attempting auto-fix...");
          try {
            await bashExecTool.execute({
              command: fixCmd,
              cwd: ctx.cwd,
              timeout: 120_000,
            });

            // Re-check lint
            const recheck = await bashExecTool.execute({
              command: lintCmd,
              cwd: ctx.cwd,
              timeout: 120_000,
            });
            if (recheck.exitCode === 0) {
              issues.pop(); // Remove the lint error
              issues.push("Lint errors auto-fixed");
            }
          } catch {
            // Auto-fix failed, keep the original issue
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      issues.push(`Lint failed: ${msg}`);
    }
  }

  // ---- Security audit ----
  const pm = ctx.profile.packageManager;
  let auditCmd: string | null = null;

  if (pm === "npm") auditCmd = "npm audit --production 2>&1 || true";
  else if (pm === "pnpm") auditCmd = "pnpm audit --production 2>&1 || true";
  else if (pm === "yarn") auditCmd = "yarn audit --groups dependencies 2>&1 || true";
  else if (pm === "cargo") auditCmd = "cargo audit 2>&1 || true";

  if (auditCmd) {
    try {
      const auditResult = await bashExecTool.execute({
        command: auditCmd,
        cwd: ctx.cwd,
        timeout: 60_000,
      });
      const output = auditResult.stdout + auditResult.stderr;

      // Check for critical/high vulnerabilities
      if (/\d+ (critical|high)/i.test(output)) {
        issues.push("Security vulnerabilities found in dependencies");
      }
    } catch {
      // Audit not available, skip silently
    }
  }

  // ---- Report ----
  if (issues.length > 0) {
    for (const issue of issues) {
      p.log.warn(`  ${issue}`);
    }

    if (issues.some((i) => !i.includes("auto-fixed"))) {
      const proceed = await p.confirm({
        message: "Lint/security issues found. Continue?",
        initialValue: true,
      });

      if (p.isCancel(proceed) || !proceed) {
        return {
          step: "lint-security",
          status: "cancelled",
          message: "User chose to fix lint/security issues first",
          durationMs: performance.now() - start,
        };
      }
    }
  }

  return {
    step: "lint-security",
    status: "passed",
    message: issues.length > 0
      ? `Completed with issues: ${issues.join("; ")}`
      : "Lint and security checks passed",
    durationMs: performance.now() - start,
  };
}
