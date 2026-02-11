/**
 * Concurrent Input Handler - Capture input while spinner is active
 *
 * Renders a persistent input prompt (identical to normal REPL prompt) at the bottom,
 * with a working LED indicator showing COCO's status (working vs idle).
 *
 * @module cli/repl/input/concurrent-input
 */

import * as readline from "node:readline";
import chalk from "chalk";
import ansiEscapes from "ansi-escapes";

interface ConcurrentInputState {
  rl: readline.Interface | null;
  currentLine: string;
  onLine: ((line: string) => void) | null;
  active: boolean;
  working: boolean; // Is COCO working?
  ledFrame: number; // LED animation frame
  renderInterval: NodeJS.Timeout | null;
}

const state: ConcurrentInputState = {
  rl: null,
  currentLine: "",
  onLine: null,
  active: false,
  working: false,
  ledFrame: 0,
  renderInterval: null,
};

// LED animation frames (working state)
const LED_WORKING = ["🔴", "🟠", "🟡"]; // Pulsing red/orange/yellow
// LED when idle
const LED_IDLE = "🟢"; // Green - ready

/**
 * Render the bottom input prompt (identical to normal REPL prompt)
 */
function renderBottomPrompt(): void {
  if (!state.active) return;

  // Skip rendering if not a TTY (e.g., during tests)
  if (!process.stdout.isTTY || !process.stdout.rows) return;

  const termCols = process.stdout.columns || 80;
  const termRows = process.stdout.rows;

  // Get LED indicator
  const led = state.working ? LED_WORKING[state.ledFrame % LED_WORKING.length] : LED_IDLE;

  // Build prompt (identical to normal REPL)
  const topSeparator = chalk.dim("─".repeat(termCols));
  const promptLine = `${led} ${chalk.magenta("[coco]")} › ${state.currentLine}${chalk.dim("_")}`;
  const bottomSeparator = chalk.dim("─".repeat(termCols));

  // Save cursor position, move to bottom, render, restore cursor
  const output =
    ansiEscapes.cursorSavePosition +
    ansiEscapes.cursorTo(0, termRows - 3) +
    ansiEscapes.eraseDown +
    topSeparator +
    "\n" +
    promptLine +
    "\n" +
    bottomSeparator +
    ansiEscapes.cursorRestorePosition;

  process.stdout.write(output);
}

/**
 * Start capturing concurrent input
 */
export function startConcurrentInput(onLine: (line: string) => void): void {
  if (state.active) return;

  state.active = true;
  state.working = true; // Start in working mode
  state.onLine = onLine;
  state.currentLine = "";
  state.ledFrame = 0;

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
      renderBottomPrompt(); // Re-render immediately
      return;
    }

    // Backspace
    if (char === "\x7f" || char === "\b") {
      if (state.currentLine.length > 0) {
        state.currentLine = state.currentLine.slice(0, -1);
        renderBottomPrompt(); // Re-render immediately
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
      renderBottomPrompt(); // Re-render immediately
    }
  };

  process.stdin.on("data", handler);
  (process.stdin as any)._concurrentInputHandler = handler;

  // Start render interval (for LED animation only, not for input)
  state.renderInterval = setInterval(() => {
    if (state.working) {
      state.ledFrame++;
    }
    renderBottomPrompt();
  }, 300); // 300ms LED animation

  // Initial render
  renderBottomPrompt();
}

/**
 * Stop capturing concurrent input and clear bottom prompt
 */
export function stopConcurrentInput(): void {
  if (!state.active) return;

  state.active = false;
  state.working = false;
  state.onLine = null;
  state.currentLine = "";

  // Stop render interval
  if (state.renderInterval) {
    clearInterval(state.renderInterval);
    state.renderInterval = null;
  }

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

  // Clear bottom prompt (erase last 3 lines) - only if TTY
  if (process.stdout.isTTY && process.stdout.rows) {
    process.stdout.write(
      ansiEscapes.cursorTo(0, process.stdout.rows - 3) + ansiEscapes.eraseDown,
    );
  }
}

/**
 * Set working state (changes LED color)
 */
export function setWorking(working: boolean): void {
  state.working = working;
  if (!working) {
    state.ledFrame = 0; // Reset animation when idle
  }
}

/**
 * Check if concurrent input is active
 */
export function isConcurrentInputActive(): boolean {
  return state.active;
}
