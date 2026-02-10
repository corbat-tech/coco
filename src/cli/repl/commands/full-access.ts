/**
 * /full-access command - Toggle full-access mode
 *
 * Full-access mode auto-approves all commands within the project directory
 * EXCEPT for dangerous commands (rm -rf /, sudo, etc.)
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import {
  isFullAccessMode,
  setFullAccessMode,
  saveFullAccessPreference,
} from "../full-access-mode.js";

export const fullAccessCommand: SlashCommand = {
  name: "full-access",
  aliases: ["full", "auto-approve"],
  description:
    "Toggle full-access mode — auto-approve commands within project (except dangerous ones)",
  usage: "/full-access [on|off|status]",

  async execute(args: string[], _session: ReplSession): Promise<boolean> {
    const arg = args[0]?.toLowerCase();

    let newState: boolean;

    if (arg === "on") {
      newState = true;
    } else if (arg === "off") {
      newState = false;
    } else if (arg === "status") {
      const state = isFullAccessMode();
      console.log();
      console.log(
        chalk.yellow("  ⚡ Full-access mode: ") +
          (state ? chalk.green.bold("ON") : chalk.dim("OFF")),
      );
      console.log();
      if (state) {
        console.log(chalk.dim("  When active:"));
        console.log(chalk.green("  ✓ Commands within project directory are auto-approved"));
        console.log(
          chalk.red("  ✗ Dangerous commands (rm -rf /, sudo, etc.) still require confirmation"),
        );
        console.log();
        console.log(chalk.yellow.bold("  ⚠️  Use with caution!"));
        console.log(
          chalk.dim("  This mode reduces safety prompts. Only enable in trusted projects."),
        );
      } else {
        console.log(
          chalk.dim("  Enable with /full-access on for faster development (less prompts)"),
        );
      }
      console.log();
      return false;
    } else {
      // Toggle
      newState = !isFullAccessMode();
    }

    setFullAccessMode(newState);
    saveFullAccessPreference(newState).catch(() => {});

    console.log();
    if (newState) {
      console.log(chalk.yellow("  ⚡ Full-access mode: ") + chalk.green.bold("ON"));
      console.log(
        chalk.dim("  Commands within this project will be auto-approved (except dangerous ones)"),
      );
      console.log();
      console.log(chalk.yellow.bold("  ⚠️  Safety reminder:"));
      console.log(
        chalk.dim(
          "  • Only use in projects you trust\n  • Dangerous commands still require confirmation\n  • Type /full-access off to disable",
        ),
      );
    } else {
      console.log(chalk.yellow("  ⚡ Full-access mode: ") + chalk.dim("OFF"));
      console.log(chalk.dim("  All commands will require manual approval"));
    }
    console.log();

    return false;
  },
};
