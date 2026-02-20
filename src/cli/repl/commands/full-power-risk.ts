/**
 * /full-power-risk command
 *
 * Autonomous development mode: git push, installs, docker, etc. are
 * auto-approved. Supply-chain injection and filesystem destruction are
 * still blocked by FULL_POWER_BLOCKED patterns.
 *
 * Usage:
 *   /full-power-risk          — toggle
 *   /full-power-risk on       — enable
 *   /full-power-risk off      — disable
 *   /full-power-risk status   — show current state
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import {
  isFullPowerRiskMode,
  setFullPowerRiskMode,
  saveFullPowerRiskPreference,
} from "../full-power-risk-mode.js";

export const fullPowerRiskCommand: SlashCommand = {
  name: "full-power-risk",
  aliases: ["fpr", "full-power"],
  description:
    "Toggle full-power-risk mode — auto-approves git, installs, docker, etc. (supply-chain attacks still blocked)",
  usage: "/full-power-risk [on|off|status]",

  async execute(args: string[], _session: ReplSession): Promise<boolean> {
    const arg = args[0]?.toLowerCase();

    if (arg === "status") {
      printStatus();
      return false;
    }

    let newState: boolean;
    if (arg === "on") {
      newState = true;
    } else if (arg === "off") {
      newState = false;
    } else {
      newState = !isFullPowerRiskMode();
    }

    setFullPowerRiskMode(newState);
    saveFullPowerRiskPreference(newState).catch(() => {});

    console.log();
    if (newState) {
      printEnabled();
    } else {
      printDisabled();
    }
    console.log();

    return false;
  },
};

function printStatus(): void {
  const state = isFullPowerRiskMode();
  console.log();
  console.log(
    chalk.red.bold("  ⚡ full-power-risk: ") + (state ? chalk.red.bold("ON") : chalk.dim("OFF")),
  );
  console.log();
  if (state) {
    printEnabled();
  } else {
    printDisabled();
  }
  console.log();
}

function printEnabled(): void {
  console.log(chalk.red.bold("  ⚡ full-power-risk mode: ON"));
  console.log();
  console.log(chalk.dim("  Auto-approved (no prompts):"));
  console.log(chalk.green("  ✓ git push / rebase / merge / force-push"));
  console.log(chalk.green("  ✓ npm / pnpm / yarn install (including globals)"));
  console.log(chalk.green("  ✓ docker build / run / compose"));
  console.log(chalk.green("  ✓ curl / wget (without piping to shell)"));
  console.log(chalk.green("  ✓ background processes"));
  console.log();
  console.log(chalk.dim("  Still BLOCKED regardless:"));
  console.log(chalk.red("  ✗ rm -rf / (filesystem destruction)"));
  console.log(chalk.red("  ✗ curl | sh / wget | sh (supply-chain injection)"));
  console.log(chalk.red("  ✗ eval / backtick substitution"));
  console.log(chalk.red("  ✗ chmod 777 / chown root"));
  console.log(chalk.red("  ✗ dd to devices / mkfs (partition format)"));
  console.log(chalk.red("  ✗ Fork bombs / kernel tricks"));
  console.log();
  console.log(chalk.yellow.bold("  ⚠️  Use only in trusted projects with reviewed specs."));
  console.log(chalk.dim("  Type /full-power-risk off to disable."));
}

function printDisabled(): void {
  console.log(chalk.dim("  ⚡ full-power-risk mode: OFF"));
  console.log(
    chalk.dim("  Enable with /full-power-risk on for autonomous development (less prompts)."),
  );
}
