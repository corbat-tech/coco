/**
 * /thinking command — view or change the reasoning/thinking mode
 *
 * Usage:
 *   /thinking              — show current mode + available modes
 *   /thinking off          — disable thinking
 *   /thinking auto         — provider default / dynamic budget
 *   /thinking low          — minimal reasoning
 *   /thinking medium       — balanced reasoning
 *   /thinking high         — maximum reasoning
 *   /thinking 8000         — explicit token budget (Anthropic/Gemini only)
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import type { ThinkingMode } from "../../../providers/thinking.js";
import {
  getThinkingCapability,
  formatThinkingMode,
  resolveDefaultThinking,
} from "../../../providers/thinking.js";
import { saveThinkingPreference } from "../../../config/env.js";
import type { ProviderType } from "../../../providers/index.js";

const EFFORT_LEVELS = ["off", "auto", "low", "medium", "high"] as const;
type EffortLevel = (typeof EFFORT_LEVELS)[number];

function isEffortLevel(s: string): s is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(s);
}

function parseThinkingArg(arg: string): ThinkingMode | null {
  if (isEffortLevel(arg)) return arg;
  const n = parseInt(arg, 10);
  if (!isNaN(n) && n >= 0) return { budget: n };
  return null;
}

export const thinkingCommand: SlashCommand = {
  name: "thinking",
  aliases: ["think", "reason"],
  description: "View or change the reasoning/thinking mode for the current model",
  usage: "/thinking [off|auto|low|medium|high|<budget-tokens>]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const provider = session.config.provider.type;
    const model = session.config.provider.model;
    const capability = getThinkingCapability(provider, model);

    // ── Show current mode (no args) ─────────────────────────────────────────
    if (args.length === 0) {
      const current = session.config.provider.thinking;
      const display = current !== undefined ? formatThinkingMode(current) : "off";

      if (!capability.supported) {
        console.log(
          chalk.yellow(`\n⚠  Thinking not supported for ${model} on ${provider}.\n`) +
            chalk.dim(
              "   Compatible models: claude-3-7+, claude-4+, o3, o4-mini, gpt-5*, gemini-2.5+\n",
            ),
        );
        return false;
      }

      console.log(chalk.cyan.bold("\n═══ Thinking Mode ═══\n"));
      console.log(`  Current:  ${chalk.magenta(display)}`);
      console.log(`  Provider: ${chalk.dim(provider)} / ${chalk.dim(model)}`);
      console.log(`  Supports: ${capability.kinds.join(", ")}`);

      if (capability.budgetRange) {
        const { min, max, default: def } = capability.budgetRange;
        console.log(`  Budget range: ${chalk.dim(`${min}–${max} tokens (default ${def})`)}`);
      }

      console.log(`\n  ${chalk.dim("Available modes:")}`);
      for (const level of capability.levels) {
        const label = formatThinkingMode(level as ThinkingMode);
        const isCurrent = label === display;
        console.log(
          `    ${isCurrent ? chalk.green("→") : " "} ${isCurrent ? chalk.green(label) : chalk.dim(label)}`,
        );
      }

      if (capability.kinds.includes("budget")) {
        console.log(chalk.dim(`\n  You can also pass a token budget: /thinking 8000\n`));
      } else {
        console.log();
      }
      return false;
    }

    // ── Set mode ────────────────────────────────────────────────────────────
    const rawArg = args[0]!.toLowerCase();
    const parsed = parseThinkingArg(rawArg);

    if (parsed === null) {
      console.log(chalk.red(`\n✗ Unknown thinking mode: "${args[0]}"`));
      console.log(
        chalk.dim("  Valid options: off, auto, low, medium, high, or a token budget number\n"),
      );
      return false;
    }

    if (!capability.supported && parsed !== "off") {
      console.log(
        chalk.yellow(`\n⚠  Thinking not supported for ${model} on ${provider}.\n`) +
          chalk.dim(
            "   Compatible models: claude-3-7+, claude-4+, o3, o4-mini, gpt-5*, gemini-2.5+\n",
          ),
      );
      return false;
    }

    // Validate budget mode against effort-only providers
    if (typeof parsed === "object" && !capability.kinds.includes("budget")) {
      console.log(
        chalk.red(`\n✗ ${provider}/${model} uses effort levels, not token budgets.`) +
          chalk.dim("\n  Use: off, auto, low, medium, or high\n"),
      );
      return false;
    }

    // Validate budget range
    if (typeof parsed === "object" && capability.budgetRange) {
      const { min, max } = capability.budgetRange;
      if (parsed.budget < min || parsed.budget > max) {
        console.log(
          chalk.red(`\n✗ Budget ${parsed.budget} is out of range.`) +
            chalk.dim(`\n  Valid range for ${model}: ${min}–${max} tokens\n`),
        );
        return false;
      }
    }

    // Warn about Kimi + tool use
    if (
      (provider === "kimi" || provider === "kimi-code") &&
      parsed !== "off" &&
      parsed !== "auto"
    ) {
      console.log(
        chalk.yellow(
          "\n⚠  Enabling thinking on Kimi may cause issues with tool calling.\n" +
            "   If you experience errors, run /thinking off to restore default behavior.\n",
        ),
      );
    }

    const previousMode = session.config.provider.thinking;
    const newMode: ThinkingMode | undefined = parsed === "off" ? undefined : parsed;
    session.config.provider.thinking = newMode;

    // Persist for next session
    const modeToSave = newMode ?? resolveDefaultThinking(provider, model);
    await saveThinkingPreference(provider as ProviderType, modeToSave);

    const previousLabel = previousMode !== undefined ? formatThinkingMode(previousMode) : "off";
    const newLabel = newMode !== undefined ? formatThinkingMode(newMode) : "off";

    if (previousLabel === newLabel) {
      console.log(chalk.dim(`\n  Already using thinking: ${newLabel}\n`));
    } else {
      console.log(chalk.green(`\n✓ Thinking: ${previousLabel} → ${newLabel}\n`));
    }

    return false;
  },
};
