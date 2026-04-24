/**
 * /thinking command — view or change the reasoning/thinking mode
 *
 * Usage:
 *   /thinking              — interactive selector (arrow keys)
 *   /thinking off          — disable thinking directly
 *   /thinking auto         — provider default / dynamic budget
 *   /thinking low|medium|high
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

/** Human-readable description for each mode level */
function modeDescription(mode: ThinkingMode, hasBudget: boolean): string {
  if (typeof mode === "object") return `${mode.budget} token budget`;
  const descs: Record<string, string> = {
    off: "No reasoning — fastest and cheapest",
    auto: hasBudget ? "Dynamic budget — provider decides" : "Provider default effort",
    low: hasBudget ? "~2 048 tokens — quick reasoning" : "Minimal effort",
    medium: hasBudget ? "~8 000 tokens — balanced" : "Balanced effort",
    high: hasBudget ? "~16 000 tokens — deep reasoning" : "Maximum effort",
  };
  return descs[mode] ?? mode;
}

/** Interactive arrow-key selector — returns chosen mode or null if cancelled */
async function selectThinkingInteractively(
  modes: readonly ThinkingMode[],
  currentMode: ThinkingMode,
  hasBudget: boolean,
): Promise<ThinkingMode | null> {
  const currentLabel = formatThinkingMode(currentMode);

  return new Promise((resolve) => {
    let selectedIndex = modes.findIndex((m) => formatThinkingMode(m) === currentLabel);
    if (selectedIndex === -1) selectedIndex = 0;

    let lastTotalLines = 0;

    const clearPrevious = () => {
      if (lastTotalLines === 0) return;
      process.stdout.write("\x1b[2K\r");
      for (let i = 0; i < lastTotalLines; i++) {
        process.stdout.write("\x1b[1A\x1b[2K");
      }
      process.stdout.write("\r");
    };

    const renderMenu = () => {
      clearPrevious();
      let totalLines = 0;

      for (let i = 0; i < modes.length; i++) {
        const mode = modes[i]!;
        const label = formatThinkingMode(mode);
        const isCurrent = label === currentLabel;
        const isSelected = i === selectedIndex;
        const desc = modeDescription(mode, hasBudget);

        let line = "";
        if (isSelected) {
          line = chalk.bgBlue.white(` ▶ ${label.padEnd(8)}`) + chalk.bgBlue.white(` ${desc} `);
        } else if (isCurrent) {
          line = chalk.green(` ● ${label.padEnd(8)}`) + chalk.dim(` ${desc}`);
        } else {
          line = chalk.dim(` ○ ${label.padEnd(8)}`) + chalk.dim(` ${desc}`);
        }

        process.stdout.write(line + "\n");
        totalLines++;
      }

      process.stdout.write("\n" + chalk.dim("↑/↓ navigate • Enter select • Esc cancel") + "\n");
      totalLines += 2;

      lastTotalLines = totalLines;
    };

    const cleanup = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onKeyPress);
    };

    const onKeyPress = (data: Buffer) => {
      const key = data.toString();

      // Enter
      if (key === "\r" || key === "\n") {
        clearPrevious();
        cleanup();
        resolve(modes[selectedIndex] ?? null);
        return;
      }

      // Esc / q / ctrl-c
      if (key === "\x1b" || key === "q" || key === "\x03") {
        clearPrevious();
        cleanup();
        resolve(null);
        return;
      }

      // Up arrow
      if (key === "\x1b[A") {
        selectedIndex = (selectedIndex - 1 + modes.length) % modes.length;
        renderMenu();
        return;
      }

      // Down arrow
      if (key === "\x1b[B") {
        selectedIndex = (selectedIndex + 1) % modes.length;
        renderMenu();
        return;
      }
    };

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onKeyPress);

    renderMenu();
  });
}

async function applyMode(
  parsed: ThinkingMode,
  session: ReplSession,
  provider: string,
  model: string,
): Promise<void> {
  const capability = getThinkingCapability(provider, model);

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

  const modeToSave = newMode ?? resolveDefaultThinking(provider, model);
  await saveThinkingPreference(provider as ProviderType, modeToSave);

  const previousLabel = previousMode !== undefined ? formatThinkingMode(previousMode) : "off";
  const newLabel = newMode !== undefined ? formatThinkingMode(newMode) : "off";

  if (previousLabel === newLabel) {
    console.log(chalk.dim(`\n  Already using thinking: ${newLabel}\n`));
  } else {
    const kindLabel = capability.kinds.includes("budget") ? "budget" : "effort";
    console.log(chalk.green(`\n✓ Thinking (${kindLabel}): ${previousLabel} → ${newLabel}\n`));
  }
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

    // ── Unsupported model ────────────────────────────────────────────────────
    if (!capability.supported) {
      console.log(
        chalk.yellow(`\n⚠  Thinking not supported for ${model} on ${provider}.\n`) +
          chalk.dim(
            "   Compatible models: claude-3-7+, claude-4+, o3, o4-mini, gpt-5*, gemini-2.5+\n",
          ),
      );
      return false;
    }

    const hasBudget = capability.kinds.includes("budget");
    const current = session.config.provider.thinking;
    const currentMode: ThinkingMode = current ?? "off";

    // ── Interactive selector (no args) ───────────────────────────────────────
    if (args.length === 0) {
      console.log(chalk.cyan.bold("\n═══ Thinking Mode ═══\n"));
      console.log(
        `  ${chalk.dim(provider + "/")}${chalk.cyan(model)}` +
          `  ${chalk.dim("·")}  kind: ${chalk.dim(capability.kinds.join(", "))}`,
      );
      if (hasBudget && capability.budgetRange) {
        const { min, max } = capability.budgetRange;
        console.log(chalk.dim(`  Budget range: ${min}–${max} tokens  (/thinking 8000 for custom)\n`));
      } else {
        console.log();
      }

      const selected = await selectThinkingInteractively(capability.levels, currentMode, hasBudget);

      if (selected === null) {
        console.log(chalk.dim("  Cancelled\n"));
        return false;
      }

      await applyMode(selected, session, provider, model);
      return false;
    }

    // ── Direct argument ──────────────────────────────────────────────────────
    const rawArg = args[0]!.toLowerCase();
    const parsed = parseThinkingArg(rawArg);

    if (parsed === null) {
      console.log(chalk.red(`\n✗ Unknown thinking mode: "${args[0]}"`));
      console.log(
        chalk.dim("  Valid options: off, auto, low, medium, high, or a token budget number\n"),
      );
      return false;
    }

    // Validate budget mode against effort-only providers
    if (typeof parsed === "object" && !hasBudget) {
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

    await applyMode(parsed, session, provider, model);
    return false;
  },
};
