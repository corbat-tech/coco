/**
 * Feedback system for concurrent input capture
 *
 * Provides visual confirmation to the user when a message is captured
 * during agent execution, without interfering with the Ora spinner.
 *
 * Strategy: Temporarily update the spinner text to show a capture
 * confirmation, then restore the original text after a short delay.
 * This leverages Ora's own rendering, avoiding direct stdout manipulation.
 *
 * @module cli/repl/feedback/feedback-system
 */

import chalk from "chalk";
import type { Spinner } from "../output/spinner.js";
import type { FeedbackConfig } from "./types.js";
import type { QueuedMessage } from "../input/types.js";

/** Default feedback configuration */
const DEFAULT_FEEDBACK_CONFIG: FeedbackConfig = {
  method: "spinner",
  displayDurationMs: 2000,
  bell: false,
};

/**
 * Create a feedback system instance
 *
 * @param getSpinner - Function that returns the current active spinner (or null)
 * @param config - Optional feedback configuration
 * @returns Feedback system controller
 */
export function createFeedbackSystem(
  getSpinner: () => Spinner | null,
  config?: Partial<FeedbackConfig>,
) {
  const cfg: FeedbackConfig = { ...DEFAULT_FEEDBACK_CONFIG, ...config };

  let restoreTimer: NodeJS.Timeout | null = null;
  let previousSpinnerMessage: string | null = null;
  let queueCount = 0;

  /**
   * Clear any pending restore timer
   */
  function clearRestoreTimer(): void {
    if (restoreTimer) {
      clearTimeout(restoreTimer);
      restoreTimer = null;
    }
  }

  return {
    /**
     * Show feedback that a message was captured
     *
     * @param message - The captured message
     * @param currentSpinnerMessage - The current spinner message to restore later
     */
    notifyCapture(message: QueuedMessage, currentSpinnerMessage: string): void {
      queueCount++;
      const spinner = getSpinner();

      if (cfg.bell) {
        process.stdout.write("\x07");
      }

      if (!spinner) return;

      // Store original message for restoration (only if not already stored)
      if (previousSpinnerMessage === null) {
        previousSpinnerMessage = currentSpinnerMessage;
      }

      // Truncate message preview
      const preview =
        message.text.length > 50 ? message.text.slice(0, 50) + "\u2026" : message.text;

      // Format feedback: show queued indicator + message preview
      const feedbackText =
        chalk.cyan(`\u21B3 Queued`) +
        (queueCount > 1 ? chalk.dim(` (${queueCount})`) : "") +
        chalk.dim(": ") +
        chalk.white(preview);

      spinner.update(feedbackText);

      // Schedule restoration of original spinner message
      clearRestoreTimer();
      restoreTimer = setTimeout(() => {
        restoreTimer = null;
        const currentSpinner = getSpinner();
        if (currentSpinner && previousSpinnerMessage !== null) {
          currentSpinner.update(previousSpinnerMessage);
        }
      }, cfg.displayDurationMs);
    },

    /**
     * Update the stored spinner message (call when spinner text changes externally)
     */
    updateSpinnerMessage(message: string): void {
      previousSpinnerMessage = message;
    },

    /**
     * Reset the feedback system (call between agent turns)
     */
    reset(): void {
      clearRestoreTimer();
      previousSpinnerMessage = null;
      queueCount = 0;
    },

    /**
     * Cleanup (call on shutdown)
     */
    dispose(): void {
      clearRestoreTimer();
    },
  };
}

/** Type alias for the feedback system instance */
export type FeedbackSystem = ReturnType<typeof createFeedbackSystem>;
