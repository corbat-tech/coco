/**
 * /commit command - Quick commit changes
 */

import chalk from "chalk";
import { execSync } from "node:child_process";
import * as readline from "node:readline";
import type { SlashCommand, ReplSession } from "../types.js";

export const commitCommand: SlashCommand = {
  name: "commit",
  aliases: ["ci"],
  description: "Commit staged changes",
  usage: "/commit [message]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    try {
      // Check for staged changes
      const staged = execSync("git diff --staged --name-only", {
        cwd: session.projectPath,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      if (!staged) {
        console.log(chalk.yellow("\nNo staged changes to commit."));
        console.log(chalk.dim("Use 'git add <file>' or ask me to stage files.\n"));
        return false;
      }

      // Show what will be committed
      console.log(chalk.cyan("\nFiles to commit:"));
      for (const file of staged.split("\n")) {
        console.log(chalk.green(`  + ${file}`));
      }

      // Get commit message
      let message: string = args.join(" ").trim();

      if (!message) {
        const prompted = await promptForMessage();
        if (!prompted) {
          console.log(chalk.dim("Commit cancelled.\n"));
          return false;
        }
        message = prompted;
      }

      // Create commit - escape both backslashes and quotes for shell safety
      const escapedMessage = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      execSync(`git commit -m "${escapedMessage}"`, {
        cwd: session.projectPath,
        encoding: "utf-8",
        timeout: 10000,
      });

      console.log(chalk.green(`\n✓ Committed: "${message}"\n`));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\nCommit failed: ${msg}\n`));
    }

    return false;
  },
};

async function promptForMessage(): Promise<string | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.dim("Commit message: "), (answer) => {
      rl.close();
      resolve(answer.trim() || null);
    });
  });
}
