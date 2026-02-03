/**
 * Output Module for REPL
 *
 * Provides terminal output rendering utilities:
 * - Streaming text output with proper formatting
 * - Tool execution feedback (start/end indicators)
 * - Usage statistics display (tokens, cost)
 * - Error, info, and success message formatting
 * - Progress spinners for long operations
 *
 * @module cli/repl/output
 *
 * @example
 * import { renderStreamChunk, createSpinner } from './output';
 *
 * // Stream text to terminal
 * renderStreamChunk('Processing...');
 *
 * // Show spinner during operation
 * const spinner = createSpinner('Loading...');
 * spinner.start();
 * await doWork();
 * spinner.stop('Done!');
 */

export {
  /** Render streaming text chunk to terminal */
  renderStreamChunk,
  /** Display tool execution start indicator */
  renderToolStart,
  /** Display tool execution end indicator */
  renderToolEnd,
  /** Display token/cost usage statistics */
  renderUsageStats,
  /** Display formatted error message */
  renderError,
  /** Display formatted info message */
  renderInfo,
  /** Display formatted success message */
  renderSuccess,
} from "./renderer.js";

export { createSpinner, type Spinner } from "./spinner.js";
