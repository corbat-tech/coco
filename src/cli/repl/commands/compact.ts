/**
 * /compact command - Toggle compact mode (less verbose output)
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";

// Track compact mode state (could be moved to session config)
let compactMode = false;

export function isCompactMode(): boolean {
  return compactMode;
}

export const compactCommand: SlashCommand = {
  name: "compact",
  aliases: [],
  description: "Toggle compact mode (less verbose output)",
  usage: "/compact",

  async execute(_args: string[], _session: ReplSession): Promise<boolean> {
    compactMode = !compactMode;

    if (compactMode) {
      console.log(chalk.dim("Compact mode: ON (less verbose output)\n"));
    } else {
      console.log(chalk.dim("Compact mode: OFF (normal output)\n"));
    }

    return false;
  },
};
