/**
 * Checkpoint system types for Corbat-Coco
 *
 * Provides types for the checkpoint/rewind functionality that allows
 * users to restore previous states of files and conversations.
 */

import type { Message } from "../../../providers/types.js";

// =============================================================================
// Checkpoint Type
// =============================================================================

/**
 * Type of checkpoint being created or restored.
 *
 * - `file`: Only file state is checkpointed
 * - `conversation`: Only conversation state is checkpointed
 * - `combined`: Both file and conversation state are checkpointed
 */
export type CheckpointType = "file" | "conversation" | "combined";

// =============================================================================
// File Checkpoint
// =============================================================================

/**
 * Represents a snapshot of a file's state before modification.
 *
 * File checkpoints are created automatically before any file-modifying
 * tool (write, edit, delete) executes, allowing users to revert changes.
 */
export interface FileCheckpoint {
  /**
   * Unique identifier for this file checkpoint.
   * Format: `file_<timestamp>_<random>`
   */
  id: string;

  /**
   * Absolute path to the file that was checkpointed.
   * Always stored as an absolute path for reliable restoration.
   */
  filePath: string;

  /**
   * Original content of the file before modification.
   * For new files, this will be an empty string.
   * For deleted files, this contains the full content before deletion.
   */
  originalContent: string;

  /**
   * Content after modification, stored for reference.
   * Useful for showing diffs or understanding what changed.
   * May be undefined if the file was deleted.
   */
  newContent?: string;

  /**
   * Timestamp when this checkpoint was created.
   */
  createdAt: Date;

  /**
   * Name of the tool that triggered this checkpoint.
   * Examples: "write_file", "edit_file", "delete_file"
   */
  triggeredBy: string;

  /**
   * ID of the tool call that triggered this checkpoint.
   * Links the checkpoint to a specific tool invocation in the conversation.
   */
  toolCallId?: string;

  /**
   * Size of the original content in bytes.
   * Useful for storage management and display.
   */
  size: number;
}

// =============================================================================
// Conversation Checkpoint
// =============================================================================

/**
 * Represents a snapshot of the conversation state.
 *
 * Conversation checkpoints capture the message history at a point in time,
 * allowing users to rewind the conversation to a previous state.
 */
export interface ConversationCheckpoint {
  /**
   * Unique identifier for this conversation checkpoint.
   * Format: `conv_<timestamp>_<random>`
   */
  id: string;

  /**
   * Session ID this checkpoint belongs to.
   * Links the checkpoint to a specific REPL session.
   */
  sessionId: string;

  /**
   * Complete message history at the time of checkpoint.
   * Includes system, user, and assistant messages with all content types.
   */
  messages: Message[];

  /**
   * Total number of messages in this checkpoint.
   * Convenience field for display and filtering.
   */
  messageCount: number;

  /**
   * Timestamp when this checkpoint was created.
   */
  createdAt: Date;

  /**
   * Human-readable description of what happened at this point.
   * Auto-generated from the last user message or tool action.
   * Examples: "User asked to refactor utils", "Completed file edits"
   */
  description?: string;
}

// =============================================================================
// Combined Checkpoint
// =============================================================================

/**
 * A complete checkpoint that may include file and/or conversation state.
 *
 * Combined checkpoints are the primary unit of restoration in the rewind
 * system. They group related file changes with the conversation state
 * that produced them.
 */
export interface Checkpoint {
  /**
   * Unique identifier for this checkpoint.
   * Format: `ckpt_<timestamp>_<random>`
   */
  id: string;

  /**
   * Session ID this checkpoint belongs to.
   * Checkpoints are scoped to individual REPL sessions.
   */
  sessionId: string;

  /**
   * Type of state captured in this checkpoint.
   */
  type: CheckpointType;

  /**
   * File checkpoints included in this checkpoint.
   * Present when type is "file" or "combined".
   * May be empty if no files were modified.
   */
  files: FileCheckpoint[];

  /**
   * Conversation checkpoint included in this checkpoint.
   * Present when type is "conversation" or "combined".
   */
  conversation?: ConversationCheckpoint;

  /**
   * Timestamp when this checkpoint was created.
   */
  createdAt: Date;

  /**
   * Human-readable label for this checkpoint.
   * Can be auto-generated or user-provided.
   * Examples: "Before refactoring", "Turn 15"
   */
  label?: string;

  /**
   * Whether this checkpoint was created automatically or by user request.
   *
   * - `true`: Created automatically (e.g., before file edit)
   * - `false`: Created by explicit user command (e.g., /checkpoint)
   */
  automatic: boolean;
}

// =============================================================================
// Rewind Operations
// =============================================================================

/**
 * Options for rewinding to a checkpoint.
 *
 * Allows fine-grained control over what gets restored when
 * rewinding to a previous state.
 */
export interface RewindOptions {
  /**
   * ID of the checkpoint to rewind to.
   */
  checkpointId: string;

  /**
   * Whether to restore file contents from the checkpoint.
   * When true, files will be reverted to their checkpointed state.
   */
  restoreFiles: boolean;

  /**
   * Whether to restore the conversation from the checkpoint.
   * When true, messages after the checkpoint will be discarded.
   */
  restoreConversation: boolean;

  /**
   * File paths to exclude from restoration.
   * Useful when you want to keep certain changes while reverting others.
   * Paths should be absolute.
   */
  excludeFiles?: string[];
}

/**
 * Result of a rewind operation.
 *
 * Provides detailed information about what was restored
 * and any issues encountered during the rewind.
 */
export interface RewindResult {
  /**
   * The checkpoint that was restored.
   */
  checkpoint: Checkpoint;

  /**
   * Absolute paths of files that were successfully restored.
   */
  filesRestored: string[];

  /**
   * Files that failed to restore, with error details.
   * Common failures: permission denied, file locked, disk full.
   */
  filesFailed: Array<{
    /** Absolute path to the file that failed */
    path: string;
    /** Error message describing the failure */
    error: string;
  }>;

  /**
   * Whether the conversation was successfully restored.
   */
  conversationRestored: boolean;

  /**
   * Number of messages in the conversation after restore.
   * Useful for confirming the rewind worked as expected.
   */
  messagesAfterRestore: number;
}

// =============================================================================
// Checkpoint Manager Configuration
// =============================================================================

/**
 * Configuration for the checkpoint manager.
 *
 * Controls checkpoint storage, retention, and automatic checkpointing behavior.
 */
export interface CheckpointConfig {
  /**
   * Directory to store checkpoint data.
   * Checkpoints are stored as JSON files in this directory.
   * Default: `~/.corbat-coco/checkpoints`
   */
  storageDir: string;

  /**
   * Maximum number of checkpoints to retain per session.
   * Oldest checkpoints are automatically pruned when limit is exceeded.
   * Default: 50
   */
  maxCheckpoints: number;

  /**
   * Whether to automatically create checkpoints before file modifications.
   * When true, every write/edit/delete operation creates a file checkpoint.
   * Default: true
   */
  autoCheckpointFiles: boolean;

  /**
   * Interval (in conversation turns) for automatic conversation checkpoints.
   * A turn is defined as one user message plus the assistant's response.
   * Set to 0 to disable automatic conversation checkpoints.
   * Default: 10
   */
  conversationCheckpointInterval: number;
}

// =============================================================================
// Checkpoint Storage
// =============================================================================

/**
 * Metadata about a stored checkpoint (without full content).
 *
 * Used for listing and displaying checkpoints without loading
 * the full content into memory.
 */
export interface CheckpointMetadata {
  /**
   * Unique identifier for this checkpoint.
   */
  id: string;

  /**
   * Session ID this checkpoint belongs to.
   */
  sessionId: string;

  /**
   * Type of checkpoint.
   */
  type: CheckpointType;

  /**
   * Number of files included in this checkpoint.
   */
  fileCount: number;

  /**
   * Total size of file content in bytes.
   */
  totalSize: number;

  /**
   * Number of messages (if conversation checkpoint).
   */
  messageCount?: number;

  /**
   * When the checkpoint was created.
   */
  createdAt: Date;

  /**
   * Human-readable label.
   */
  label?: string;

  /**
   * Whether automatically created.
   */
  automatic: boolean;
}

/**
 * Filter options for listing checkpoints.
 */
export interface CheckpointFilter {
  /**
   * Filter by session ID.
   */
  sessionId?: string;

  /**
   * Filter by checkpoint type.
   */
  type?: CheckpointType;

  /**
   * Filter by creation time (after this date).
   */
  after?: Date;

  /**
   * Filter by creation time (before this date).
   */
  before?: Date;

  /**
   * Filter by automatic flag.
   */
  automatic?: boolean;

  /**
   * Maximum number of results to return.
   */
  limit?: number;
}
