/** Conservative undo: file changes require a verified before/after snapshot. */
import chalk from "chalk";
import { execFileSync } from "node:child_process";
import type { SlashCommand, ReplSession } from "../types.js";

export const undoCommand: SlashCommand = {
  name: "undo",
  aliases: [],
  description: "Undo last local commit; file undo currently unavailable",
  usage: "/undo --last-commit",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    if (args.length === 1 && args[0] === "--last-commit") {
      try {
        execFileSync("git", ["reset", "--soft", "HEAD~1"], {
          cwd: session.projectPath,
          encoding: "utf-8",
          timeout: 5000,
        });
        console.log(
          chalk.green("\n✓ Last local commit undone; working files and staging preserved.\n"),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`\nUndo failed: ${message}\n`));
      }
      return false;
    }
    console.log(
      chalk.yellow(
        "\nFile undo is unavailable: there is no verified snapshot of these changes. No files were changed.",
      ),
    );
    console.log(
      chalk.dim(
        "Usage: /undo --last-commit — move HEAD to its parent while preserving working files and staging.\n",
      ),
    );
    return false;
  },
};
