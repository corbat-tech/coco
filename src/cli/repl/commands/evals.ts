/**
 * /evals command — run offline replay/evaluation fixtures.
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import { runDefaultEvals } from "../evals.js";

export const evalsCommand: SlashCommand = {
  name: "evals",
  aliases: ["replay"],
  description: "Run offline replay/evaluation fixtures",
  usage: "/evals run",

  async execute(args: string[], _session: ReplSession): Promise<boolean> {
    const subcommand = args[0]?.toLowerCase() ?? "run";
    if (subcommand !== "run") {
      console.log(chalk.red(`Unknown /evals subcommand: ${subcommand}`));
      console.log(chalk.dim("Use /evals run.\n"));
      return false;
    }

    const results = await runDefaultEvals();
    const passed = results.filter((result) => result.passed).length;

    console.log(chalk.cyan.bold("\n═══ Coco Evals ═══\n"));
    for (const result of results) {
      const marker = result.passed ? chalk.green("PASS") : chalk.red("FAIL");
      console.log(
        `  ${marker} ${chalk.cyan(result.id)} ` +
          chalk.dim(`${Math.round(result.duration)}ms, out:${result.outputTokens}`),
      );
      console.log(chalk.dim(`       ${result.description}`));
      if (result.error) {
        console.log(chalk.red(`       ${result.error}`));
      }
    }

    console.log();
    console.log(
      passed === results.length
        ? chalk.green(`✓ ${passed}/${results.length} evals passed\n`)
        : chalk.red(`✗ ${passed}/${results.length} evals passed\n`),
    );
    return false;
  },
};
