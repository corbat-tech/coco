/**
 * Inline Action Selector for Concurrent Input
 *
 * Shows a lightweight menu when the user presses Enter during agent execution.
 * Uses raw mode keypresses (no readline) to avoid conflicts with Ora spinner.
 *
 * The menu is rendered by clearing the spinner line and writing directly to
 * stdout. After selection, the spinner is restored.
 *
 * @module cli/repl/input/action-selector
 */

import chalk from "chalk";
import { InterruptionAction, InterruptionType } from "../interruptions/types.js";
import type { Spinner } from "../output/spinner.js";

// Re-export for convenience
export { InterruptionAction };

/**
 * Result from the action selector
 */
export interface ActionSelectorResult {
  /** The selected action */
  action: InterruptionAction;
  /** The original message text */
  message: string;
}

/**
 * Configuration for the action selector
 */
export interface ActionSelectorConfig {
  /** Timeout in ms to auto-select if no input is received (default: 10000) */
  timeoutMs: number;
}

const DEFAULT_CONFIG: ActionSelectorConfig = {
  timeoutMs: 10_000,
};

/** Menu option definition */
interface MenuOption {
  key: string;
  label: string;
  icon: string;
  action: InterruptionAction;
}

const MENU_OPTIONS: MenuOption[] = [
  { key: "1", label: "Modificar", icon: "\u26A1", action: InterruptionAction.Modify },
  { key: "2", label: "Encolar", icon: "\uD83D\uDCCB", action: InterruptionAction.Queue },
  { key: "3", label: "Abortar", icon: "\u23F9", action: InterruptionAction.Abort },
];

/** Number of lines the menu occupies */
const MENU_LINE_COUNT = 2;

/**
 * Render the action menu as a string (always exactly MENU_LINE_COUNT lines)
 *
 * @param message - The captured message to display
 * @param selectedIndex - Currently highlighted option index
 * @returns The rendered menu string (2 lines, no trailing newline)
 */
function renderMenu(message: string, selectedIndex: number): string {
  // Truncate message to 60 chars
  const preview = message.length > 60 ? message.slice(0, 57) + "\u2026" : message;

  const messageLine = chalk.dim("  \u201C") + chalk.white(preview) + chalk.dim("\u201D");

  const optionParts = MENU_OPTIONS.map((opt, i) => {
    const text = `[${opt.key}] ${opt.icon} ${opt.label}`;
    if (i === selectedIndex) {
      return chalk.bgBlue.white.bold(` ${text} `);
    }
    return chalk.dim(`  ${text} `);
  });

  const optionsLine = "  " + optionParts.join(" ");

  return `${messageLine}\n${optionsLine}`;
}

/**
 * Clear N lines from the current cursor position upward.
 * Moves cursor up N-1 times (since we're on the last line),
 * clearing each line as we go, then clears the final line.
 */
function clearLines(count: number): void {
  // Clear current line first
  process.stdout.write("\x1b[2K\r");
  // Move up and clear remaining lines
  for (let i = 1; i < count; i++) {
    process.stdout.write("\x1b[1A\x1b[2K");
  }
  process.stdout.write("\r");
}

/**
 * Show the inline action selector and wait for user choice.
 *
 * IMPORTANT: The caller must suspend concurrent capture before calling this
 * function, and resume it after. This function manages its own stdin listener.
 *
 * @param message - The captured message text
 * @param preselected - The pre-selected action based on keyword classification
 * @param spinner - The active spinner to clear/restore (can be null)
 * @param config - Optional configuration
 * @returns Promise resolving to the selected action, or null if dismissed
 */
export function showActionSelector(
  message: string,
  preselected: InterruptionAction,
  spinner: Spinner | null,
  config?: Partial<ActionSelectorConfig>,
): Promise<ActionSelectorResult | null> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Find the pre-selected index
  let selectedIndex = MENU_OPTIONS.findIndex((o) => o.action === preselected);
  if (selectedIndex < 0) selectedIndex = 0;

  return new Promise<ActionSelectorResult | null>((resolve) => {
    let resolved = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    // Clear spinner completely and render menu
    if (spinner) {
      spinner.clear();
    }
    // Write menu with a trailing newline so the cursor is on a fresh line below
    process.stdout.write(renderMenu(message, selectedIndex) + "\n");

    // Enable raw mode for keypress detection
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    /**
     * Re-render the menu in-place: move up to overwrite the existing menu,
     * clear lines, and write the new version.
     */
    const rerender = () => {
      clearLines(MENU_LINE_COUNT + 1); // +1 for the empty line after menu
      process.stdout.write(renderMenu(message, selectedIndex) + "\n");
    };

    const cleanup = () => {
      if (resolved) return;
      resolved = true;

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      process.stdin.removeListener("data", onData);

      // Clean up the menu from screen
      clearLines(MENU_LINE_COUNT + 1);
    };

    const resolveWith = (action: InterruptionAction | null) => {
      cleanup();
      if (action === null) {
        resolve(null);
      } else {
        resolve({ action, message });
      }
    };

    const onData = (data: Buffer) => {
      if (resolved) return;
      const key = data.toString("utf-8");
      const code = key.charCodeAt(0);

      // Number keys 1-3: immediate selection
      if (key === "1" || key === "2" || key === "3") {
        const index = parseInt(key, 10) - 1;
        resolveWith(MENU_OPTIONS[index]!.action);
        return;
      }

      // Enter: confirm current selection
      if (key === "\r" || key === "\n") {
        resolveWith(MENU_OPTIONS[selectedIndex]!.action);
        return;
      }

      // Escape: dismiss
      if (code === 0x1b && key.length === 1) {
        resolveWith(null);
        return;
      }

      // Left arrow: move selection left
      if (key === "\x1b[D") {
        selectedIndex = (selectedIndex - 1 + MENU_OPTIONS.length) % MENU_OPTIONS.length;
        rerender();
        return;
      }

      // Right arrow: move selection right
      if (key === "\x1b[C") {
        selectedIndex = (selectedIndex + 1) % MENU_OPTIONS.length;
        rerender();
        return;
      }

      // Ctrl+C: abort
      if (code === 0x03) {
        resolveWith(InterruptionAction.Abort);
        return;
      }

      // Ignore all other keys
    };

    process.stdin.on("data", onData);

    // Auto-select after timeout
    timeoutHandle = setTimeout(() => {
      timeoutHandle = null;
      if (!resolved) {
        resolveWith(MENU_OPTIONS[selectedIndex]!.action);
      }
    }, cfg.timeoutMs);
  });
}

/**
 * Map an InterruptionType classification to a default InterruptionAction
 */
export function mapClassificationToAction(type: InterruptionType): InterruptionAction {
  switch (type) {
    case InterruptionType.Abort:
      return InterruptionAction.Abort;
    // Explicit modification/correction keywords → pre-select Modify
    case InterruptionType.Modify:
    case InterruptionType.Correct:
      return InterruptionAction.Modify;
    // Info or unclassified → pre-select Queue (likely a new topic/task)
    // The user can always switch to Modify via the menu if needed
    case InterruptionType.Info:
    default:
      return InterruptionAction.Queue;
  }
}
