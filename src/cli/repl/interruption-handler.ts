/**
 * Interruption Handler - Allow user to provide additional context during agent thinking
 *
 * This module allows users to type additional instructions while the agent is processing,
 * which will be queued and incorporated into the next agent turn.
 */

import readline from "node:readline";
import chalk from "chalk";

/**
 * Queued user interruption
 */
export interface QueuedInterruption {
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
export function consumeInterruptions(): QueuedInterruption[] {
  const pending = [...interruptions];
  interruptions = [];
  return pending;
}

/**
 * Callback for background capture - adds interruptions to queue
 * Use with inputHandler.enableBackgroundCapture()
 */
export function handleBackgroundLine(line: string): void {
  const trimmed = line.trim();
  if (trimmed) {
    interruptions.push({
      message: trimmed,
      timestamp: Date.now(),
    });

    // Show feedback that input was received
    console.log(
      chalk.dim("  ↳ ") +
        chalk.cyan("Context queued") +
        chalk.dim(": ") +
        chalk.white(trimmed.slice(0, 60)) +
        (trimmed.length > 60 ? chalk.dim("...") : ""),
    );
  }
}

/**
 * Start listening for user interruptions during agent processing
 * @deprecated Use inputHandler.enableBackgroundCapture(handleBackgroundLine) instead
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
    handleBackgroundLine(line);
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
