/**
 * /help command
 */

import chalk from "chalk";
import type { SlashCommand } from "../types.js";

export const helpCommand: SlashCommand = {
  name: "help",
  aliases: ["h", "?"],
  description: "Show available commands",
  usage: "/help",

  async execute(): Promise<boolean> {
    console.log(chalk.cyan.bold("\n═══ Coco Commands ═══\n"));

    const sections = [
      {
        title: "General",
        commands: [
          { cmd: "/help, /?", desc: "Show this help message" },
          { cmd: "/clear, /c", desc: "Clear conversation history" },
          { cmd: "/exit, /quit, /q", desc: "Exit the REPL" },
        ],
      },
      {
        title: "Model & Settings",
        commands: [
          { cmd: "/model, /m", desc: "View or change the current model" },
          { cmd: "/compact", desc: "Toggle compact mode (less verbose)" },
          { cmd: "/cost, /tokens", desc: "Show token usage and cost" },
        ],
      },
      {
        title: "Git",
        commands: [
          { cmd: "/status, /s", desc: "Show project and git status" },
          { cmd: "/diff, /d", desc: "Show git diff of changes" },
          { cmd: "/commit, /ci", desc: "Commit staged changes" },
          { cmd: "/undo", desc: "Undo file changes or last commit" },
        ],
      },
    ];

    for (const section of sections) {
      console.log(chalk.bold(section.title));
      for (const { cmd, desc } of section.commands) {
        console.log(`  ${chalk.yellow(cmd.padEnd(22))} ${chalk.dim(desc)}`);
      }
      console.log();
    }

    console.log(chalk.dim("Tips:"));
    console.log(chalk.dim("  - Type naturally to interact with the agent"));
    console.log(chalk.dim("  - The agent can read/write files, run commands, and more"));
    console.log(chalk.dim("  - Use Ctrl+D or /exit to quit\n"));

    return false;
  },
};
