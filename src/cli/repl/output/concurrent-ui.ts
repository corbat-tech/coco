/**
 * Concurrent UI - Unified rendering for spinner + bottom input prompt
 *
 * Uses log-update for atomic frame-based rendering. This ensures spinner
 * and input prompt never interfere with each other.
 *
 * Architecture:
 * - Centralized UI state (spinner message + input line)
 * - Single render loop updates entire screen atomically
 * - Input capture in raw mode (concurrent with rendering)
 * - LED indicator shows working status
 *
 * @module cli/repl/output/concurrent-ui
 */

import logUpdate from "log-update";
import chalk from "chalk";
import * as readline from "node:readline";

interface UIState {
  // Spinner state
  spinnerActive: boolean;
  spinnerMessage: string;
  spinnerFrame: number;
  elapsedSeconds: number;

  // Input prompt state
  inputActive: boolean;
  inputLine: string;
  working: boolean; // LED color
  ledFrame: number;

  // Callbacks
  onInputLine: ((line: string) => void) | null;
}

const state: UIState = {
  spinnerActive: false,
  spinnerMessage: "",
  spinnerFrame: 0,
  elapsedSeconds: 0,

  inputActive: false,
  inputLine: "",
  working: false,
  ledFrame: 0,

  onInputLine: null,
};

// Spinner frames (coconut bouncing)
const SPINNER_FRAMES = ["🥥    ", " 🥥   ", "  🥥  ", "   🥥 ", "    🥥", "   🥥 ", "  🥥  ", " 🥥   "];

// LED animation frames
const LED_WORKING = ["🔴", "🟠", "🟡"];
const LED_IDLE = "🟢";

let renderInterval: NodeJS.Timeout | null = null;
let startTime: number | null = null;
let inputHandler: ((chunk: Buffer) => void) | null = null;
let rl: readline.Interface | null = null;

/**
 * Render the complete UI (spinner + input prompt)
 */
function render(): void {
  const lines: string[] = [];

  // Render spinner if active
  if (state.spinnerActive) {
    const frame = SPINNER_FRAMES[state.spinnerFrame % SPINNER_FRAMES.length];
    const elapsed = state.elapsedSeconds > 0 ? chalk.dim(` (${state.elapsedSeconds}s)`) : "";
    lines.push(`${frame} ${chalk.magenta(state.spinnerMessage)}${elapsed}`);
  }

  // Render input prompt if active
  if (state.inputActive) {
    const termCols = process.stdout.columns || 80;
    const led = state.working ? LED_WORKING[state.ledFrame % LED_WORKING.length] : LED_IDLE;

    // Add spacing if spinner is also active
    if (state.spinnerActive) {
      lines.push(""); // Blank line separator
    }

    lines.push(chalk.dim("─".repeat(termCols)));
    lines.push(`${led} ${chalk.magenta("[coco]")} › ${state.inputLine}${chalk.dim("_")}`);
    lines.push(chalk.dim("─".repeat(termCols)));
  }

  // Atomic update (replaces previous frame)
  logUpdate(lines.join("\n"));
}

/**
 * Start the unified render loop
 */
function startRenderLoop(): void {
  if (renderInterval) return;

  renderInterval = setInterval(() => {
    // Update spinner animation
    if (state.spinnerActive) {
      state.spinnerFrame++;
    }

    // Update LED animation
    if (state.inputActive && state.working) {
      state.ledFrame++;
    }

    // Update elapsed time
    if (state.spinnerActive && startTime) {
      state.elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    }

    render();
  }, 100); // 100ms for smooth animations
}

/**
 * Stop the render loop
 */
function stopRenderLoop(): void {
  if (renderInterval) {
    clearInterval(renderInterval);
    renderInterval = null;
  }
}

/**
 * Start spinner
 */
export function startSpinner(message: string): void {
  state.spinnerActive = true;
  state.spinnerMessage = message;
  state.spinnerFrame = 0;
  state.elapsedSeconds = 0;
  startTime = Date.now();

  startRenderLoop();
  render();
}

/**
 * Update spinner message
 */
export function updateSpinner(message: string): void {
  state.spinnerMessage = message;
  render();
}

/**
 * Stop spinner
 */
export function stopSpinner(): void {
  state.spinnerActive = false;
  startTime = null;

  if (!state.inputActive) {
    stopRenderLoop();
    logUpdate.clear(); // Clear everything if no input either
  } else {
    render(); // Re-render without spinner
  }
}

/**
 * Clear spinner immediately
 */
export function clearSpinner(): void {
  stopSpinner();
}

/**
 * Start concurrent input prompt
 */
export function startConcurrentInput(onLine: (line: string) => void): void {
  if (state.inputActive) return;

  state.inputActive = true;
  state.inputLine = "";
  state.working = true;
  state.ledFrame = 0;
  state.onInputLine = onLine;

  // Enable raw mode for char-by-char input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.setEncoding("utf8");
  process.stdin.resume();

  // Input handler
  inputHandler = (chunk: Buffer) => {
    const char = chunk.toString();

    // Enter - submit line
    if (char === "\r" || char === "\n") {
      const line = state.inputLine.trim();
      if (line && state.onInputLine) {
        state.onInputLine(line);
      }
      state.inputLine = "";
      render();
      return;
    }

    // Backspace
    if (char === "\x7f" || char === "\b") {
      if (state.inputLine.length > 0) {
        state.inputLine = state.inputLine.slice(0, -1);
        render();
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
      state.inputLine += char;
      render();
    }
  };

  process.stdin.on("data", inputHandler);

  // Create readline interface (for cleanup)
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  startRenderLoop();
  render();
}

/**
 * Stop concurrent input
 */
export function stopConcurrentInput(): void {
  if (!state.inputActive) return;

  state.inputActive = false;
  state.inputLine = "";
  state.onInputLine = null;

  // Remove input handler
  if (inputHandler) {
    process.stdin.removeListener("data", inputHandler);
    inputHandler = null;
  }

  // Close readline
  if (rl) {
    rl.close();
    rl = null;
  }

  // Disable raw mode
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  if (!state.spinnerActive) {
    stopRenderLoop();
    logUpdate.done(); // Persist final frame and move to next line
  } else {
    render(); // Re-render without input
  }
}

/**
 * Set working state (changes LED color)
 */
export function setWorking(working: boolean): void {
  state.working = working;
  if (!working) {
    state.ledFrame = 0;
  }
  render();
}

/**
 * Show immediate feedback that user message was captured
 * Stops render loop, shows message, restarts render loop
 */
export function showMessageCaptured(message: string): void {
  // Stop render loop temporarily
  stopRenderLoop();

  // Clear current frame
  logUpdate.clear();

  // Show feedback message using regular console.log
  console.log(chalk.dim("💬 You: ") + chalk.cyan(`"${message}"`));
  console.log(); // Blank line for spacing

  // Restart render loop and re-render current state
  startRenderLoop();
  render();
}

/**
 * Check if concurrent UI is active
 */
export function isActive(): boolean {
  return state.spinnerActive || state.inputActive;
}
