/**
 * Types for git worktree management
 */

/**
 * Represents a git worktree instance
 */
export interface Worktree {
  /** Unique identifier */
  id: string;
  /** Worktree name (used for directory and branch) */
  name: string;
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name used in this worktree */
  branch: string;
  /** Current status */
  status: WorktreeStatus;
  /** When the worktree was created */
  createdAt: Date;
  /** When the worktree was removed (if applicable) */
  removedAt?: Date;
  /** Error message if status is 'error' */
  error?: string;
}

/**
 * Worktree lifecycle status
 */
export type WorktreeStatus = "creating" | "active" | "merging" | "removing" | "removed" | "error";

/**
 * Strategy for merging a worktree back to the main branch
 */
export type MergeStrategy = "merge" | "rebase" | "pr";

/**
 * Options for creating a worktree
 */
export interface CreateWorktreeOptions {
  /** Base branch to create from (default: current HEAD) */
  baseBranch?: string;
  /** Branch name prefix (default: "coco-agent") */
  branchPrefix?: string;
}

/**
 * Options for merging a worktree
 */
export interface MergeWorktreeOptions {
  /** Merge strategy to use */
  strategy: MergeStrategy;
  /** Whether to delete the worktree after merge */
  cleanup?: boolean;
  /** Commit message for merge commit */
  message?: string;
}

/**
 * Result of a merge operation
 */
export interface MergeResult {
  /** Whether the merge was successful */
  success: boolean;
  /** Merge strategy used */
  strategy: MergeStrategy;
  /** Error message if failed */
  error?: string;
  /** Number of files changed */
  filesChanged?: number;
  /** PR URL if strategy was 'pr' */
  prUrl?: string;
}
