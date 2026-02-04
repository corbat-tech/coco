/**
 * Background Task Types
 *
 * Types for managing background tasks that run while the user continues interacting.
 */

/**
 * Status of a background task
 */
export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * A background task that runs asynchronously
 */
export interface BackgroundTask {
  /** Unique identifier for the task */
  id: string;
  /** Short name for the task */
  name: string;
  /** Detailed description of what the task does */
  description: string;
  /** Current status of the task */
  status: BackgroundTaskStatus;
  /** Progress percentage (0-100), if known */
  progress?: number;
  /** Result of the task on completion */
  result?: string;
  /** Error message if the task failed */
  error?: string;
  /** ISO timestamp when the task was started */
  startedAt: string;
  /** ISO timestamp when the task completed (success, failure, or cancellation) */
  completedAt?: string;
}

/**
 * Executor function for a background task
 * Returns a promise that resolves with the result string
 */
export type TaskExecutor = () => Promise<string>;

/**
 * Callback for task completion events
 */
export type TaskCompleteCallback = (task: BackgroundTask) => void;

/**
 * Options for the background task manager
 */
export interface BackgroundTaskManagerOptions {
  /** Maximum number of concurrent tasks (default: 3) */
  maxConcurrent?: number;
}
