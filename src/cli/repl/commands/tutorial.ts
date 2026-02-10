/**
 * /tutorial command
 */

import chalk from "chalk";
import type { SlashCommand } from "../types.js";

export const tutorialCommand: SlashCommand = {
  name: "tutorial",
  aliases: ["tut", "learn"],
  description: "Quick guide to using Coco",
  usage: "/tutorial",

  async execute(): Promise<boolean> {
    console.log(chalk.cyan.bold("\n═══ Coco Quick Tutorial ═══\n"));

    const steps = [
      {
        step: "1",
        title: "Ask Coco anything",
        desc: 'Just type what you need: "Create a REST API with authentication"',
      },
      {
        step: "2",
        title: "Coco works autonomously",
        desc: "Reads your project, writes code, runs tests, and iterates until quality passes",
      },
      {
        step: "3",
        title: "Enable quality mode",
        desc: "Type /coco to enable auto-iteration: test → analyze → fix → repeat until score ≥ 85",
      },
      {
        step: "4",
        title: "Review changes",
        desc: "Use /diff to see what changed, /status for project state",
      },
      {
        step: "5",
        title: "Save your work",
        desc: "Use /commit to commit changes with a descriptive message",
      },
    ];

    for (const { step, title, desc } of steps) {
      console.log(`  ${chalk.magenta.bold(step)}. ${chalk.bold(title)}`);
      console.log(`     ${chalk.dim(desc)}`);
      console.log();
    }

    console.log(chalk.bold("Useful commands:"));
    console.log(
      `  ${chalk.yellow("/coco")}       ${chalk.dim("Toggle quality mode (auto-iteration)")}`,
    );
    console.log(`  ${chalk.yellow("/init")}       ${chalk.dim("Initialize a new project")}`);
    console.log(`  ${chalk.yellow("/help")}       ${chalk.dim("See all available commands")}`);
    console.log(`  ${chalk.yellow("/help tools")} ${chalk.dim("See available agent tools")}`);
    console.log();

    return false;
  },
};
