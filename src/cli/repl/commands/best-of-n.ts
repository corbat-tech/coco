/**
 * /best-of-n command — Run N parallel solution attempts and select the best
 *
 * Usage:
 *   /best-of-n 3 fix the authentication bug
 *   /best-of-n --attempts 5 refactor the utils module
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import { runBestOfN, formatBestOfNResult } from "../best-of-n/index.js";
import type { TaskExecutor, SolutionAttempt } from "../best-of-n/index.js";

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

    console.log();
    console.log(
      chalk.magenta.bold(`  Best-of-${parsed.attempts}`) +
        chalk.dim(` — Running ${parsed.attempts} parallel attempts`),
    );
    console.log(chalk.yellow.dim("  ⚠ Experimental: agent execution in worktrees is a preview feature"));
    console.log(chalk.dim(`  Task: ${parsed.task}`));
    console.log();

    // TODO: Wire up real agent execution per worktree (executeAgentTurn in each worktree path)
    // Current implementation creates worktrees and evaluates quality but uses a placeholder executor.
    const executor: TaskExecutor = async (worktreePath, task, _signal) => {
      return {
        output: `Executed task "${task}" in ${worktreePath}`,
        filesChanged: [],
      };
    };

    const result = await runBestOfN(
      session.projectPath,
      executor,
      {
        task: parsed.task,
        attempts: parsed.attempts,
      },
      {
        onAttemptStart: (a: SolutionAttempt) => {
          console.log(chalk.dim(`  ▶ Attempt #${a.index} started...`));
        },
        onAttemptComplete: (a: SolutionAttempt) => {
          console.log(
            chalk.green(`  ✓ Attempt #${a.index} completed`) +
              chalk.dim(` (score: ${a.score?.toFixed(1) ?? "?"}, ${(a.durationMs / 1000).toFixed(1)}s)`),
          );
        },
        onAttemptFail: (a: SolutionAttempt) => {
          console.log(chalk.red(`  ✗ Attempt #${a.index} failed: ${a.error}`));
        },
        onWinnerSelected: (a: SolutionAttempt) => {
          console.log();
          console.log(
            chalk.magenta.bold(`  🏆 Winner: Attempt #${a.index}`) +
              chalk.dim(` (score: ${a.score?.toFixed(1)})`),
          );
        },
      },
    );

    console.log(formatBestOfNResult(result));
    console.log();

    return false;
  },
};
