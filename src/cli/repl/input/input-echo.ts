/**
 * Input Echo Renderer
 *
 * Renders a live echo of what the user is typing during agent execution.
 * Works by appending a second line to the Ora spinner text, which Ora
 * handles natively (including multi-line clearing on re-render).
 *
 * This avoids all ANSI cursor conflicts: Ora manages all stdout writes,
 * and we simply update its text property to include the input buffer.
 *
 * @module cli/repl/input/input-echo
 */

import chalk from "chalk";
import type { Spinner } from "../output/spinner.js";

/**
 * Configuration for the input echo renderer
 */
export interface InputEchoConfig {
  /** Maximum visible characters in the echo line (default: 60) */
  maxVisibleChars: number;
  /** Prompt prefix shown before the buffer text (default: "› ") */
  prompt: string;
  /** Placeholder text shown when the buffer is empty (default: shown below) */
  placeholder: string;
}

const DEFAULT_CONFIG: InputEchoConfig = {
  maxVisibleChars: 60,
  prompt: "\u203A ",
  placeholder: "Escribe para modificar o a\u00F1adir tareas\u2026",
};

/**
 * Create an input echo renderer
 *
 * @param getSpinner - Function returning the current active spinner (or null)
 * @param getCurrentMessage - Function returning the current spinner base message
 * @param config - Optional configuration
 * @returns Input echo controller with a BufferChangeCallback-compatible render method
 */
export function createInputEcho(
  getSpinner: () => Spinner | null,
  getCurrentMessage: () => string,
  config?: Partial<InputEchoConfig>,
) {
  const cfg: InputEchoConfig = { ...DEFAULT_CONFIG, ...config };

  let lastBuffer = "";
  let active = true;

  /**
   * Format the placeholder line (shown when buffer is empty)
   */
  function formatPlaceholder(): string {
    return chalk.dim(`${cfg.prompt}${cfg.placeholder}`);
  }

  /**
   * Format the echo line for display
   *
   * @param buffer - The current input buffer
   * @returns Formatted echo string (single line, no trailing newline)
   */
  function formatEchoLine(buffer: string): string {
    if (buffer.length === 0) return formatPlaceholder();

    // Truncate from the left if buffer is too long (show the end)
    let visible = buffer;
    if (visible.length > cfg.maxVisibleChars) {
      visible = "\u2026" + visible.slice(-(cfg.maxVisibleChars - 1));
    }

    return chalk.dim(cfg.prompt) + chalk.white(visible) + chalk.dim("\u2502");
  }

  /**
   * Update the spinner to include the echo/placeholder line
   */
  function updateSpinner(buffer: string): void {
    const spinner = getSpinner();
    if (!spinner || !active) return;

    const baseMessage = getCurrentMessage();
    const echoLine = formatEchoLine(buffer);
    spinner.update(baseMessage + "\n" + echoLine);
  }

  return {
    /**
     * Buffer change callback — compatible with BufferChangeCallback type.
     * Call this on every keystroke to update the echo display.
     */
    render(buffer: string): void {
      lastBuffer = buffer;
      updateSpinner(buffer);
    },

    /**
     * Force a re-render with the current buffer.
     * Useful after the spinner message changes externally.
     */
    refresh(): void {
      updateSpinner(lastBuffer);
    },

    /**
     * Update the spinner with a new base message AND re-render the echo
     * in a single spinner.update() call. This avoids the double-render
     * flickering that occurs when base message and echo are updated separately.
     *
     * @param baseMessage - The new spinner base message
     */
    refreshWith(baseMessage: string): void {
      const spinner = getSpinner();
      if (!spinner || !active) {
        if (spinner) spinner.update(baseMessage);
        return;
      }

      const echoLine = formatEchoLine(lastBuffer);
      spinner.update(baseMessage + "\n" + echoLine);
    },

    /**
     * Clear the echo line from the spinner (restore base message).
     * Call this before showing the action selector or stopping capture.
     */
    clear(): void {
      lastBuffer = "";
      const spinner = getSpinner();
      if (spinner) {
        spinner.update(getCurrentMessage());
      }
    },

    /**
     * Temporarily disable echo rendering (e.g. during action selector)
     */
    suspend(): void {
      active = false;
      // Clear any visible echo
      this.clear();
    },

    /**
     * Re-enable echo rendering after suspend
     */
    resume(): void {
      active = true;
      // Re-render echo or placeholder
      updateSpinner(lastBuffer);
    },

    /**
     * Reset state (call between agent turns)
     */
    reset(): void {
      lastBuffer = "";
      active = true;
    },

    /**
     * Get the current buffer content
     */
    get currentBuffer(): string {
      return lastBuffer;
    },

    /**
     * Whether the echo is currently showing content
     */
    get isShowing(): boolean {
      return lastBuffer.length > 0 && active;
    },
  };
}

/** Type alias for the input echo instance */
export type InputEcho = ReturnType<typeof createInputEcho>;
