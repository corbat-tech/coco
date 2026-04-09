/**
 * Persistent status bar showing project context and agent settings
 *
 * Displays at the bottom of the terminal:
 * - Project path (abbreviated)
 * - Provider/model
 * - Quality loop status
 * - Full-access mode status (if enabled)
 */

import chalk from "chalk";
import path from "node:path";
import { getDefaultModel } from "../../config/env.js";
import { isQualityLoop } from "./quality-loop.js";
import { isFullAccessMode } from "./full-access-mode.js";
import type { ReplConfig } from "./types.js";
import { type GitContext, formatGitShort } from "./git-context.js";

/**
 * Format context usage as a colored string based on usage level.
 */
function formatContextUsage(percent: number): string {
  const label = `ctx ${percent.toFixed(0)}%`;
  if (percent >= 90) return chalk.red(label);
  if (percent >= 75) return chalk.yellow(label);
  return chalk.dim(label);
}

function getDisplayModel(config: ReplConfig): string {
  const model = config.provider.model?.trim();
  if (!model || ["default", "none", "null", "undefined"].includes(model.toLowerCase())) {
    return getDefaultModel(config.provider.type);
  }
  return model;
}

/**
 * Format the status bar line
 */
export function formatStatusBar(
  projectPath: string,
  config: ReplConfig,
  gitCtx?: GitContext | null,
  contextUsagePercent?: number,
): string {
  const parts: string[] = [];

  // Project name (last directory component)
  const projectName = path.basename(projectPath);
  parts.push(chalk.dim("📁 ") + chalk.magenta(projectName));

  // Provider/model
  const providerName = config.provider.type;
  const modelName = getDisplayModel(config);
  parts.push(chalk.dim(`${providerName}/`) + chalk.cyan(modelName));

  // Quality loop indicator
  if (isQualityLoop()) {
    parts.push(chalk.green("🔄 quality loop"));
  }

  // Full-access mode indicator
  if (isFullAccessMode()) {
    parts.push(chalk.yellow("⚡ full-access"));
  }

  // Git context
  if (gitCtx) {
    parts.push(formatGitShort(gitCtx));
  }

  // Context usage — only shown once there is real data (0 means not yet initialized)
  if (contextUsagePercent !== undefined && contextUsagePercent > 0) {
    parts.push(formatContextUsage(contextUsagePercent));
  }

  return "  " + parts.join(chalk.dim(" • "));
}

/**
 * Render the status bar (called after each agent turn)
 */
export function renderStatusBar(
  projectPath: string,
  config: ReplConfig,
  gitCtx?: GitContext | null,
  contextUsagePercent?: number,
): void {
  const statusLine = formatStatusBar(projectPath, config, gitCtx, contextUsagePercent);
  console.log();
  console.log(statusLine);
}
