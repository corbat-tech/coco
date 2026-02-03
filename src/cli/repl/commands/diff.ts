/**
 * /diff command - Show git diff
 */

import chalk from "chalk";
import { execSync } from "node:child_process";
import type { SlashCommand, ReplSession } from "../types.js";

export const diffCommand: SlashCommand = {
  name: "diff",
  aliases: ["d"],
  description: "Show git diff of changes",
  usage: "/diff [--staged]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const staged = args.includes("--staged") || args.includes("-s");

    try {
      const cmd = staged ? "git diff --staged" : "git diff";
      const diff = execSync(cmd, {
        cwd: session.projectPath,
        encoding: "utf-8",
        timeout: 10000,
      }).trim();

      if (!diff) {
        const msg = staged ? "No staged changes" : "No unstaged changes";
        console.log(chalk.dim(`\n${msg}\n`));
        return false;
      }

      console.log(chalk.cyan.bold(`\n═══ ${staged ? "Staged" : "Unstaged"} Changes ═══\n`));

      // Simple diff coloring
      for (const line of diff.split("\n").slice(0, 100)) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          console.log(chalk.green(line));
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          console.log(chalk.red(line));
        } else if (line.startsWith("@@")) {
          console.log(chalk.cyan(line));
        } else if (line.startsWith("diff ") || line.startsWith("index ")) {
          console.log(chalk.bold(line));
        } else {
          console.log(chalk.dim(line));
        }
      }

      const totalLines = diff.split("\n").length;
      if (totalLines > 100) {
        console.log(chalk.dim(`\n... ${totalLines - 100} more lines (use git diff for full output)`));
      }

      console.log();
    } catch {
      console.log(chalk.yellow("\nNot a git repository or git not available\n"));
    }

    return false;
  },
};
