/**
 * Checkpoints System for Corbat-Coco
 *
 * Provides file and conversation checkpointing with rewind capability,
 * similar to Claude Code's checkpoint/rewind system.
 *
 * @module checkpoints
 */

// Types
export {
  type CheckpointType,
  type FileCheckpoint,
  type ConversationCheckpoint,
  type Checkpoint,
  type RewindOptions,
  type RewindResult,
  type CheckpointConfig,
  type CheckpointMetadata,
  type CheckpointFilter,
} from "./types.js";

// Manager
export {
  CheckpointManager,
  createCheckpointManager,
  getCheckpointManager,
  resetCheckpointManager,
} from "./manager.js";
