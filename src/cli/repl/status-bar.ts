/**
 * Persistent status bar showing project context and agent settings
 *
 * Displays at the bottom of the terminal:
 * - Project path (abbreviated)
 * - Provider/model
 * - COCO mode status
 * - Full-access mode status (if enabled)
 */

import chalk from "chalk";
import path from "node:path";
import { isCocoMode } from "./coco-mode.js";
import { isFullAccessMode } from "./full-access-mode.js";
import type { ReplConfig } from "./types.js";

/**
 * Format the status bar line
 */
export function formatStatusBar(projectPath: string, config: ReplConfig): string {
  const parts: string[] = [];

  // Project name (last directory component)
  const projectName = path.basename(projectPath);
  parts.push(chalk.dim("📁") + chalk.magenta(projectName));

  // Provider/model
  const providerName = config.provider.type;
  const modelName = config.provider.model || "default";
  parts.push(chalk.dim(`${providerName}/`) + chalk.cyan(modelName));

  // COCO mode indicator
  if (isCocoMode()) {
    parts.push(chalk.green("🔄 coco"));
  }

  // Full-access mode indicator
  if (isFullAccessMode()) {
    parts.push(chalk.yellow("⚡ full-access"));
  }

  return "  " + parts.join(chalk.dim(" • "));
}

/**
 * Render the status bar (called after each user input)
 */
export function renderStatusBar(projectPath: string, config: ReplConfig): void {
  const statusLine = formatStatusBar(projectPath, config);
  console.log();
  console.log(statusLine);
}

/**
 * Clear the status bar from terminal (if needed for redraws)
 */
export function clearStatusBar(): void {
  // Move cursor up one line and clear it
  process.stdout.write("\x1b[1A\x1b[2K");
}
