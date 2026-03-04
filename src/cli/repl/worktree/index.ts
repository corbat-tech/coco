/**
 * Git worktree management for parallel agent isolation
 */

export type {
  Worktree,
  WorktreeStatus,
  MergeStrategy,
  CreateWorktreeOptions,
  MergeWorktreeOptions,
  MergeResult,
} from "./types.js";

export { WorktreeManager, createWorktreeManager } from "./manager.js";
