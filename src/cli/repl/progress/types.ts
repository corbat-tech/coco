/**
 * Progress Tracking Types
 *
 * Types for TodoWrite-like progress tracking in the REPL.
 */

/**
 * Status of a todo item
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * A single todo item for tracking progress
 */
export interface TodoItem {
  /** Unique identifier for the todo */
  id: string;
  /** Description of what needs to be done (imperative form) */
  content: string;
  /** Present tense description shown during execution */
  activeForm: string;
  /** Current status of the todo */
  status: TodoStatus;
  /** ISO timestamp when the todo was created */
  createdAt: string;
  /** ISO timestamp when the todo was last updated */
  updatedAt: string;
  /** Parent todo ID for nested todos */
  parentId?: string;
}

/**
 * Serializable progress state
 */
export interface ProgressState {
  /** List of all todos */
  todos: TodoItem[];
  /** ID of the currently active task */
  currentTask?: string;
}

/**
 * Progress statistics
 */
export interface ProgressStats {
  /** Total number of todos */
  total: number;
  /** Number of pending todos */
  pending: number;
  /** Number of in-progress todos */
  inProgress: number;
  /** Number of completed todos */
  completed: number;
  /** Number of failed todos */
  failed: number;
  /** Completion percentage (0-100) */
  completionPercent: number;
}
