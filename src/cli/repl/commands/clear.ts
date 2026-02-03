/**
 * /clear command
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import { clearSession } from "../session.js";

export const clearCommand: SlashCommand = {
  name: "clear",
  aliases: ["c"],
  description: "Clear conversation history",
  usage: "/clear",

  async execute(_args: string[], session: ReplSession): Promise<boolean> {
    clearSession(session);
    console.log(chalk.dim("Conversation cleared.\n"));
    return false; // Don't exit
  },
};
