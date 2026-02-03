/**
 * /exit command
 */

import chalk from "chalk";
import type { SlashCommand } from "../types.js";

export const exitCommand: SlashCommand = {
  name: "exit",
  aliases: ["quit", "q"],
  description: "Exit the REPL",
  usage: "/exit",

  async execute(): Promise<boolean> {
    console.log(chalk.dim("\nGoodbye!\n"));
    return true; // Signal to exit
  },
};
