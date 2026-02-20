/**
 * /build-app — Autonomously build a complete app using sub-agents and sprints.
 *
 * Usage:
 *   /build-app <description>
 *   /build-app --spec ./spec.md --output ./my-app
 *   /build-app --spec ./spec.md --output ./my-app --yes
 *
 * When /full-power-risk is active the sprint runner executes without pausing.
 * Without it the command still works but individual tool uses may prompt.
 */

import chalk from "chalk";
import * as p from "@clack/prompts";
import path from "node:path";
import fs from "node:fs/promises";
import type { SlashCommand, ReplSession } from "../types.js";
import { isFullPowerRiskMode } from "../full-power-risk-mode.js";
import { runSpecInterview, UserCancelledError } from "../../../swarm/spec-agent.js";
import { runSprints } from "../../../swarm/sprint-runner.js";
import { createProvider } from "../../../providers/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedArgs {
  description: string;
  specFile: string | null;
  outputDir: string | null;
  skipConfirmation: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  let description = "";
  let specFile: string | null = null;
  let outputDir: string | null = null;
  let skipConfirmation = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--spec" || arg === "-s") {
      specFile = args[++i] ?? null;
    } else if (arg === "--output" || arg === "-o") {
      outputDir = args[++i] ?? null;
    } else if (arg === "--yes" || arg === "-y") {
      skipConfirmation = true;
    } else if (arg && !arg.startsWith("-")) {
      description = description ? `${description} ${arg}` : arg;
    }
  }

  return { description, specFile, outputDir, skipConfirmation };
}

/**
 * Assert that `resolvedPath` is inside `rootDir`.
 * Returns true if safe, false if the path escapes the root.
 */
function isWithinRoot(resolvedPath: string, rootDir: string): boolean {
  const normalRoot = path.normalize(rootDir) + path.sep;
  const normalPath = path.normalize(resolvedPath);
  // Also allow exact match (rootDir itself)
  return normalPath === path.normalize(rootDir) || normalPath.startsWith(normalRoot);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const buildAppCommand: SlashCommand = {
  name: "build-app",
  aliases: ["ba"],
  description: "Build a complete app autonomously using sub-agents and sprints",
  usage: "/build-app [description] [--spec file] [--output dir] [--yes]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const parsed = parseArgs(args);
    const isAutonomous = isFullPowerRiskMode();

    // ------------------------------------------------------------------
    // Require description or spec file
    // ------------------------------------------------------------------
    if (!parsed.description && !parsed.specFile) {
      p.log.warn("Usage:");
      p.log.message("  /build-app <description>");
      p.log.message("  /build-app --spec ./spec.md --output ./my-app");
      p.log.message("");
      p.log.message("Options:");
      p.log.message("  --spec, -s   Read description from a file (md or txt)");
      p.log.message("  --output, -o Output directory for the generated project");
      p.log.message("  --yes, -y    Skip confirmation prompt");
      return false;
    }

    // ------------------------------------------------------------------
    // Resolve and validate spec file path (B1 — path traversal guard)
    // ------------------------------------------------------------------
    let initialDescription = parsed.description;
    if (parsed.specFile) {
      const specPath = path.resolve(session.projectPath, parsed.specFile);
      if (!isWithinRoot(specPath, session.projectPath)) {
        p.log.error(`--spec path must be within the project directory: ${specPath}`);
        return false;
      }
      try {
        initialDescription = await fs.readFile(specPath, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        p.log.error(`Error reading spec file: ${msg}`);
        return false;
      }
    }

    // ------------------------------------------------------------------
    // Resolve and validate output path (B1 — path traversal guard)
    // ------------------------------------------------------------------
    const outputPath = parsed.outputDir
      ? path.resolve(session.projectPath, parsed.outputDir)
      : path.join(session.projectPath, "build-app-output");

    if (parsed.outputDir && !isWithinRoot(outputPath, session.projectPath)) {
      p.log.error(`--output path must be within the project directory: ${outputPath}`);
      return false;
    }

    // ------------------------------------------------------------------
    // Banner
    // ------------------------------------------------------------------
    console.log();
    console.log(chalk.bold.cyan("  /build-app"));
    console.log(
      isAutonomous
        ? chalk.yellow("  Mode: AUTONOMOUS (full-power-risk is ON)")
        : chalk.dim("  Mode: supervised (confirm tool uses as usual)"),
    );
    console.log(chalk.dim(`  Output: ${outputPath}`));
    console.log();

    // ------------------------------------------------------------------
    // Create provider from session config
    // ------------------------------------------------------------------
    let provider;
    try {
      provider = await createProvider(session.config.provider.type, {
        model: session.config.provider.model,
        maxTokens: session.config.provider.maxTokens,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.log.error(`Error creating provider: ${msg}`);
      return false;
    }

    // ------------------------------------------------------------------
    // Spec interview
    // ------------------------------------------------------------------
    let spec;
    try {
      spec = await runSpecInterview(initialDescription, provider, outputPath, {
        skipConfirmation: parsed.skipConfirmation || isAutonomous,
      });
    } catch (err) {
      if (err instanceof UserCancelledError) {
        // p.cancel() was already called inside runSpecInterview — just return
        return false;
      }
      const msg = err instanceof Error ? err.message : String(err);
      p.log.error(`Spec interview failed: ${msg}`);
      return false;
    }

    // ------------------------------------------------------------------
    // Confirmation (when not autonomous and --yes not given)
    // ------------------------------------------------------------------
    if (!isAutonomous && !parsed.skipConfirmation) {
      const confirm = await p.confirm({
        message: `Build "${spec.projectName}" with ${spec.sprints.length} sprints?`,
        initialValue: true,
      });
      if (p.isCancel(confirm) || !confirm) {
        p.cancel("Build cancelled.");
        return false;
      }
    }

    // ------------------------------------------------------------------
    // Run sprints
    // ------------------------------------------------------------------
    console.log();
    console.log(chalk.cyan("  Starting sprints…"));
    console.log();

    let buildResult;
    try {
      buildResult = await runSprints({
        spec,
        provider,
        onProgress: (msg) => {
          console.log(chalk.dim(`  ${msg}`));
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.log.error(`Sprint runner failed: ${msg}`);
      return false;
    }

    // ------------------------------------------------------------------
    // Result summary
    // ------------------------------------------------------------------
    console.log();
    if (buildResult.success) {
      console.log(chalk.green.bold("  Build complete!"));
    } else {
      console.log(chalk.yellow.bold("  Build finished with issues."));
    }
    console.log(chalk.dim(`  Output:       ${buildResult.outputPath}`));
    console.log(
      chalk.dim(
        `  Quality:      ${buildResult.finalQualityScore}/100 ` +
          `(threshold: ${spec.qualityThreshold})`,
      ),
    );
    console.log(
      chalk.dim(
        `  Tests:        ${buildResult.sprintResults.reduce((n, r) => n + r.testsPassing, 0)} passing`,
      ),
    );
    console.log(chalk.dim(`  Duration:     ${(buildResult.totalDurationMs / 1000).toFixed(1)}s`));
    console.log();

    // Per-sprint breakdown
    for (const result of buildResult.sprintResults) {
      const icon = result.success ? chalk.green("✓") : chalk.red("✗");
      console.log(
        `  ${icon} ${result.sprintId}  ` +
          `score=${result.qualityScore}  ` +
          `tests=${result.testsPassing}/${result.testsTotal}  ` +
          `iter=${result.iterations}`,
      );
      if (result.errors.length > 0) {
        for (const e of result.errors) {
          p.log.error(`  ! ${e}`);
        }
      }
    }

    console.log();

    return false; // Don't exit the REPL
  },
};
