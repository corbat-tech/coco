/**
 * Types for the feedback system
 *
 * @module cli/repl/feedback/types
 */

/**
 * Feedback delivery method
 */
export type FeedbackMethod = "spinner" | "bell" | "stderr";

/**
 * Configuration for the feedback system
 */
export interface FeedbackConfig {
  /** Primary feedback method (default: "spinner") */
  method: FeedbackMethod;
  /** Duration in ms to show capture confirmation on spinner (default: 2000) */
  displayDurationMs: number;
  /** Whether to also emit a bell on capture (default: false) */
  bell: boolean;
}
