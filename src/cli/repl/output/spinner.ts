/**
 * Spinner for long operations using Ora
 * Ora handles concurrent stdout output gracefully
 */

import ora, { type Ora } from "ora";
import chalk from "chalk";

export type Spinner = {
  start(): void;
  stop(finalMessage?: string): void;
  /** Stop spinner and clear the line without printing any message */
  clear(): void;
  update(message: string): void;
  fail(message?: string): void;
  /** Update tool counter for multi-tool operations */
  setToolCount(current: number, total?: number): void;
};

/**
 * Create a spinner using Ora for smooth non-blocking output
 * Ora automatically handles writes to the same stream without corruption
 */
export function createSpinner(message: string): Spinner {
  let spinner: Ora | null = null;
  let currentMessage = message;
  let startTime: number | null = null;
  let toolCurrent = 0;
  let toolTotal: number | undefined;
  let elapsedInterval: NodeJS.Timeout | null = null;

  const formatToolCount = (): string => {
    if (toolCurrent <= 0) return "";
    if (toolTotal && toolTotal > 1) {
      return ` [${toolCurrent}/${toolTotal}]`;
    }
    if (toolCurrent > 1) {
      return ` [#${toolCurrent}]`;
    }
    return "";
  };

  const updateText = (): void => {
    if (!spinner) return;
    const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    const elapsedStr = elapsed > 0 ? chalk.dim(` (${elapsed}s)`) : "";
    const toolCountStr = formatToolCount();
    spinner.text = `${currentMessage}${toolCountStr}${elapsedStr}`;
  };

  return {
    start() {
      if (spinner) return;
      startTime = Date.now();

      spinner = ora({
        text: currentMessage,
        spinner: "dots",
        color: "cyan",
      }).start();

      // Update elapsed time every second
      elapsedInterval = setInterval(updateText, 1000);
    },

    stop(finalMessage?: string) {
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
        elapsedInterval = null;
      }
      if (spinner) {
        const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
        const elapsedStr = elapsed > 0 ? chalk.dim(` (${elapsed}s)`) : "";
        const toolCountStr = formatToolCount();
        spinner.succeed(`${finalMessage || currentMessage}${toolCountStr}${elapsedStr}`);
        spinner = null;
      }
      startTime = null;
    },

    clear() {
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
        elapsedInterval = null;
      }
      if (spinner) {
        spinner.stop();
        // Clear the line completely
        process.stdout.write("\r\x1b[K");
        spinner = null;
      }
      startTime = null;
    },

    update(newMessage: string) {
      currentMessage = newMessage;
      updateText();
    },

    fail(failMessage?: string) {
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
        elapsedInterval = null;
      }
      if (spinner) {
        const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
        const elapsedStr = elapsed > 0 ? chalk.dim(` (${elapsed}s)`) : "";
        const toolCountStr = formatToolCount();
        spinner.fail(`${failMessage || currentMessage}${toolCountStr}${elapsedStr}`);
        spinner = null;
      }
      startTime = null;
    },

    setToolCount(current: number, total?: number) {
      toolCurrent = current;
      toolTotal = total;
      updateText();
    },
  };
}
