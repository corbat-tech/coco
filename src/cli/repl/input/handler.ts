/**
 * Input Handler for REPL
 *
 * Provides readline-based input with the following features:
 * - Command history persistence (~/.coco/history)
 * - Inline ghost-text autocompletion (like Claude Code/VS Code)
 * - Dropdown menu showing matching commands
 * - Tab to accept completion
 * - Full cursor movement (arrows, Home/End, Ctrl+A/E)
 * - Line editing (Ctrl+U/K/W, Delete, insert at cursor)
 * - Word navigation (Option+Left/Right)
 * - Text paste support (Cmd+V / bracketed paste mode)
 * - Image paste from clipboard (Ctrl+V)
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
import { getAllCommands, setPendingImage, hasPendingImage } from "../commands/index.js";
import { isCocoMode } from "../coco-mode.js";
import { readClipboardImage } from "../output/clipboard.js";

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
 * Find the start of the previous word boundary from cursor position.
 * Skips whitespace first, then skips word characters.
 */
function findPrevWordBoundary(line: string, pos: number): number {
  let i = pos - 1;
  // Skip whitespace
  while (i > 0 && line[i - 1] === " ") i--;
  // Skip word characters
  while (i > 0 && line[i - 1] !== " ") i--;
  return Math.max(0, i);
}

/**
 * Find the end of the next word boundary from cursor position.
 * Skips word characters first, then skips whitespace.
 */
function findNextWordBoundary(line: string, pos: number): number {
  let i = pos;
  // Skip word characters
  while (i < line.length && line[i] !== " ") i++;
  // Skip whitespace
  while (i < line.length && line[i] === " ") i++;
  return i;
}

/**
 * Create readline-based input handler with ghost-text completion and dropdown
 */
export function createInputHandler(_session: ReplSession): InputHandler {
  const savedHistory = loadHistory();
  const sessionHistory: string[] = [...savedHistory];

  let closed = false;
  let currentLine = "";
  let cursorPos = 0;
  let completions: Array<{ cmd: string; desc: string }> = [];
  let selectedCompletion = 0;
  let historyIndex = -1;
  let tempLine = "";
  let lastMenuLines = 0;

  // Bracketed paste mode state
  let isPasting = false;
  let pasteBuffer = "";

  // Clipboard image read state (Ctrl+V)
  let isReadingClipboard = false;

  // Prompt changes dynamically based on COCO mode
  // Visual length must be tracked separately from ANSI-colored string
  const getPrompt = () => {
    const imageIndicator = hasPendingImage() ? chalk.cyan(" \u{1F4CE} 1 image") : "";
    const imageIndicatorLen = hasPendingImage() ? 10 : 0; // " 📎 1 image" = 10 visible chars (📎=2)

    if (isCocoMode()) {
      return {
        str: "\u{1F965} " + chalk.magenta("[coco]") + " \u203A " + imageIndicator,
        // 🥥=2 + space=1 + [coco]=6 + space=1 + ›=1 + space=1 = 12 + image indicator
        visualLen: 12 + imageIndicatorLen,
      };
    }
    return {
      str: chalk.green("\u{1F965} \u203A ") + imageIndicator,
      // 🥥=2 + space=1 + ›=1 + space=1 = 5 + image indicator
      visualLen: 5 + imageIndicatorLen,
    };
  };
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
   * Uses eraseDown to clear everything below cursor before redrawing.
   * Handles multi-line wrapping by moving cursor up to the first wrapped line.
   */
  function render() {
    const termCols = process.stdout.columns || 80;
    const prompt = getPrompt();

    // Calculate how many terminal lines the previous prompt+text occupied
    // so we can move up to clear all wrapped lines
    const totalVisualLen = prompt.visualLen + currentLine.length;
    const wrappedLines = Math.max(0, Math.ceil(totalVisualLen / termCols) - 1);

    // Move cursor up to the first line of the prompt, then clear everything
    if (wrappedLines > 0) {
      process.stdout.write(ansiEscapes.cursorUp(wrappedLines));
    }
    process.stdout.write("\r" + ansiEscapes.eraseDown);

    // Build separator line above input area
    const separator = chalk.dim("\u2500".repeat(termCols));
    let output = separator + "\n";

    // Write prompt + current line
    output += prompt.str + currentLine;

    // Update completions
    completions = findCompletions(currentLine);
    selectedCompletion = Math.min(selectedCompletion, Math.max(0, completions.length - 1));

    // Show ghost text from selected completion (only when cursor is at the end)
    if (
      cursorPos === currentLine.length &&
      completions.length > 0 &&
      completions[selectedCompletion]
    ) {
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
        output += chalk.dim(`  \u2191 ${startIndex} more above`);
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
        output += chalk.dim(`  \u2193 ${completions.length - endIndex} more below`);
        lastMenuLines++;
      }

      // Add bottom margin below menu, then move cursor back to prompt line
      for (let i = 0; i < BOTTOM_MARGIN; i++) {
        output += "\n";
      }
      // +1 for the separator line we added above the prompt
      output += ansiEscapes.cursorUp(lastMenuLines + BOTTOM_MARGIN + 1);
    } else {
      lastMenuLines = 0;

      // Add bottom margin below prompt, then move cursor back
      for (let i = 0; i < BOTTOM_MARGIN; i++) {
        output += "\n";
      }
      // +1 for the separator line
      output += ansiEscapes.cursorUp(BOTTOM_MARGIN + 1);
    }

    // Account for the separator line: cursor is now on the separator line.
    // Move down 1 to the prompt line.
    output += ansiEscapes.cursorDown(1);

    // Position cursor correctly within the input, accounting for wrapping
    const cursorAbsolutePos = prompt.visualLen + cursorPos;
    const finalLine = Math.floor(cursorAbsolutePos / termCols);
    const finalCol = cursorAbsolutePos % termCols;

    output += "\r";
    if (finalLine > 0) {
      output += ansiEscapes.cursorDown(finalLine);
    }
    if (finalCol > 0) {
      output += ansiEscapes.cursorForward(finalCol);
    }

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

  /**
   * Insert text at current cursor position.
   * Handles both single characters and multi-character paste.
   * Collapses newlines into spaces for single-line input.
   * Strips non-printable control characters.
   */
  function insertTextAtCursor(text: string): void {
    // Replace newlines/carriage returns with spaces (single-line input)
    const cleaned = text.replace(/[\r\n]+/g, " ");
    // Filter out non-printable control characters (keep space and above, including Unicode)
    const printable = cleaned.replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, "");

    if (printable.length === 0) return;

    currentLine = currentLine.slice(0, cursorPos) + printable + currentLine.slice(cursorPos);
    cursorPos += printable.length;
    selectedCompletion = 0;
    render();
  }

  return {
    async prompt(): Promise<string | null> {
      if (closed) return null;

      return new Promise((resolve) => {
        currentLine = "";
        cursorPos = 0;
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

        // Enable bracketed paste mode — terminal will wrap pasted text
        // between \x1b[200~ and \x1b[201~ markers
        process.stdout.write("\x1b[?2004h");

        const cleanup = () => {
          // Disable bracketed paste mode
          process.stdout.write("\x1b[?2004l");
          process.stdin.removeListener("data", onData);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          clearMenu();
        };

        const onData = (data: Buffer) => {
          const key = data.toString();

          // --- Bracketed paste handling ---
          // Modern terminals wrap pasted text in \x1b[200~ ... \x1b[201~ markers
          if (key.includes("\x1b[200~")) {
            isPasting = true;
            // Extract content after the paste-start marker
            const afterMarker = key.split("\x1b[200~").slice(1).join("");
            // Check if paste-end marker is in the same chunk
            if (afterMarker.includes("\x1b[201~")) {
              const pastedText = afterMarker.split("\x1b[201~")[0] ?? "";
              isPasting = false;
              pasteBuffer = "";
              insertTextAtCursor(pastedText);
            } else {
              pasteBuffer = afterMarker;
            }
            return;
          }

          // Accumulate data during bracketed paste
          if (isPasting) {
            if (key.includes("\x1b[201~")) {
              // End of paste
              const beforeMarker = key.split("\x1b[201~")[0] ?? "";
              pasteBuffer += beforeMarker;
              const pastedText = pasteBuffer;
              isPasting = false;
              pasteBuffer = "";
              insertTextAtCursor(pastedText);
            } else {
              pasteBuffer += key;
            }
            return;
          }
          // --- End bracketed paste handling ---

          // Ctrl+C - exit
          if (key === "\x03") {
            cleanup();
            console.log("\n\u{1F44B} Goodbye!");
            saveHistory(sessionHistory);
            process.exit(0);
          }

          // Ctrl+D - exit if line is empty, else delete char at cursor
          if (key === "\x04") {
            if (currentLine.length === 0) {
              cleanup();
              console.log("\n\u{1F44B} Goodbye!");
              saveHistory(sessionHistory);
              process.exit(0);
            }
            // Delete character at cursor (forward delete)
            if (cursorPos < currentLine.length) {
              currentLine = currentLine.slice(0, cursorPos) + currentLine.slice(cursorPos + 1);
              selectedCompletion = 0;
              render();
            }
            return;
          }

          // Ctrl+A - move cursor to beginning of line
          if (key === "\x01") {
            cursorPos = 0;
            render();
            return;
          }

          // Ctrl+E - move cursor to end of line
          if (key === "\x05") {
            cursorPos = currentLine.length;
            render();
            return;
          }

          // Ctrl+U - delete from beginning to cursor
          if (key === "\x15") {
            currentLine = currentLine.slice(cursorPos);
            cursorPos = 0;
            selectedCompletion = 0;
            render();
            return;
          }

          // Ctrl+K - delete from cursor to end
          if (key === "\x0b") {
            currentLine = currentLine.slice(0, cursorPos);
            selectedCompletion = 0;
            render();
            return;
          }

          // Ctrl+W - delete previous word
          if (key === "\x17") {
            if (cursorPos > 0) {
              const newPos = findPrevWordBoundary(currentLine, cursorPos);
              currentLine = currentLine.slice(0, newPos) + currentLine.slice(cursorPos);
              cursorPos = newPos;
              selectedCompletion = 0;
              render();
            }
            return;
          }

          // Ctrl+V (\x16) - paste image from clipboard
          if (key === "\x16") {
            if (isReadingClipboard) return;
            isReadingClipboard = true;

            // Visual feedback while reading clipboard
            const promptInfo = getPrompt();
            process.stdout.write("\r" + ansiEscapes.eraseDown);
            process.stdout.write(
              promptInfo.str + currentLine + chalk.dim(" \u{1F4CB} reading clipboard\u2026"),
            );

            readClipboardImage()
              .then((imageData) => {
                isReadingClipboard = false;

                if (!imageData) {
                  // No image -> brief feedback, then restore prompt
                  process.stdout.write("\r" + ansiEscapes.eraseDown);
                  process.stdout.write(
                    promptInfo.str + currentLine + chalk.yellow(" \u26A0 no image in clipboard"),
                  );
                  setTimeout(() => render(), 1500);
                  return;
                }

                const sizeKB = Math.round((imageData.data.length * 3) / 4 / 1024);
                const imagePrompt =
                  currentLine.trim() ||
                  "Describe this image in detail. If it's code or a UI, identify the key elements.";

                setPendingImage(imageData.data, imageData.media_type, imagePrompt);

                // Success feedback - brief message, then restore prompt with image indicator
                const truncatedPrompt =
                  imagePrompt.length > 40 ? imagePrompt.slice(0, 40) + "\u2026" : imagePrompt;
                process.stdout.write("\r" + ansiEscapes.eraseDown);
                process.stdout.write(
                  chalk.green("  \u2713 Image captured") +
                    chalk.dim(` (${sizeKB} KB)`) +
                    chalk.dim(` \u2014 "${truncatedPrompt}"`),
                );

                // Restore the prompt after brief feedback -- user presses Enter to submit
                setTimeout(() => render(), 1200);
              })
              .catch((err: unknown) => {
                isReadingClipboard = false;
                // Suppress JP2/JPEG2000 color space errors silently
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes("color space")) {
                  render();
                  return;
                }
                render();
              });

            return;
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
            // Print closing separator after submission
            const termWidth = process.stdout.columns || 80;
            console.log(); // New line after input
            console.log(chalk.dim("\u2500".repeat(termWidth)));
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
              cursorPos = currentLine.length;
              render();
            }
            return;
          }

          // Backspace - delete character before cursor
          if (key === "\x7f" || key === "\b") {
            if (cursorPos > 0) {
              currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
              cursorPos--;
              selectedCompletion = 0;
              render();
            }
            return;
          }

          // Delete key (fn+backspace on Mac) - delete character at cursor
          if (key === "\x1b[3~") {
            if (cursorPos < currentLine.length) {
              currentLine = currentLine.slice(0, cursorPos) + currentLine.slice(cursorPos + 1);
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
              cursorPos = currentLine.length;
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
              cursorPos = currentLine.length;
              render();
            }
            return;
          }

          // Right arrow - navigate horizontally, accept ghost char, or move cursor
          if (key === "\x1b[C") {
            if (completions.length > 1) {
              // Navigate completions horizontally (move right one column)
              selectedCompletion = (selectedCompletion + 1) % completions.length;
              render();
            } else if (
              cursorPos === currentLine.length &&
              completions.length > 0 &&
              completions[selectedCompletion]
            ) {
              // Accept one character of ghost text (cursor at end)
              const fullCmd = completions[selectedCompletion]!.cmd;
              if (currentLine.length < fullCmd.length) {
                currentLine = fullCmd.slice(0, currentLine.length + 1);
                cursorPos = currentLine.length;
                render();
              }
            } else if (cursorPos < currentLine.length) {
              // Move cursor right within line
              cursorPos++;
              render();
            }
            return;
          }

          // Left arrow - navigate horizontally or move cursor
          if (key === "\x1b[D") {
            if (completions.length > 1) {
              // Navigate completions horizontally (move left one column)
              selectedCompletion =
                (selectedCompletion - 1 + completions.length) % completions.length;
              render();
            } else if (cursorPos > 0) {
              // Move cursor left within line
              cursorPos--;
              render();
            }
            return;
          }

          // Home key - move cursor to beginning
          if (key === "\x1b[H" || key === "\x1bOH") {
            cursorPos = 0;
            render();
            return;
          }

          // End key - move cursor to end
          if (key === "\x1b[F" || key === "\x1bOF") {
            cursorPos = currentLine.length;
            render();
            return;
          }

          // Option+Left (Alt+Left) - move cursor one word left
          // macOS sends \x1bb (ESC b) or \x1b[1;3D
          if (key === "\x1bb" || key === "\x1b[1;3D") {
            cursorPos = findPrevWordBoundary(currentLine, cursorPos);
            render();
            return;
          }

          // Option+Right (Alt+Right) - move cursor one word right
          // macOS sends \x1bf (ESC f) or \x1b[1;3C
          if (key === "\x1bf" || key === "\x1b[1;3C") {
            cursorPos = findNextWordBoundary(currentLine, cursorPos);
            render();
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

          // Regular character input or non-bracketed paste
          // Handles both single chars and multi-character paste from terminals
          // that don't support bracketed paste mode
          if (key.charCodeAt(0) >= 32) {
            insertTextAtCursor(key);
          }
        };

        process.stdin.on("data", onData);
      });
    },

    close(): void {
      if (!closed) {
        closed = true;
        // Disable bracketed paste mode on close
        process.stdout.write("\x1b[?2004l");
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
