/**
 * Spinner for long operations using Ora
 * Ora handles concurrent stdout output gracefully
 *
 * Brand color: Magenta/Purple 🟣
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
  /** Get elapsed seconds since start (0 if not started) */
  getElapsed(): number;
};

/**
 * Custom coco spinner frames - a bouncing coconut! 🥥
 */
const COCO_SPINNER = {
  interval: 120,
  frames: ["🥥    ", " 🥥   ", "  🥥  ", "   🥥 ", "    🥥", "   🥥 ", "  🥥  ", " 🥥   "],
};

/**
 * Alternative spinners (exported for potential future use)
 */
export const SPINNERS = {
  coco: COCO_SPINNER,
  brain: {
    interval: 150,
    frames: ["🧠", "💭", "💡", "✨", "🧠", "💭", "💡", "⚡"],
  },
  face: {
    interval: 200,
    frames: ["(◠‿◠)", "(◠‿◕)", "(◕‿◕)", "(◕‿◠)", "(◠‿◠)", "(●‿●)", "(◠‿◠)", "(◕‿◕)"],
  },
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
    spinner.text = chalk.magenta(`${currentMessage}${toolCountStr}`) + elapsedStr;
  };

  return {
    start() {
      if (spinner) return;
      startTime = Date.now();

      spinner = ora({
        text: chalk.magenta(currentMessage),
        spinner: COCO_SPINNER,
        color: "magenta",
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
        // Use ora's built-in clear method which properly handles terminal state
        // Then additionally clear the line to avoid artifacts in all terminal types
        spinner.stop();
        // Clear the current line and any extra lines the spinner may have used
        process.stdout.write("\r\x1b[K");
        // Move up and clear additional lines if text was multi-line
        const textContent = spinner.text || "";
        const lineCount = textContent.split("\n").length;
        for (let i = 1; i < lineCount; i++) {
          process.stdout.write("\x1b[1A\x1b[2K");
        }
        process.stdout.write("\r");
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

    getElapsed(): number {
      return startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    },
  };
}
