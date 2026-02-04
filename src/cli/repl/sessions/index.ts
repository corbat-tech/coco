/**
 * Session Persistence System for Corbat-Coco
 *
 * Provides session save/restore functionality for resuming conversations,
 * similar to Claude Code's session management.
 *
 * @module sessions
 */

// Types
export {
  type SessionStatus,
  type PersistedSession,
  type SessionFiles,
  type SessionStorage,
  type SessionPickerOptions,
  type SessionPersistenceConfig,
  type SerializedSession,
  type SerializedMessage,
  type SerializedContext,
  type SessionSaveResult,
  type SessionLoadResult,
} from "./types.js";

// Storage
export {
  SessionStore,
  createSessionStore,
  getSessionStore,
  getDefaultStorageDir,
} from "./storage.js";
