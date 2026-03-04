/**
 * Types for Best-of-N solution execution
 *
 * Runs N parallel solution attempts for the same task and selects the best
 * based on quality scoring.
 */

/**
 * Configuration for a Best-of-N run
 */
export interface BestOfNConfig {
  /** Number of parallel attempts (default: 3) */
  attempts: number;
  /** The task/prompt to execute in each attempt */
  task: string;
  /** Whether to auto-select the best solution (default: true) */
  autoSelect: boolean;
  /** Whether to merge the winning solution back (default: false, requires user confirmation) */
  autoMerge: boolean;
  /** Maximum time per attempt in ms (default: 5 minutes) */
  timeoutMs: number;
}

/**
 * A single solution attempt with its evaluation
 */
export interface SolutionAttempt {
  /** Unique attempt ID */
  id: string;
  /** Attempt number (1-based) */
  index: number;
  /** Worktree ID (from WorktreeManager) */
  worktreeId: string;
  /** Worktree path */
  worktreePath: string;
  /** Branch name */
  branch: string;
  /** Status of this attempt */
  status: SolutionStatus;
  /** Quality score (0-100), null if not yet evaluated */
  score: number | null;
  /** Agent output text */
  output: string;
  /** Files changed in this attempt */
  filesChanged: string[];
  /** Duration in ms */
  durationMs: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Status of a solution attempt
 */
export type SolutionStatus = "pending" | "running" | "evaluating" | "completed" | "failed" | "selected" | "discarded";

/**
 * Result of a Best-of-N run
 */
export interface BestOfNResult {
  /** Whether the run completed successfully */
  success: boolean;
  /** All solution attempts with scores */
  attempts: SolutionAttempt[];
  /** The winning attempt (highest score) */
  winner: SolutionAttempt | null;
  /** Total duration of the run in ms */
  totalDurationMs: number;
  /** Error message if the run failed */
  error?: string;
}

/**
 * Callbacks for progress reporting
 */
export interface BestOfNCallbacks {
  /** Called when an attempt starts */
  onAttemptStart?: (attempt: SolutionAttempt) => void;
  /** Called when an attempt completes */
  onAttemptComplete?: (attempt: SolutionAttempt) => void;
  /** Called when an attempt fails */
  onAttemptFail?: (attempt: SolutionAttempt) => void;
  /** Called when evaluation starts for an attempt */
  onEvaluating?: (attempt: SolutionAttempt) => void;
  /** Called when winner is selected */
  onWinnerSelected?: (attempt: SolutionAttempt) => void;
}
