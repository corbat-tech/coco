/**
 * Session persistence types for Corbat-Coco
 *
 * This module defines types for persisting and resuming REPL sessions,
 * allowing users to continue work after restarts or interruptions.
 */

import type { Message } from "../../../providers/types.js";
import type { ReplConfig, ReplSession } from "../types.js";

/**
 * Session status indicating the state when the session was last saved
 */
export type SessionStatus = "active" | "completed" | "interrupted" | "error";

/**
 * Persisted session metadata for quick listing and resumption
 */
export interface PersistedSession {
  /** Unique session identifier */
  id: string;

  /** Project path where session was created */
  projectPath: string;

  /** When the session started */
  startedAt: Date;

  /** When the session was last saved */
  lastSavedAt: Date;

  /** Session configuration */
  config: ReplConfig;

  /** Message count (for quick display without loading full conversation) */
  messageCount: number;

  /** Total tokens used during the session */
  totalTokens: {
    input: number;
    output: number;
  };

  /** Human-readable title/summary of the session */
  title?: string;

  /** Whether session completed normally or was interrupted */
  status: SessionStatus;
}

/**
 * File paths for session storage on disk
 */
export interface SessionFiles {
  /** Metadata file path: metadata.json */
  metadata: string;

  /** Conversation file path: conversation.jsonl (one message per line) */
  conversation: string;

  /** Context state file path: context.json */
  context: string;
}

/**
 * Session storage interface for persistence operations
 */
export interface SessionStorage {
  /**
   * Save a session to disk
   * @param session - The REPL session to persist
   */
  save(session: ReplSession): Promise<void>;

  /**
   * Load a session from disk
   * @param sessionId - The unique session identifier
   * @returns The loaded session or null if not found
   */
  load(sessionId: string): Promise<ReplSession | null>;

  /**
   * List all sessions, optionally filtered by project path
   * @param projectPath - Optional project path to filter by
   * @returns Array of persisted session metadata
   */
  listSessions(projectPath?: string): Promise<PersistedSession[]>;

  /**
   * Delete a session from disk
   * @param sessionId - The unique session identifier
   * @returns True if deleted, false if not found
   */
  delete(sessionId: string): Promise<boolean>;

  /**
   * Get the most recent session for a project
   * @param projectPath - The project path to search
   * @returns The most recent session or null if none exist
   */
  getMostRecent(projectPath: string): Promise<PersistedSession | null>;
}

/**
 * Options for the session picker UI
 */
export interface SessionPickerOptions {
  /** Maximum number of sessions to show (default: 10) */
  limit?: number;

  /** Filter by project path */
  projectPath?: string;

  /** Filter by session status */
  status?: SessionStatus[];

  /** Sort order for results */
  sortBy?: "recent" | "oldest" | "messageCount";
}

/**
 * Configuration for session persistence behavior
 */
export interface SessionPersistenceConfig {
  /** Directory to store session files */
  storageDir: string;

  /** Auto-save interval in milliseconds (default: 30000 = 30 seconds) */
  autoSaveInterval: number;

  /** Maximum sessions to keep per project (default: 20) */
  maxSessionsPerProject: number;

  /** Whether to compress old sessions to save disk space */
  compressOldSessions: boolean;
}

/**
 * Serializable session data for JSON storage
 * Converts Date objects to ISO strings and Set to arrays
 */
export interface SerializedSession {
  /** Unique session identifier */
  id: string;

  /** ISO timestamp when session started */
  startedAt: string;

  /** Project path where session was created */
  projectPath: string;

  /** Session configuration */
  config: ReplConfig;

  /** Tools trusted for this session (converted from Set) */
  trustedTools: string[];
}

/**
 * Serializable message for JSONL storage
 */
export interface SerializedMessage {
  /** Message role */
  role: Message["role"];

  /** Message content */
  content: Message["content"];

  /** Timestamp when message was added */
  timestamp: string;
}

/**
 * Context state for persistence
 */
export interface SerializedContext {
  /** Token usage tracking */
  tokenUsage: {
    input: number;
    output: number;
  };

  /** Progress tracker state if available */
  progress?: {
    tasks: Array<{
      id: string;
      description: string;
      status: "pending" | "in_progress" | "completed";
    }>;
  };

  /** Any custom context data */
  custom?: Record<string, unknown>;
}

/**
 * Result of a session save operation
 */
export interface SessionSaveResult {
  /** Whether the save was successful */
  success: boolean;

  /** Session ID that was saved */
  sessionId: string;

  /** Error message if save failed */
  error?: string;

  /** Paths to saved files */
  files?: SessionFiles;
}

/**
 * Result of a session load operation
 */
export interface SessionLoadResult {
  /** Whether the load was successful */
  success: boolean;

  /** The loaded session if successful */
  session?: ReplSession;

  /** Error message if load failed */
  error?: string;

  /** Whether the session was recovered from a partial state */
  recovered?: boolean;
}
