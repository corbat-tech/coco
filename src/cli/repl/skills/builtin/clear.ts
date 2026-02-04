/**
 * Clear Skill
 *
 * Clears the conversation history and optionally the terminal screen.
 */

import chalk from "chalk";
import type { Skill, SkillContext, SkillResult } from "../types.js";
import { clearSession } from "../../session.js";

/**
 * Clear skill for clearing conversation history
 */
export const clearSkill: Skill = {
  name: "clear",
  description: "Clear conversation history",
  usage: "/clear [--screen]",
  aliases: ["c", "cls"],
  category: "general",

  async execute(args: string, context: SkillContext): Promise<SkillResult> {
    const shouldClearScreen = args.includes("--screen") || args.includes("-s");

    // Clear screen if requested
    if (shouldClearScreen) {
      // ANSI escape sequence to clear screen and move cursor to top
      process.stdout.write("\x1b[2J\x1b[H");
    }

    // Clear conversation history
    clearSession(context.session);

    return {
      success: true,
      output: chalk.dim("Conversation cleared.\n"),
    };
  },
};
