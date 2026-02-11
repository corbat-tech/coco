/**
 * Concurrent Input Handler - Capture input while spinner is active
 *
 * Uses readline interface in raw mode to capture keystrokes without
 * interfering with ora spinner output.
 *
 * @module cli/repl/input/concurrent-input
 */

import * as readline from "node:readline";
import chalk from "chalk";

interface ConcurrentInputState {
  rl: readline.Interface | null;
  currentLine: string;
  onLine: ((line: string) => void) | null;
  active: boolean;
}

const state: ConcurrentInputState = {
  rl: null,
  currentLine: "",
  onLine: null,
  active: false,
};

/**
 * Start capturing concurrent input
 * Returns the prompt text to show in spinner suffix
 */
export function startConcurrentInput(onLine: (line: string) => void): string {
  if (state.active) return "";

  state.active = true;
  state.onLine = onLine;
  state.currentLine = "";

  // Create readline interface in raw mode
  state.rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false, // Don't let readline write to stdout
  });

  // Enable raw mode for char-by-char input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.setEncoding("utf8");

  // Handle data events manually
  const handler = (chunk: Buffer) => {
    if (!state.active) return;

    const char = chunk.toString();

    // Enter key - submit line
    if (char === "\r" || char === "\n") {
      const line = state.currentLine.trim();
      if (line && state.onLine) {
        state.onLine(line);
      }
      state.currentLine = "";
      return;
    }

    // Backspace
    if (char === "\x7f" || char === "\b") {
      if (state.currentLine.length > 0) {
        state.currentLine = state.currentLine.slice(0, -1);
      }
      return;
    }

    // Ctrl+C - ignore (handled by main REPL)
    if (char === "\x03") {
      return;
    }

    // Ignore escape sequences
    if (char.startsWith("\x1b")) {
      return;
    }

    // Regular character
    if (char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126) {
      state.currentLine += char;
    }
  };

  process.stdin.on("data", handler);
  (process.stdin as any)._concurrentInputHandler = handler;

  // Return prompt text
  return chalk.dim("› ") + chalk.dim(state.currentLine || "_");
}

/**
 * Stop capturing concurrent input
 */
export function stopConcurrentInput(): void {
  if (!state.active) return;

  state.active = false;
  state.onLine = null;
  state.currentLine = "";

  // Remove handler
  const handler = (process.stdin as any)._concurrentInputHandler;
  if (handler) {
    process.stdin.removeListener("data", handler);
    delete (process.stdin as any)._concurrentInputHandler;
  }

  // Close readline
  if (state.rl) {
    state.rl.close();
    state.rl = null;
  }

  // Disable raw mode
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
}

/**
 * Get current input line (for updating spinner suffix)
 */
export function getCurrentInputLine(): string {
  if (!state.active) return "";
  return chalk.dim("› ") + chalk.cyan(state.currentLine || "_");
}

/**
 * Update spinner suffix with current input
 */
export function getInputPromptText(): string {
  if (!state.active) return "";

  const prompt = chalk.dim("Type to interrupt");
  const line = state.currentLine;

  if (line.length > 0) {
    return `${prompt} ${chalk.dim("›")} ${chalk.cyan(line)}${chalk.dim("_")}`;
  }

  return `${prompt} ${chalk.dim("› _")}`;
}
