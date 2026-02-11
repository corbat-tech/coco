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
 * This renders OUTSIDE the scrolling region, so it's always visible
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

  // Render at fixed position (last 3 lines), outside scroll region
  // Don't save/restore cursor - just position at bottom and write
  const promptStart = termRows - 3;
  const output =
    ansiEscapes.cursorTo(0, promptStart) +
    topSeparator +
    "\n" +
    promptLine +
    "\n" +
    bottomSeparator;

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

  // Set scrolling region to exclude bottom 3 lines (for persistent prompt)
  if (process.stdout.isTTY && process.stdout.rows) {
    const scrollEnd = process.stdout.rows - 4; // Leave 4 lines (3 for prompt + 1 margin)
    process.stdout.write(`\x1b[1;${scrollEnd}r`); // Set scroll region from line 1 to scrollEnd
    process.stdout.write(ansiEscapes.cursorTo(0, 0)); // Move cursor to top
  }

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

  // Clear bottom prompt and reset scrolling region
  if (process.stdout.isTTY && process.stdout.rows) {
    // Clear bottom prompt (erase last 3 lines)
    process.stdout.write(
      ansiEscapes.cursorTo(0, process.stdout.rows - 3) + ansiEscapes.eraseDown,
    );

    // Reset scrolling region to full screen
    process.stdout.write("\x1b[r"); // Reset scroll region
    process.stdout.write(ansiEscapes.cursorTo(0, 0)); // Move cursor to top
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
