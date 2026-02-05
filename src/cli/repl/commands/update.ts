/**
 * /update command - Check and install updates
 */

import chalk from "chalk";
import * as p from "@clack/prompts";
import { execa } from "execa";
import type { SlashCommand } from "../types.js";
import { checkForUpdates } from "../version-check.js";
import { VERSION } from "../../../version.js";

export const updateCommand: SlashCommand = {
  name: "update",
  aliases: ["upgrade"],
  description: "Check for updates and install if available",
  usage: "/update",

  async execute(_args, _session): Promise<boolean> {
    console.log();
    const spinner = p.spinner();
    spinner.start("Checking for updates...");

    const updateInfo = await checkForUpdates();

    if (!updateInfo) {
      spinner.stop(chalk.green(`✓ You're on the latest version (${VERSION})`));
      console.log();
      return false;
    }

    spinner.stop(
      chalk.yellow(`Update available: ${updateInfo.currentVersion} → ${chalk.green(updateInfo.latestVersion)}`),
    );

    // Ask user if they want to update
    const shouldUpdate = await p.confirm({
      message: "Would you like to update now?",
      initialValue: true,
    });

    if (p.isCancel(shouldUpdate) || !shouldUpdate) {
      console.log(chalk.dim(`\nTo update manually, run: ${updateInfo.updateCommand}\n`));
      return false;
    }

    // Run the update
    console.log();
    const updateSpinner = p.spinner();
    updateSpinner.start("Installing update...");

    try {
      // Parse the command
      const [cmd, ...cmdArgs] = updateInfo.updateCommand.split(" ");
      if (!cmd) {
        throw new Error("Invalid update command");
      }

      await execa(cmd, cmdArgs, {
        stdio: "pipe",
        timeout: 120000, // 2 minute timeout
      });

      updateSpinner.stop(chalk.green(`✓ Updated to v${updateInfo.latestVersion}!`));
      console.log();
      console.log(chalk.yellow("  Please restart Coco to use the new version."));
      console.log(chalk.dim("  Run: coco"));
      console.log();

      // Exit so user restarts with new version
      return true;
    } catch (error) {
      updateSpinner.stop(chalk.red("✗ Update failed"));
      console.log();
      console.log(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      console.log();
      console.log(chalk.dim(`To update manually, run: ${updateInfo.updateCommand}`));
      console.log();
      return false;
    }
  },
};
