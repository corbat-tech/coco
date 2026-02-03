/**
 * Spinner for long operations
 */

import chalk from "chalk";

export type Spinner = {
  start(): void;
  stop(finalMessage?: string): void;
  update(message: string): void;
  fail(message?: string): void;
  /** Update tool counter for multi-tool operations */
  setToolCount(current: number, total?: number): void;
};

/**
 * Create a spinner for showing progress
 */
export function createSpinner(message: string): Spinner {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let interval: NodeJS.Timeout | null = null;
  let currentMessage = message;
  let startTime: number | null = null;
  let toolCurrent = 0;
  let toolTotal: number | undefined;

  const formatToolCount = (): string => {
    if (toolCurrent <= 0) return "";
    if (toolTotal && toolTotal > 1) {
      return chalk.dim(` [${toolCurrent}/${toolTotal}]`);
    }
    if (toolCurrent > 1) {
      return chalk.dim(` [#${toolCurrent}]`);
    }
    return "";
  };

  return {
    start() {
      if (interval) return;
      startTime = Date.now();
      interval = setInterval(() => {
        const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
        const elapsedStr = elapsed > 0 ? chalk.dim(` (${elapsed}s)`) : "";
        const toolCountStr = formatToolCount();
        process.stdout.write(
          `\r\x1b[K${chalk.cyan(frames[frameIndex])} ${currentMessage}${toolCountStr}${elapsedStr}`
        );
        frameIndex = (frameIndex + 1) % frames.length;
      }, 120); // 120ms = ~8 FPS, sufficient for human perception
    },

    stop(finalMessage?: string) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
      const elapsedStr = elapsed > 0 ? chalk.dim(` (${elapsed}s)`) : "";
      const toolCountStr = formatToolCount();
      process.stdout.write(
        `\r\x1b[K${chalk.green("✓")} ${finalMessage || currentMessage}${toolCountStr}${elapsedStr}\n`
      );
      startTime = null;
    },

    update(newMessage: string) {
      currentMessage = newMessage;
    },

    fail(failMessage?: string) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
      const elapsedStr = elapsed > 0 ? chalk.dim(` (${elapsed}s)`) : "";
      const toolCountStr = formatToolCount();
      process.stdout.write(
        `\r\x1b[K${chalk.red("✗")} ${failMessage || currentMessage}${toolCountStr}${elapsedStr}\n`
      );
      startTime = null;
    },

    setToolCount(current: number, total?: number) {
      toolCurrent = current;
      toolTotal = total;
    },
  };
}
