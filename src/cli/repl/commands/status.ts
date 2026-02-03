/**
 * /status command - Show project and git status
 */

import chalk from "chalk";
import { execSync } from "node:child_process";
import type { SlashCommand, ReplSession } from "../types.js";

export const statusCommand: SlashCommand = {
  name: "status",
  aliases: ["s"],
  description: "Show project and git status",
  usage: "/status",

  async execute(_args: string[], session: ReplSession): Promise<boolean> {
    console.log(chalk.cyan.bold("\n═══ Project Status ═══\n"));

    // Project info
    console.log(chalk.dim("Project path: ") + session.projectPath);
    console.log(chalk.dim("Model: ") + session.config.provider.model);
    console.log(chalk.dim("Session started: ") + session.startedAt.toLocaleTimeString());
    console.log(chalk.dim("Messages in context: ") + session.messages.length);

    // Git status
    try {
      const gitStatus = execSync("git status --short", {
        cwd: session.projectPath,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      const branch = execSync("git branch --show-current", {
        cwd: session.projectPath,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      console.log(chalk.dim("\nGit branch: ") + chalk.yellow(branch));

      if (gitStatus) {
        console.log(chalk.dim("Git changes:"));
        const lines = gitStatus.split("\n").slice(0, 10);
        for (const line of lines) {
          const status = line.slice(0, 2);
          const file = line.slice(3);
          let color = chalk.white;
          if (status.includes("M")) color = chalk.yellow;
          if (status.includes("A")) color = chalk.green;
          if (status.includes("D")) color = chalk.red;
          if (status.includes("?")) color = chalk.gray;
          console.log(`  ${color(status)} ${file}`);
        }
        if (gitStatus.split("\n").length > 10) {
          console.log(chalk.dim(`  ... and ${gitStatus.split("\n").length - 10} more`));
        }
      } else {
        console.log(chalk.dim("Git: ") + chalk.green("Clean working tree"));
      }
    } catch {
      console.log(chalk.dim("\nGit: ") + chalk.yellow("Not a git repository"));
    }

    console.log();
    return false;
  },
};
