/**
 * @deprecated Use the new concurrent input system instead:
 * - `src/cli/repl/input/concurrent-capture-v2.ts` — Raw mode capture
 * - `src/cli/repl/input/message-queue.ts` — Message queue
 * - `src/cli/repl/interruptions/classifier.ts` — Interruption classification
 * - `src/cli/repl/interruptions/processor.ts` — Interruption processing
 * - `src/cli/repl/feedback/feedback-system.ts` — Visual feedback
 *
 * This legacy handler used readline which conflicted with Ora spinner.
 * Kept for reference only. See ADR-007 for migration rationale.
 *
 * @module cli/repl/interruption-handler
 */

import readline from "node:readline";
import chalk from "chalk";

/**
 * Queued user interruption
 */
interface QueuedInterruption {
  message: string;
  timestamp: number;
}

/**
 * Global queue of interruptions
 */
let interruptions: QueuedInterruption[] = [];

/**
 * Readline interface for non-blocking input
 */
let rl: readline.Interface | null = null;

/**
 * Check if there are pending interruptions
 */
export function hasInterruptions(): boolean {
  return interruptions.length > 0;
}

/**
 * Get and clear all pending interruptions
 */
export function consumeInterruptions(): string[] {
  const messages = interruptions.map((i) => i.message);
  interruptions = [];
  return messages;
}

/**
 * Start listening for user interruptions during agent processing
 */
export function startInterruptionListener(): void {
  if (rl) {
    return; // Already listening
  }

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false, // Non-blocking mode
  });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed) {
      interruptions.push({
        message: trimmed,
        timestamp: Date.now(),
      });

      // Show feedback that input was received
      console.log(
        chalk.dim("\n  ↳ ") +
          chalk.cyan("Additional context queued") +
          chalk.dim(": ") +
          chalk.white(trimmed.slice(0, 60)) +
          (trimmed.length > 60 ? chalk.dim("...") : "") +
          "\n",
      );
    }
  });
}

/**
 * Stop listening for interruptions
 */
export function stopInterruptionListener(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

/**
 * Format interruptions for display to the agent
 */
export function formatInterruptionsForAgent(interruptions: string[]): string {
  if (interruptions.length === 0) {
    return "";
  }

  const header = "\n## User provided additional context while you were working:\n";
  const items = interruptions.map((msg, i) => `${i + 1}. ${msg}`).join("\n");

  return header + items + "\n\nPlease incorporate this feedback into your current work.\n";
}
