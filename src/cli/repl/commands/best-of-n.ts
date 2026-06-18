/**
 * /best-of-n command — Run N parallel solution attempts and select the best
 *
 * Usage:
 *   /best-of-n 3 fix the authentication bug
 *   /best-of-n --attempts 5 refactor the utils module
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";

/**
 * Parse arguments for the best-of-n command.
 * Supports: /best-of-n 3 <task> or /best-of-n --attempts 3 <task>
 */
function parseArgs(args: string[]): { attempts: number; task: string } | null {
  if (args.length === 0) return null;

  // Check for --attempts N flag
  const attemptsIdx = args.indexOf("--attempts");
  if (attemptsIdx >= 0 && args[attemptsIdx + 1]) {
    const n = parseInt(args[attemptsIdx + 1]!, 10);
    if (isNaN(n)) return null;
    const remaining = [...args];
    remaining.splice(attemptsIdx, 2);
    return { attempts: n, task: remaining.join(" ") };
  }

  // Check if first arg is a number
  const firstNum = parseInt(args[0]!, 10);
  if (!isNaN(firstNum)) {
    return { attempts: firstNum, task: args.slice(1).join(" ") };
  }

  // Default: 3 attempts
  return { attempts: 3, task: args.join(" ") };
}

export const bestOfNCommand: SlashCommand = {
  name: "best-of-n",
  aliases: ["bon"],
  description: "Run N parallel solution attempts and select the best",
  usage: "/best-of-n [N] <task description>",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const parsed = parseArgs(args);

    if (!parsed || !parsed.task) {
      console.log();
      console.log(chalk.yellow("  Usage: /best-of-n [N] <task description>"));
      console.log(chalk.dim("  Example: /best-of-n 3 fix the authentication bug"));
      console.log(chalk.dim("  Alias: /bon 3 fix the auth bug"));
      console.log();
      return false;
    }

    session.messages.push({
      role: "user",
      content:
        `[best-of-n directive] Prepare ${parsed.attempts} independent solution attempts for this task. ` +
        "Use worktree isolation only when the runtime provides provider/tool execution in each worktree. " +
        "Do not claim attempts were executed unless they actually ran. " +
        "Score candidates by tests, typecheck/lint, diff risk, and task fit.\n\n" +
        `Task: ${parsed.task}`,
    });

    console.log();
    console.log(chalk.magenta.bold(`  Best-of-${parsed.attempts}`));
    console.log(chalk.yellow("  Runtime execution is not started from this command yet."));
    console.log(
      chalk.dim(
        "  A best-of-n directive was queued for the agent; false placeholder execution is disabled.",
      ),
    );
    console.log(chalk.dim(`  Task: ${parsed.task}`));
    console.log();

    return false;
  },
};
