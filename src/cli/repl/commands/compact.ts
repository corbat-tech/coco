/**
 * /compact command — Manual context compaction trigger
 *
 * Usage:
 *   /compact                     — Compact context now
 *   /compact focus on <topic>    — Compact preserving details about a topic
 *   /compact verbose             — Toggle verbose/compact output mode
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";

/** Track compact mode state for verbose output toggling */
let compactMode = false;

export function isCompactMode(): boolean {
  return compactMode;
}

/**
 * Parse focus topic from args like ["focus", "on", "auth", "changes"]
 */
function parseFocusTopic(args: string[]): string | undefined {
  const lower = args.map((a) => a.toLowerCase());
  const focusIdx = lower.indexOf("focus");
  if (focusIdx === -1) return undefined;

  // Skip optional "on" after "focus"
  let startIdx = focusIdx + 1;
  if (lower[startIdx] === "on") startIdx++;

  const topic = args.slice(startIdx).join(" ").trim();
  return topic || undefined;
}

export const compactCommand: SlashCommand = {
  name: "compact",
  aliases: [],
  description: "Compact context (summarize older messages to save tokens)",
  usage: "/compact [focus on <topic>] | /compact verbose",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    // /compact verbose — toggle verbose output mode (legacy behavior)
    if (args[0]?.toLowerCase() === "verbose") {
      compactMode = !compactMode;
      if (compactMode) {
        console.log(chalk.dim("Compact mode: ON (less verbose output)\n"));
      } else {
        console.log(chalk.dim("Compact mode: OFF (normal output)\n"));
      }
      return false;
    }

    // /compact [focus on <topic>] — trigger manual compaction
    const focusTopic = parseFocusTopic(args);

    // We need the context manager to get the compactor and provider
    if (!session.contextManager) {
      console.log(chalk.yellow("Context manager not initialized. Cannot compact.\n"));
      return false;
    }

    // Access compactor and provider from the context manager
    const compactor = (session.contextManager as any)._compactor;
    const provider = (session.contextManager as any)._provider;

    if (!compactor || !provider) {
      console.log(chalk.yellow("Compactor or provider not available.\n"));
      return false;
    }

    const msgCount = session.messages.length;
    if (msgCount <= 4) {
      console.log(chalk.dim("Not enough messages to compact (need > 4).\n"));
      return false;
    }

    if (focusTopic) {
      console.log(chalk.cyan(`Compacting context (preserving focus: "${focusTopic}")...\n`));
    } else {
      console.log(chalk.cyan("Compacting context...\n"));
    }

    try {
      const result = await compactor.compact(session.messages, provider, {
        focusTopic,
      });

      if (!result.wasCompacted) {
        console.log(chalk.dim("Nothing to compact.\n"));
        return false;
      }

      // Replace session messages with compacted version
      session.messages.length = 0;
      // Skip system messages from compacted result (they're regenerated each turn)
      const nonSystemMessages = result.messages.filter((m: any) => m.role !== "system");
      session.messages.push(...nonSystemMessages);

      const saved = result.originalTokens - result.compactedTokens;
      const pct = Math.round((saved / result.originalTokens) * 100);

      console.log(chalk.green(`Context compacted successfully!`));
      console.log(chalk.dim(`  Before: ~${result.originalTokens} tokens`));
      console.log(chalk.dim(`  After:  ~${result.compactedTokens} tokens`));
      console.log(chalk.dim(`  Saved:  ~${saved} tokens (${pct}%)`));
      if (focusTopic) {
        console.log(chalk.dim(`  Focus:  "${focusTopic}" details preserved`));
      }
      console.log();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`Compaction failed: ${msg}\n`));
    }

    return false;
  },
};
