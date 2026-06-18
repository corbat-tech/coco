/**
 * /architect command — start an architect/editor workflow.
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";

export const architectCommand: SlashCommand = {
  name: "architect",
  aliases: [],
  description: "Create a read-only architecture plan for a task",
  usage: "/architect <task>",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const task = args.join(" ").trim();
    if (!task) {
      console.log(chalk.red("Usage: /architect <task>\n"));
      return false;
    }

    session.agentMode = "architect";
    session.planMode = true;
    session.pendingPlan = null;
    session.messages.push({
      role: "user",
      content:
        "[ARCHITECT MODE] Produce a read-only implementation architecture plan. " +
        "Do not edit files. Identify files, risks, verification, and editor handoff steps. " +
        "When complete, present the plan for /plan approve, /plan edit, or /plan reject.\n\n" +
        `Task: ${task}`,
    });

    console.log(chalk.green("\n✓ Architect mode activated"));
    console.log(
      chalk.dim("  Read-only tools only. Use /plan approve, /plan edit, or /plan reject.\n"),
    );
    return false;
  },
};
