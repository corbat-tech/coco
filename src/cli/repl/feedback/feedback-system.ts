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
import { InterruptionAction } from "../interruptions/types.js";

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
     * Show action-specific feedback after the user selects an action
     * from the action selector menu.
     *
     * @param action - The selected action
     * @param message - The original message text
     * @param currentSpinnerMessage - Current spinner text for restoration
     */
    notifyAction(action: InterruptionAction, message: string, currentSpinnerMessage: string): void {
      const spinner = getSpinner();

      if (cfg.bell) {
        process.stdout.write("\x07");
      }

      if (!spinner) return;

      if (previousSpinnerMessage === null) {
        previousSpinnerMessage = currentSpinnerMessage;
      }

      const preview = message.length > 40 ? message.slice(0, 37) + "\u2026" : message;

      let feedbackText: string;
      switch (action) {
        case InterruptionAction.Modify:
          feedbackText = chalk.yellow("\u26A1 Modificando: ") + chalk.white(preview);
          break;
        case InterruptionAction.Queue:
          feedbackText = chalk.cyan("\uD83D\uDCCB Encolado: ") + chalk.white(preview);
          break;
        case InterruptionAction.Abort:
          feedbackText = chalk.red("\u23F9 Abortando\u2026");
          break;
        default:
          feedbackText = chalk.dim("Procesando\u2026");
      }

      spinner.update(feedbackText);

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
