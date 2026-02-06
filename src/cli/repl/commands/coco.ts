/**
 * /coco command - Toggle COCO quality mode
 *
 * COCO mode enables automatic quality iteration:
 * auto-test, self-review, iterate until quality converges (≥85/100)
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import {
  isCocoMode,
  setCocoMode,
  saveCocoModePreference,
} from "../coco-mode.js";

export const cocoCommand: SlashCommand = {
  name: "coco",
  aliases: [],
  description: "Toggle quality mode — auto-test, self-review, iterate until converged",
  usage: "/coco [on|off]",

  async execute(args: string[], _session: ReplSession): Promise<boolean> {
    const arg = args[0]?.toLowerCase();

    let newState: boolean;

    if (arg === "on") {
      newState = true;
    } else if (arg === "off") {
      newState = false;
    } else if (arg === "status") {
      const state = isCocoMode();
      console.log();
      console.log(
        chalk.magenta("  COCO quality mode: ") +
          (state ? chalk.green.bold("ON") : chalk.dim("OFF")),
      );
      console.log();
      if (state) {
        console.log(chalk.dim("  When active, the agent will:"));
        console.log(chalk.dim("  1. Implement code + tests"));
        console.log(chalk.dim("  2. Run tests automatically"));
        console.log(chalk.dim("  3. Self-review against 12 quality dimensions"));
        console.log(chalk.dim("  4. Iterate until quality converges (≥85/100)"));
      } else {
        console.log(chalk.dim("  Enable with /coco on for quality-driven development"));
      }
      console.log();
      return false;
    } else {
      // Toggle
      newState = !isCocoMode();
    }

    setCocoMode(newState);
    saveCocoModePreference(newState).catch(() => {});

    console.log();
    if (newState) {
      console.log(
        chalk.magenta("  COCO quality mode: ") + chalk.green.bold("ON"),
      );
      console.log(
        chalk.dim("  Agent will auto-test, self-review, and iterate until quality ≥ 85/100"),
      );
    } else {
      console.log(
        chalk.magenta("  COCO quality mode: ") + chalk.dim("OFF"),
      );
      console.log(chalk.dim("  Fast mode — agent responds without quality iteration"));
    }
    console.log();

    return false;
  },
};
