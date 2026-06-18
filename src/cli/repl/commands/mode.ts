/**
 * /mode command — view or change the active agent workflow mode.
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import { getAgentMode, isAgentMode, listAgentModes } from "../modes.js";

function currentMode(session: ReplSession) {
  return session.agentMode ?? (session.planMode ? "plan" : "build");
}

function renderModeList(session: ReplSession): void {
  const active = currentMode(session);
  console.log(chalk.cyan.bold("\n═══ Agent Modes ═══\n"));

  for (const mode of listAgentModes()) {
    const marker = mode.id === active ? chalk.green("●") : chalk.dim("○");
    const access = mode.readOnly ? chalk.yellow("read-only") : chalk.green("write");
    const verify = mode.requiresVerification ? chalk.dim("verify") : chalk.dim("no verify");
    console.log(`${marker} ${chalk.cyan(mode.id.padEnd(10))} ${access}  ${verify}`);
    console.log(chalk.dim(`   ${mode.description}`));
  }

  console.log(chalk.dim("\nUse /mode <name> to switch.\n"));
}

export const modeCommand: SlashCommand = {
  name: "mode",
  aliases: [],
  description: "View or change the active agent mode",
  usage: "/mode [ask|plan|build|debug|review|architect]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    if (args.length === 0 || args[0] === "list") {
      renderModeList(session);
      return false;
    }

    const requested = args[0]!.toLowerCase();
    if (!isAgentMode(requested)) {
      console.log(chalk.red(`Unknown mode: ${requested}`));
      console.log(
        chalk.dim(
          `Available: ${listAgentModes()
            .map((mode) => mode.id)
            .join(", ")}\n`,
        ),
      );
      return false;
    }

    const mode = getAgentMode(requested);
    session.agentMode = mode.id;
    session.planMode = mode.id === "plan";

    console.log(chalk.green(`\n✓ Mode: ${mode.label}`));
    console.log(chalk.dim(`  ${mode.description}`));
    console.log(chalk.dim(`  Access: ${mode.readOnly ? "read-only tools" : "read/write tools"}`));
    console.log(chalk.dim(`  Preferred tools: ${mode.preferredTools.join(", ")}`));
    if (mode.requiresVerification) {
      console.log(chalk.dim("  Verification expected before final handoff."));
    }
    console.log();
    return false;
  },
};
