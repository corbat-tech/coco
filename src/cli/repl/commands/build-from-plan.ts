/**
 * /build-from-plan command — execute a pending architect/plan artifact.
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";

export const buildFromPlanCommand: SlashCommand = {
  name: "build-from-plan",
  aliases: ["execute-plan"],
  description: "Execute the pending plan with editor/verifier guidance",
  usage: "/build-from-plan",

  async execute(_args: string[], session: ReplSession): Promise<boolean> {
    if (!session.pendingPlan) {
      console.log(chalk.yellow("No pending plan. Use /architect <task> or /plan <task> first.\n"));
      return false;
    }

    const plan = session.pendingPlan;
    session.pendingPlan = null;
    session.planMode = false;
    session.agentMode = "build";
    session.messages.push({
      role: "user",
      content:
        "[EDITOR MODE] Execute the approved architect plan below. " +
        "Follow the plan closely, call out deviations, run relevant verification, " +
        "and finish with a concise reviewer-style summary.\n\n" +
        plan,
    });

    console.log(chalk.green("\n✓ Executing pending plan in build mode"));
    console.log(chalk.dim("  Editor should apply changes and verifier should run checks.\n"));
    return false;
  },
};
