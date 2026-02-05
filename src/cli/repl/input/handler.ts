/**
 * Input Handler for REPL
 *
 * Provides readline-based input with the following features:
 * - Command history persistence (~/.coco/history)
 * - Inline ghost-text autocompletion (like Claude Code/VS Code)
 * - Dropdown menu showing matching commands
 * - Tab to accept completion
 * - Graceful Ctrl+C/Ctrl+D handling
 *
 * @module cli/repl/input/handler
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import chalk from "chalk";
import ansiEscapes from "ansi-escapes";
import type { ReplSession } from "../types.js";
import { getAllCommands } from "../commands/index.js";

/**
 * Input handler interface for REPL
 */
export interface InputHandler {
  prompt(): Promise<string | null>;
  close(): void;
  /** Pause input during agent processing to prevent interference */
  pause(): void;
  /** Resume input after agent processing */
  resume(): void;
}

/** History file location */
const HISTORY_FILE = path.join(os.homedir(), ".coco", "history");

/**
 * Load history from file
 */
function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(HISTORY_FILE, "utf-8");
      return content.split("\n").filter(Boolean).slice(-500);
    }
  } catch {
    // Ignore errors loading history
  }
  return [];
}

/**
 * Save history to file
 */
function saveHistory(history: string[]): void {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const toSave = history.slice(-500);
    fs.writeFileSync(HISTORY_FILE, toSave.join("\n") + "\n");
  } catch {
    // Ignore errors saving history
  }
}

/**
 * Get all slash command completions
 */
function getSlashCommands(): Array<{ cmd: string; desc: string }> {
  const commands = getAllCommands();
  const result: Array<{ cmd: string; desc: string }> = [];

  for (const cmd of commands) {
    result.push({ cmd: "/" + cmd.name, desc: cmd.description });
  }

  return result.sort((a, b) => a.cmd.localeCompare(b.cmd));
}

/**
 * Find matching completions for current input
 */
function findCompletions(line: string): Array<{ cmd: string; desc: string }> {
  if (!line.startsWith("/")) return [];

  const commands = getSlashCommands();
  const lowerLine = line.toLowerCase();

  return commands.filter(({ cmd }) => cmd.toLowerCase().startsWith(lowerLine));
}

/**
 * Create readline-based input handler with ghost-text completion and dropdown
 */
export function createInputHandler(_session: ReplSession): InputHandler {
  const savedHistory = loadHistory();
  const sessionHistory: string[] = [...savedHistory];

  let closed = false;
  let currentLine = "";
  let completions: Array<{ cmd: string; desc: string }> = [];
  let selectedCompletion = 0;
  let historyIndex = -1;
  let tempLine = "";
  let lastMenuLines = 0;

  const promptStr = "🥥 › ";
  const MAX_ROWS = 8;
  /** Bottom margin: push prompt up from terminal edge */
  const BOTTOM_MARGIN = 1;
  const ITEM_WIDTH = 28; // Width for each column item (command + padding)

  /**
   * Calculate number of columns based on terminal width
   */
  function getColumnCount(): number {
    const termWidth = process.stdout.columns || 80;
    const availableWidth = termWidth - 4; // Leave some margin
    const cols = Math.floor(availableWidth / ITEM_WIDTH);
    return Math.max(1, Math.min(3, cols)); // Between 1 and 3 columns
  }

  /**
   * Render the current line with ghost text and dropdown menu
   * Uses eraseDown to clear everything below cursor before redrawing
   */
  function render() {
    // Move to column 0, clear from cursor to end of screen (clears line + menu below)
    process.stdout.write("\r" + ansiEscapes.eraseDown);

    // Write prompt + current line
    let output = chalk.green(promptStr) + currentLine;

    // Update completions
    completions = findCompletions(currentLine);
    selectedCompletion = Math.min(selectedCompletion, Math.max(0, completions.length - 1));

    // Show ghost text from selected completion
    if (completions.length > 0 && completions[selectedCompletion]) {
      const ghost = completions[selectedCompletion]!.cmd.slice(currentLine.length);
      if (ghost) {
        output += chalk.dim.gray(ghost);
      }
    }

    // Draw dropdown menu if we have completions
    const showMenu =
      completions.length > 0 && currentLine.startsWith("/") && currentLine.length >= 1;

    if (showMenu) {
      const cols = getColumnCount();
      const maxVisibleItems = MAX_ROWS * cols;

      // Calculate visible window that follows the selection
      let startIndex = 0;
      let endIndex = Math.min(completions.length, maxVisibleItems);

      // If selection is beyond visible window, scroll to show it
      if (selectedCompletion >= endIndex) {
        // Scroll so selection is in the last row
        const selectedRow = Math.floor(selectedCompletion / cols);
        const startRow = Math.max(0, selectedRow - MAX_ROWS + 1);
        startIndex = startRow * cols;
        endIndex = Math.min(completions.length, startIndex + maxVisibleItems);
      }

      const visibleItems = completions.slice(startIndex, endIndex);
      const rowCount = Math.ceil(visibleItems.length / cols);
      lastMenuLines = rowCount;

      // Show scroll indicator at top if there are items above
      if (startIndex > 0) {
        output += "\n";
        output += chalk.dim(`  ↑ ${startIndex} more above`);
        lastMenuLines++;
      }

      // Render items in columns (items flow left-to-right, top-to-bottom)
      for (let row = 0; row < rowCount; row++) {
        output += "\n";

        for (let col = 0; col < cols; col++) {
          const itemIndex = row * cols + col;
          if (itemIndex >= visibleItems.length) break;

          const item = visibleItems[itemIndex]!;
          const actualIndex = startIndex + itemIndex;
          const isSelected = actualIndex === selectedCompletion;

          // Format: "  /command" padded to ITEM_WIDTH
          const text = `  ${item.cmd}`.padEnd(ITEM_WIDTH);

          if (isSelected) {
            output += chalk.bgBlue.white(text);
          } else {
            output += chalk.cyan(text);
          }
        }
      }

      // Show scroll indicator at bottom if there are items below
      if (endIndex < completions.length) {
        output += "\n";
        output += chalk.dim(`  ↓ ${completions.length - endIndex} more below`);
        lastMenuLines++;
      }

      // Add bottom margin below menu, then move cursor back to prompt line
      for (let i = 0; i < BOTTOM_MARGIN; i++) {
        output += "\n";
      }
      output += ansiEscapes.cursorUp(lastMenuLines + BOTTOM_MARGIN);
    } else {
      lastMenuLines = 0;

      // Add bottom margin below prompt, then move cursor back
      for (let i = 0; i < BOTTOM_MARGIN; i++) {
        output += "\n";
      }
      output += ansiEscapes.cursorUp(BOTTOM_MARGIN);
    }

    // Move cursor to end of actual input (after prompt, after typed text, before ghost)
    output += `\r${ansiEscapes.cursorForward(promptStr.length + currentLine.length)}`;

    // Write everything at once
    process.stdout.write(output);
  }

  /**
   * Clear the menu before exiting or submitting
   */
  function clearMenu() {
    // Always erase below to clear menu and/or bottom margin
    process.stdout.write(ansiEscapes.eraseDown);
    lastMenuLines = 0;
  }

  return {
    async prompt(): Promise<string | null> {
      if (closed) return null;

      return new Promise((resolve) => {
        currentLine = "";
        completions = [];
        selectedCompletion = 0;
        historyIndex = -1;
        tempLine = "";
        lastMenuLines = 0;

        // Initial render
        render();

        // Enable raw mode for keypress detection
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdin.resume();

        const cleanup = () => {
          process.stdin.removeListener("data", onData);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          clearMenu();
        };

        const onData = (data: Buffer) => {
          const key = data.toString();

          // Ctrl+C - exit
          if (key === "\x03") {
            cleanup();
            console.log("\n👋 Goodbye!");
            saveHistory(sessionHistory);
            process.exit(0);
          }

          // Ctrl+D - exit if line is empty
          if (key === "\x04") {
            if (currentLine.length === 0) {
              cleanup();
              console.log("\n👋 Goodbye!");
              saveHistory(sessionHistory);
              process.exit(0);
            }
          }

          // Enter - submit line or accept completion
          if (key === "\r" || key === "\n") {
            // If we have a completion and user typed a partial command, accept it
            if (
              completions.length > 0 &&
              completions[selectedCompletion] &&
              currentLine.startsWith("/")
            ) {
              currentLine = completions[selectedCompletion]!.cmd;
            }

            cleanup();
            console.log(); // New line after input
            const result = currentLine.trim();
            if (result) {
              sessionHistory.push(result);
            }
            resolve(result || null);
            return;
          }

          // Tab - accept ghost completion
          if (key === "\t") {
            if (completions.length > 0 && completions[selectedCompletion]) {
              currentLine = completions[selectedCompletion]!.cmd;
              render();
            }
            return;
          }

          // Backspace
          if (key === "\x7f" || key === "\b") {
            if (currentLine.length > 0) {
              currentLine = currentLine.slice(0, -1);
              selectedCompletion = 0;
              render();
            }
            return;
          }

          // Up arrow - navigate completions vertically or history
          if (key === "\x1b[A") {
            if (completions.length > 1) {
              // Navigate completions vertically (move up one row)
              const cols = getColumnCount();
              const currentRow = Math.floor(selectedCompletion / cols);
              const currentCol = selectedCompletion % cols;

              if (currentRow > 0) {
                // Move to same column in row above
                selectedCompletion = (currentRow - 1) * cols + currentCol;
              } else {
                // Wrap to bottom row, same column (or last item if column doesn't exist)
                const totalRows = Math.ceil(completions.length / cols);
                const targetIndex = (totalRows - 1) * cols + currentCol;
                selectedCompletion = Math.min(targetIndex, completions.length - 1);
              }
              render();
            } else if (sessionHistory.length > 0 && completions.length === 0) {
              // Navigate history only if no completions
              if (historyIndex === -1) {
                tempLine = currentLine;
                historyIndex = sessionHistory.length - 1;
              } else if (historyIndex > 0) {
                historyIndex--;
              }
              currentLine = sessionHistory[historyIndex] ?? "";
              render();
            }
            return;
          }

          // Down arrow - navigate completions vertically or history
          if (key === "\x1b[B") {
            if (completions.length > 1) {
              // Navigate completions vertically (move down one row)
              const cols = getColumnCount();
              const currentRow = Math.floor(selectedCompletion / cols);
              const currentCol = selectedCompletion % cols;
              const totalRows = Math.ceil(completions.length / cols);

              if (currentRow < totalRows - 1) {
                // Move to same column in row below (or last item if column doesn't exist)
                const targetIndex = (currentRow + 1) * cols + currentCol;
                selectedCompletion = Math.min(targetIndex, completions.length - 1);
              } else {
                // Wrap to top row, same column
                selectedCompletion = currentCol;
              }
              render();
            } else if (historyIndex !== -1 && completions.length === 0) {
              // Navigate history only if no completions
              if (historyIndex < sessionHistory.length - 1) {
                historyIndex++;
                currentLine = sessionHistory[historyIndex] ?? "";
              } else {
                historyIndex = -1;
                currentLine = tempLine;
              }
              render();
            }
            return;
          }

          // Right arrow - navigate horizontally or accept ghost character
          if (key === "\x1b[C") {
            if (completions.length > 1) {
              // Navigate completions horizontally (move right one column)
              selectedCompletion = (selectedCompletion + 1) % completions.length;
              render();
            } else if (completions.length > 0 && completions[selectedCompletion]) {
              // Accept one character of ghost text
              const fullCmd = completions[selectedCompletion]!.cmd;
              if (currentLine.length < fullCmd.length) {
                currentLine = fullCmd.slice(0, currentLine.length + 1);
                render();
              }
            }
            return;
          }

          // Left arrow - navigate horizontally
          if (key === "\x1b[D") {
            if (completions.length > 1) {
              // Navigate completions horizontally (move left one column)
              selectedCompletion =
                (selectedCompletion - 1 + completions.length) % completions.length;
              render();
            }
            return;
          }

          // Escape - clear completions menu
          if (key === "\x1b" && data.length === 1) {
            if (lastMenuLines > 0) {
              clearMenu();
              completions = [];
              render();
            }
            return;
          }

          // Ignore other escape sequences
          if (key.startsWith("\x1b")) {
            return;
          }

          // Regular character input
          if (key.length === 1 && key >= " ") {
            currentLine += key;
            selectedCompletion = 0; // Reset selection on new input
            render();
          }
        };

        process.stdin.on("data", onData);
      });
    },

    close(): void {
      if (!closed) {
        closed = true;
        saveHistory(sessionHistory);
      }
    },

    pause(): void {
      // Pause stdin to prevent input during agent processing
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    },

    resume(): void {
      // Resume stdin for next prompt
      // Note: raw mode will be re-enabled by prompt()
    },
  };
}
