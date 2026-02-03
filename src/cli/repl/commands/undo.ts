/**
 * /undo command - Undo last git change
 */

import chalk from "chalk";
import { execSync } from "node:child_process";
import type { SlashCommand, ReplSession } from "../types.js";

export const undoCommand: SlashCommand = {
  name: "undo",
  aliases: [],
  description: "Undo last file changes (git checkout)",
  usage: "/undo [file] or /undo --last-commit",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    try {
      if (args.includes("--last-commit")) {
        // Undo last commit (soft reset)
        execSync("git reset --soft HEAD~1", {
          cwd: session.projectPath,
          encoding: "utf-8",
          timeout: 5000,
        });
        console.log(chalk.green("\n✓ Last commit undone (changes preserved as staged)\n"));
        return false;
      }

      if (args.length > 0) {
        // Undo specific file
        const file = args.join(" ");
        execSync(`git checkout -- "${file}"`, {
          cwd: session.projectPath,
          encoding: "utf-8",
          timeout: 5000,
        });
        console.log(chalk.green(`\n✓ Restored: ${file}\n`));
        return false;
      }

      // Show help
      console.log(chalk.cyan("\nUsage:"));
      console.log(chalk.dim("  /undo <file>        - Restore file to last commit"));
      console.log(chalk.dim("  /undo --last-commit - Undo last commit (soft reset)"));
      console.log();
      console.log(chalk.yellow("Warning: This discards uncommitted changes!\n"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\nUndo failed: ${msg}\n`));
    }

    return false;
  },
};
