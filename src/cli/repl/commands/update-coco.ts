/**
 * Self-update command - Update Coco to the latest version
 *
 * Checks npm for the latest version and runs npm update if available.
 */

import chalk from "chalk";
import { execa } from "execa";
import type { SlashCommand, ReplSession } from "../types.js";
import { VERSION } from "../../../version.js";

export const updateCocoCommand: SlashCommand = {
  name: "update-coco",
  aliases: ["upgrade", "self-update"],
  description: "Update Coco to the latest version from npm",
  usage: "/update-coco",

  async execute(_args: string[], _session: ReplSession): Promise<boolean> {
    console.log();
    console.log(chalk.cyan("  🔄 Checking for updates..."));
    console.log(chalk.dim(`  Current version: ${VERSION}`));

    try {
      // Check latest version from npm
      const { stdout } = await execa("npm", ["view", "@corbat-tech/coco", "version"], {
        timeout: 10000,
      });

      const latestVersion = stdout.trim();

      if (!latestVersion) {
        console.log(chalk.yellow("  ⚠️  Could not fetch latest version from npm"));
        console.log();
        return false;
      }

      console.log(chalk.dim(`  Latest version: ${latestVersion}`));

      // Compare versions
      if (VERSION === latestVersion) {
        console.log(chalk.green("  ✓ You're already on the latest version!"));
        console.log();
        return false;
      }

      // Show update available
      console.log();
      console.log(chalk.yellow(`  📦 Update available: ${VERSION} → ${latestVersion}`));
      console.log();
      console.log(chalk.white("  Running: npm install -g @corbat-tech/coco@latest"));
      console.log();

      // Run npm install
      const updateProcess = execa("npm", ["install", "-g", "@corbat-tech/coco@latest"], {
        stdio: "inherit",
        timeout: 60000,
      });

      await updateProcess;

      console.log();
      console.log(chalk.green("  ✓ Update complete!"));
      console.log();
      console.log(chalk.dim("  Please restart Coco to use the new version:"));
      console.log(chalk.white("  1. Type /exit to quit"));
      console.log(chalk.white("  2. Run coco again"));
      console.log();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (errorMsg.includes("EACCES") || errorMsg.includes("permission")) {
        console.log(chalk.red("  ✗ Permission denied"));
        console.log();
        console.log(chalk.yellow("  Try with sudo:"));
        console.log(chalk.white("  sudo npm install -g @corbat-tech/coco@latest"));
      } else if (errorMsg.includes("timeout") || errorMsg.includes("ETIMEDOUT")) {
        console.log(chalk.red("  ✗ Request timed out"));
        console.log(chalk.dim("  Check your internet connection and try again"));
      } else {
        console.log(chalk.red(`  ✗ Update failed: ${errorMsg}`));
      }

      console.log();
    }

    return false;
  },
};
