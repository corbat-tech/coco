/**
 * Concurrent Input Capture - Simple stdin capture during agent execution
 *
 * Design philosophy:
 * - Keep it SIMPLE - no fancy UI, just capture input
 * - Independent of spinner - Ora handles its own output
 * - When user types and presses Enter, call callback
 * - Show simple feedback that message was captured
 *
 * @module cli/repl/input/concurrent-capture
 */

import * as readline from "node:readline";
import chalk from "chalk";

interface CaptureState {
  rl: readline.Interface | null;
  currentLine: string;
  onLine: ((line: string) => void) | null;
  active: boolean;
  inputHandler: ((chunk: Buffer) => void) | null;
}

const state: CaptureState = {
  rl: null,
  currentLine: "",
  onLine: null,
  active: false,
  inputHandler: null,
};

/**
 * Start capturing concurrent input (invisible, no UI)
 * When user types and presses Enter, the callback is invoked
 */
export function startConcurrentCapture(onLine: (line: string) => void): void {
  if (state.active) return;

  state.active = true;
  state.onLine = onLine;
  state.currentLine = "";

  // Enable raw mode for char-by-char input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.setEncoding("utf8");
  process.stdin.resume();

  // Input handler - accumulate characters, trigger on Enter
  state.inputHandler = (chunk: Buffer) => {
    if (!state.active) return;

    const char = chunk.toString();

    // Enter - submit line
    if (char === "\r" || char === "\n") {
      const line = state.currentLine.trim();
      if (line && state.onLine) {
        // Show immediate feedback
        console.log(chalk.dim("💬 You: ") + chalk.cyan(`"${line}"`));
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

    // Ignore escape sequences (arrow keys, etc.)
    if (char.startsWith("\x1b")) {
      return;
    }

    // Regular character (including UTF-8 multibyte)
    const firstCharCode = char.charCodeAt(0);
    if ((firstCharCode >= 32 && firstCharCode <= 126) || firstCharCode > 127) {
      state.currentLine += char;
    }
  };

  process.stdin.on("data", state.inputHandler);

  // Create readline interface (for cleanup)
  state.rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
}

/**
 * Stop capturing concurrent input
 */
export function stopConcurrentCapture(): void {
  if (!state.active) return;

  state.active = false;
  state.currentLine = "";
  state.onLine = null;

  // Remove input handler
  if (state.inputHandler) {
    process.stdin.removeListener("data", state.inputHandler);
    state.inputHandler = null;
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
 * Check if concurrent capture is active
 */
export function isConcurrentCaptureActive(): boolean {
  return state.active;
}
