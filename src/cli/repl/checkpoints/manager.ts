/**
 * Checkpoint Manager for Corbat-Coco
 *
 * Manages creating, storing, and restoring checkpoints for files and conversations.
 * Checkpoints enable users to revert changes and explore different approaches safely.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

import type { Message } from "../../../providers/types.js";
import type {
  Checkpoint,
  CheckpointConfig,
  CheckpointType,
  ConversationCheckpoint,
  FileCheckpoint,
  RewindOptions,
  RewindResult,
} from "./types.js";
import { CONFIG_PATHS } from "../../../config/paths.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Default configuration values for the checkpoint manager.
 */
const DEFAULT_CONFIG: CheckpointConfig = {
  storageDir: CONFIG_PATHS.checkpoints,
  maxCheckpoints: 50,
  autoCheckpointFiles: true,
  conversationCheckpointInterval: 10,
};

/**
 * Index file name for quick checkpoint lookup.
 */
const INDEX_FILE = "index.json";

/**
 * Directory name for storing file contents.
 */
const FILES_DIR = "files";

// =============================================================================
// Types
// =============================================================================

/**
 * Index entry for a checkpoint (stored in index.json).
 */
interface CheckpointIndexEntry {
  id: string;
  type: CheckpointType;
  createdAt: string;
  label?: string;
  automatic: boolean;
  fileCount: number;
  messageCount?: number;
}

/**
 * Index structure stored per session.
 */
interface SessionIndex {
  sessionId: string;
  checkpoints: CheckpointIndexEntry[];
  lastUpdated: string;
}

/**
 * Stored checkpoint data (JSON file format).
 */
interface StoredCheckpoint {
  id: string;
  sessionId: string;
  type: CheckpointType;
  createdAt: string;
  label?: string;
  automatic: boolean;
  files: StoredFileCheckpoint[];
  conversation?: StoredConversationCheckpoint;
}

/**
 * Stored file checkpoint format.
 */
interface StoredFileCheckpoint {
  id: string;
  filePath: string;
  contentHash: string;
  newContentHash?: string;
  createdAt: string;
  triggeredBy: string;
  toolCallId?: string;
  size: number;
}

/**
 * Stored conversation checkpoint format.
 */
interface StoredConversationCheckpoint {
  id: string;
  sessionId: string;
  messages: Message[];
  messageCount: number;
  createdAt: string;
  description?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique ID with prefix.
 */
function generateId(prefix: string): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Compute SHA-256 hash of content.
 */
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists.
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Read JSON file safely.
 */
async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON file with pretty formatting.
 */
async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// =============================================================================
// CheckpointManager Class
// =============================================================================

/**
 * Manages the lifecycle of checkpoints including creation, storage, and restoration.
 *
 * The checkpoint manager stores data in the following structure:
 * ```
 * ~/.coco/checkpoints/
 *   <session-id>/
 *     index.json           # Quick lookup index
 *     <checkpoint-id>.json # Checkpoint metadata
 *     files/
 *       <content-hash>.txt # Deduplicated file contents
 * ```
 *
 * @example
 * ```typescript
 * const manager = new CheckpointManager();
 *
 * // Create a file checkpoint before modifying a file
 * const fileCheckpoint = await manager.createFileCheckpoint(
 *   sessionId,
 *   "/path/to/file.ts",
 *   "edit_file",
 *   toolCallId
 * );
 *
 * // Rewind to a previous checkpoint
 * const result = await manager.rewind({
 *   checkpointId: "ckpt_123",
 *   restoreFiles: true,
 *   restoreConversation: false,
 * });
 * ```
 */
export class CheckpointManager {
  private readonly config: CheckpointConfig;
  private readonly contentCache: Map<string, string> = new Map();

  /**
   * Create a new CheckpointManager instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: Partial<CheckpointConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  // ===========================================================================
  // Path Helpers
  // ===========================================================================

  /**
   * Get the storage directory for a session.
   */
  private getSessionDir(sessionId: string): string {
    return path.join(this.config.storageDir, sessionId);
  }

  /**
   * Get the index file path for a session.
   */
  private getIndexPath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), INDEX_FILE);
  }

  /**
   * Get the checkpoint file path.
   */
  private getCheckpointPath(sessionId: string, checkpointId: string): string {
    return path.join(this.getSessionDir(sessionId), `${checkpointId}.json`);
  }

  /**
   * Get the files directory for a session.
   */
  private getFilesDir(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), FILES_DIR);
  }

  /**
   * Get the content file path for a hash.
   */
  private getContentPath(sessionId: string, hash: string): string {
    return path.join(this.getFilesDir(sessionId), `${hash}.txt`);
  }

  // ===========================================================================
  // Index Operations
  // ===========================================================================

  /**
   * Load the session index.
   */
  private async loadIndex(sessionId: string): Promise<SessionIndex> {
    const indexPath = this.getIndexPath(sessionId);
    const index = await readJson<SessionIndex>(indexPath);

    if (index) {
      return index;
    }

    return {
      sessionId,
      checkpoints: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Save the session index.
   */
  private async saveIndex(index: SessionIndex): Promise<void> {
    index.lastUpdated = new Date().toISOString();
    await writeJson(this.getIndexPath(index.sessionId), index);
  }

  /**
   * Add a checkpoint to the index.
   */
  private async addToIndex(sessionId: string, checkpoint: Checkpoint): Promise<void> {
    const index = await this.loadIndex(sessionId);

    const entry: CheckpointIndexEntry = {
      id: checkpoint.id,
      type: checkpoint.type,
      createdAt: checkpoint.createdAt.toISOString(),
      label: checkpoint.label,
      automatic: checkpoint.automatic,
      fileCount: checkpoint.files.length,
      messageCount: checkpoint.conversation?.messageCount,
    };

    index.checkpoints.push(entry);
    await this.saveIndex(index);
  }

  /**
   * Remove a checkpoint from the index.
   * Used internally during checkpoint deletion operations.
   */
  async removeFromIndex(sessionId: string, checkpointId: string): Promise<void> {
    const index = await this.loadIndex(sessionId);
    index.checkpoints = index.checkpoints.filter((c) => c.id !== checkpointId);
    await this.saveIndex(index);
  }

  // ===========================================================================
  // Content Storage
  // ===========================================================================

  /**
   * Store file content and return its hash.
   */
  private async storeContent(sessionId: string, content: string): Promise<string> {
    const hash = hashContent(content);
    const contentPath = this.getContentPath(sessionId, hash);

    // Skip if already stored
    if (await fileExists(contentPath)) {
      return hash;
    }

    // Store the content
    await ensureDir(this.getFilesDir(sessionId));
    await fs.writeFile(contentPath, content, "utf-8");

    return hash;
  }

  /**
   * Load content by hash.
   */
  private async loadContent(sessionId: string, hash: string): Promise<string | null> {
    // Check cache first
    const cacheKey = `${sessionId}:${hash}`;
    if (this.contentCache.has(cacheKey)) {
      return this.contentCache.get(cacheKey)!;
    }

    // Load from disk
    const contentPath = this.getContentPath(sessionId, hash);
    try {
      const content = await fs.readFile(contentPath, "utf-8");
      // Cache for future use
      this.contentCache.set(cacheKey, content);
      return content;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // File Checkpoint Operations
  // ===========================================================================

  /**
   * Create a file checkpoint before modifying a file.
   *
   * This method reads the current content of the file and stores it.
   * If the file doesn't exist, an empty checkpoint is created.
   *
   * @param sessionId - Session ID for the checkpoint
   * @param filePath - Absolute path to the file to checkpoint
   * @param triggeredBy - Name of the tool triggering the checkpoint
   * @param toolCallId - Optional ID of the tool call
   * @returns The created file checkpoint
   *
   * @example
   * ```typescript
   * const checkpoint = await manager.createFileCheckpoint(
   *   "session_123",
   *   "/path/to/file.ts",
   *   "edit_file",
   *   "tool_abc"
   * );
   * ```
   */
  async createFileCheckpoint(
    _sessionId: string,
    filePath: string,
    triggeredBy: string,
    toolCallId?: string,
  ): Promise<FileCheckpoint> {
    // Read current content (empty if file doesn't exist)
    // Note: _sessionId is kept for API consistency but not used in this method
    let originalContent = "";
    try {
      originalContent = await fs.readFile(filePath, "utf-8");
    } catch {
      // File doesn't exist, use empty content
    }

    const checkpoint: FileCheckpoint = {
      id: generateId("file"),
      filePath: path.resolve(filePath),
      originalContent,
      createdAt: new Date(),
      triggeredBy,
      toolCallId,
      size: Buffer.byteLength(originalContent, "utf-8"),
    };

    return checkpoint;
  }

  /**
   * Update a file checkpoint with the new content after modification.
   *
   * @param checkpoint - The file checkpoint to update
   * @param newContent - The new content of the file after modification
   * @returns Updated file checkpoint
   */
  updateFileCheckpointWithNewContent(
    checkpoint: FileCheckpoint,
    newContent: string,
  ): FileCheckpoint {
    return {
      ...checkpoint,
      newContent,
    };
  }

  // ===========================================================================
  // Conversation Checkpoint Operations
  // ===========================================================================

  /**
   * Create a conversation checkpoint.
   *
   * Captures the current state of the conversation messages.
   *
   * @param sessionId - Session ID for the checkpoint
   * @param messages - Current conversation messages
   * @param description - Optional description for the checkpoint
   * @returns The created conversation checkpoint
   *
   * @example
   * ```typescript
   * const checkpoint = await manager.createConversationCheckpoint(
   *   "session_123",
   *   messages,
   *   "Before refactoring utils"
   * );
   * ```
   */
  async createConversationCheckpoint(
    sessionId: string,
    messages: Message[],
    description?: string,
  ): Promise<ConversationCheckpoint> {
    const checkpoint: ConversationCheckpoint = {
      id: generateId("conv"),
      sessionId,
      messages: [...messages], // Create a copy
      messageCount: messages.length,
      createdAt: new Date(),
      description,
    };

    return checkpoint;
  }

  // ===========================================================================
  // Combined Checkpoint Operations
  // ===========================================================================

  /**
   * Create a combined checkpoint including files and/or conversation.
   *
   * This is the primary method for creating checkpoints that can be
   * rewound to later.
   *
   * @param sessionId - Session ID for the checkpoint
   * @param type - Type of checkpoint to create
   * @param files - Optional file paths to checkpoint
   * @param messages - Optional conversation messages to checkpoint
   * @param label - Optional label for the checkpoint
   * @returns The created checkpoint
   *
   * @example
   * ```typescript
   * // Create a combined checkpoint
   * const checkpoint = await manager.createCheckpoint(
   *   "session_123",
   *   "combined",
   *   ["/path/to/file1.ts", "/path/to/file2.ts"],
   *   messages,
   *   "Before major refactor"
   * );
   * ```
   */
  async createCheckpoint(
    sessionId: string,
    type: CheckpointType,
    files?: string[],
    messages?: Message[],
    label?: string,
  ): Promise<Checkpoint> {
    const fileCheckpoints: FileCheckpoint[] = [];
    let conversationCheckpoint: ConversationCheckpoint | undefined;

    // Create file checkpoints
    if ((type === "file" || type === "combined") && files) {
      for (const filePath of files) {
        const fileCheckpoint = await this.createFileCheckpoint(
          sessionId,
          filePath,
          "checkpoint_command",
        );
        fileCheckpoints.push(fileCheckpoint);
      }
    }

    // Create conversation checkpoint
    if ((type === "conversation" || type === "combined") && messages) {
      conversationCheckpoint = await this.createConversationCheckpoint(sessionId, messages, label);
    }

    const checkpoint: Checkpoint = {
      id: generateId("ckpt"),
      sessionId,
      type,
      files: fileCheckpoints,
      conversation: conversationCheckpoint,
      createdAt: new Date(),
      label,
      automatic: false,
    };

    // Store the checkpoint
    await this.storeCheckpoint(checkpoint);

    return checkpoint;
  }

  /**
   * Store a checkpoint to disk.
   */
  private async storeCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const sessionId = checkpoint.sessionId;

    // Store file contents and create stored format
    const storedFiles: StoredFileCheckpoint[] = [];
    for (const file of checkpoint.files) {
      const contentHash = await this.storeContent(sessionId, file.originalContent);
      let newContentHash: string | undefined;
      if (file.newContent !== undefined) {
        newContentHash = await this.storeContent(sessionId, file.newContent);
      }

      storedFiles.push({
        id: file.id,
        filePath: file.filePath,
        contentHash,
        newContentHash,
        createdAt: file.createdAt.toISOString(),
        triggeredBy: file.triggeredBy,
        toolCallId: file.toolCallId,
        size: file.size,
      });
    }

    // Create stored checkpoint
    const stored: StoredCheckpoint = {
      id: checkpoint.id,
      sessionId,
      type: checkpoint.type,
      createdAt: checkpoint.createdAt.toISOString(),
      label: checkpoint.label,
      automatic: checkpoint.automatic,
      files: storedFiles,
      conversation: checkpoint.conversation
        ? {
            id: checkpoint.conversation.id,
            sessionId: checkpoint.conversation.sessionId,
            messages: checkpoint.conversation.messages,
            messageCount: checkpoint.conversation.messageCount,
            createdAt: checkpoint.conversation.createdAt.toISOString(),
            description: checkpoint.conversation.description,
          }
        : undefined,
    };

    // Write checkpoint file
    await writeJson(this.getCheckpointPath(sessionId, checkpoint.id), stored);

    // Update index
    await this.addToIndex(sessionId, checkpoint);
  }

  /**
   * Load a checkpoint from storage.
   */
  private async loadCheckpoint(
    sessionId: string,
    checkpointId: string,
  ): Promise<Checkpoint | null> {
    const checkpointPath = this.getCheckpointPath(sessionId, checkpointId);
    const stored = await readJson<StoredCheckpoint>(checkpointPath);

    if (!stored) {
      return null;
    }

    // Load file contents
    const files: FileCheckpoint[] = [];
    for (const storedFile of stored.files) {
      const originalContent = await this.loadContent(sessionId, storedFile.contentHash);
      if (originalContent === null) {
        // Content missing, skip this file
        continue;
      }

      let newContent: string | undefined;
      if (storedFile.newContentHash) {
        newContent = (await this.loadContent(sessionId, storedFile.newContentHash)) ?? undefined;
      }

      files.push({
        id: storedFile.id,
        filePath: storedFile.filePath,
        originalContent,
        newContent,
        createdAt: new Date(storedFile.createdAt),
        triggeredBy: storedFile.triggeredBy,
        toolCallId: storedFile.toolCallId,
        size: storedFile.size,
      });
    }

    // Convert conversation checkpoint
    let conversation: ConversationCheckpoint | undefined;
    if (stored.conversation) {
      conversation = {
        id: stored.conversation.id,
        sessionId: stored.conversation.sessionId,
        messages: stored.conversation.messages,
        messageCount: stored.conversation.messageCount,
        createdAt: new Date(stored.conversation.createdAt),
        description: stored.conversation.description,
      };
    }

    return {
      id: stored.id,
      sessionId: stored.sessionId,
      type: stored.type,
      files,
      conversation,
      createdAt: new Date(stored.createdAt),
      label: stored.label,
      automatic: stored.automatic,
    };
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  /**
   * Get all checkpoints for a session.
   *
   * @param sessionId - Session ID to get checkpoints for
   * @returns Array of checkpoints, newest first
   */
  async getCheckpoints(sessionId: string): Promise<Checkpoint[]> {
    const index = await this.loadIndex(sessionId);
    const checkpoints: Checkpoint[] = [];

    for (const entry of index.checkpoints) {
      const checkpoint = await this.loadCheckpoint(sessionId, entry.id);
      if (checkpoint) {
        checkpoints.push(checkpoint);
      }
    }

    // Sort by creation time, newest first
    checkpoints.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return checkpoints;
  }

  /**
   * Get a specific checkpoint by ID.
   *
   * @param checkpointId - ID of the checkpoint to retrieve
   * @returns The checkpoint or null if not found
   */
  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    // Extract session ID from checkpoint ID pattern or search all sessions
    // For now, we need to search all session directories
    const sessionsDir = this.config.storageDir;

    try {
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionId = entry.name;
          const checkpoint = await this.loadCheckpoint(sessionId, checkpointId);
          if (checkpoint) {
            return checkpoint;
          }
        }
      }
    } catch {
      // Storage dir doesn't exist yet
    }

    return null;
  }

  /**
   * Get the most recent checkpoint for a session.
   *
   * @param sessionId - Session ID to get the latest checkpoint for
   * @returns The latest checkpoint or null if none exist
   */
  async getLatestCheckpoint(sessionId: string): Promise<Checkpoint | null> {
    const index = await this.loadIndex(sessionId);

    if (index.checkpoints.length === 0) {
      return null;
    }

    // Sort by creation time and get the latest
    const sorted = [...index.checkpoints].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const latest = sorted[0];
    if (!latest) {
      return null;
    }

    return this.loadCheckpoint(sessionId, latest.id);
  }

  /**
   * List files that have been checkpointed in a session.
   *
   * @param sessionId - Session ID to list checkpointed files for
   * @returns Array of unique file paths that have been checkpointed
   */
  async getCheckpointedFiles(sessionId: string): Promise<string[]> {
    const checkpoints = await this.getCheckpoints(sessionId);
    const filePaths = new Set<string>();

    for (const checkpoint of checkpoints) {
      for (const file of checkpoint.files) {
        filePaths.add(file.filePath);
      }
    }

    return Array.from(filePaths).sort();
  }

  // ===========================================================================
  // Rewind Operations
  // ===========================================================================

  /**
   * Rewind to a checkpoint.
   *
   * Restores files and/or conversation state based on the provided options.
   *
   * @param options - Rewind options specifying what to restore
   * @returns Result of the rewind operation
   *
   * @example
   * ```typescript
   * // Restore files only
   * const result = await manager.rewind({
   *   checkpointId: "ckpt_123",
   *   restoreFiles: true,
   *   restoreConversation: false,
   * });
   *
   * // Restore both with exclusions
   * const result = await manager.rewind({
   *   checkpointId: "ckpt_123",
   *   restoreFiles: true,
   *   restoreConversation: true,
   *   excludeFiles: ["/path/to/keep.ts"],
   * });
   * ```
   */
  async rewind(options: RewindOptions): Promise<RewindResult> {
    const { checkpointId, restoreFiles, restoreConversation, excludeFiles } = options;

    // Load the checkpoint
    const checkpoint = await this.getCheckpoint(checkpointId);

    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const result: RewindResult = {
      checkpoint,
      filesRestored: [],
      filesFailed: [],
      conversationRestored: false,
      messagesAfterRestore: 0,
    };

    // Restore files
    if (restoreFiles && checkpoint.files.length > 0) {
      const excludeSet = new Set(excludeFiles ?? []);

      for (const file of checkpoint.files) {
        if (excludeSet.has(file.filePath)) {
          continue;
        }

        try {
          // Ensure parent directory exists
          await ensureDir(path.dirname(file.filePath));

          // Write the original content back
          await fs.writeFile(file.filePath, file.originalContent, "utf-8");
          result.filesRestored.push(file.filePath);
        } catch (error) {
          result.filesFailed.push({
            path: file.filePath,
            error: error instanceof Error ? error.message : "Unknown error occurred",
          });
        }
      }
    }

    // Restore conversation (caller handles message restoration)
    if (restoreConversation && checkpoint.conversation) {
      result.conversationRestored = true;
      result.messagesAfterRestore = checkpoint.conversation.messageCount;
    }

    return result;
  }

  // ===========================================================================
  // Cleanup Operations
  // ===========================================================================

  /**
   * Delete old checkpoints to stay within the configured limit.
   *
   * Keeps the most recent checkpoints based on `maxCheckpoints` config.
   *
   * @param sessionId - Session ID to prune checkpoints for
   * @returns Number of checkpoints deleted
   */
  async pruneCheckpoints(sessionId: string): Promise<number> {
    const index = await this.loadIndex(sessionId);

    if (index.checkpoints.length <= this.config.maxCheckpoints) {
      return 0;
    }

    // Sort by creation time, newest first
    const sorted = [...index.checkpoints].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // Get checkpoints to delete
    const toDelete = sorted.slice(this.config.maxCheckpoints);
    let deletedCount = 0;

    for (const entry of toDelete) {
      try {
        // Delete checkpoint file
        const checkpointPath = this.getCheckpointPath(sessionId, entry.id);
        await fs.unlink(checkpointPath);
        deletedCount++;
      } catch {
        // Ignore deletion errors
      }
    }

    // Update index
    index.checkpoints = sorted.slice(0, this.config.maxCheckpoints);
    await this.saveIndex(index);

    // Note: Orphaned content files are not deleted here to avoid
    // accidentally removing content that might still be referenced.
    // A separate garbage collection could be implemented if needed.

    return deletedCount;
  }

  /**
   * Clear all checkpoints for a session.
   *
   * @param sessionId - Session ID to clear checkpoints for
   */
  async clearCheckpoints(sessionId: string): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);

    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }

    // Clear cache entries for this session
    for (const key of this.contentCache.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.contentCache.delete(key);
      }
    }
  }

  // ===========================================================================
  // Auto-checkpoint Support
  // ===========================================================================

  /**
   * Store a file checkpoint as part of an automatic checkpoint.
   *
   * This method is used by the auto-checkpoint system to create
   * file checkpoints before tool execution.
   *
   * @param sessionId - Session ID
   * @param fileCheckpoint - The file checkpoint to store
   * @param label - Optional label for the checkpoint
   * @returns The created checkpoint
   */
  async storeAutoFileCheckpoint(
    sessionId: string,
    fileCheckpoint: FileCheckpoint,
    label?: string,
  ): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: generateId("ckpt"),
      sessionId,
      type: "file",
      files: [fileCheckpoint],
      createdAt: new Date(),
      label: label ?? `Before ${fileCheckpoint.triggeredBy}`,
      automatic: true,
    };

    await this.storeCheckpoint(checkpoint);

    // Auto-prune if needed
    await this.pruneCheckpoints(sessionId);

    return checkpoint;
  }

  /**
   * Check if a file should be checkpointed.
   *
   * Returns false for new files (they don't need checkpointing since
   * there's nothing to revert to).
   *
   * @param filePath - Path to check
   * @returns Whether the file should be checkpointed
   */
  async shouldCheckpointFile(filePath: string): Promise<boolean> {
    return fileExists(filePath);
  }

  /**
   * Check if a file has changed since the last checkpoint.
   *
   * Used to avoid creating redundant checkpoints when a file
   * hasn't been modified.
   *
   * @param sessionId - Session ID
   * @param filePath - Path to check
   * @returns Whether the file has changed since the last checkpoint
   */
  async hasFileChangedSinceLastCheckpoint(sessionId: string, filePath: string): Promise<boolean> {
    const index = await this.loadIndex(sessionId);

    // Find the most recent checkpoint for this file
    for (const entry of [...index.checkpoints].reverse()) {
      const checkpoint = await this.loadCheckpoint(sessionId, entry.id);
      if (!checkpoint) continue;

      const fileCheckpoint = checkpoint.files.find((f) => f.filePath === filePath);
      if (fileCheckpoint) {
        // Compare current content with checkpointed content
        try {
          const currentContent = await fs.readFile(filePath, "utf-8");
          const currentHash = hashContent(currentContent);
          const checkpointHash = hashContent(fileCheckpoint.originalContent);
          return currentHash !== checkpointHash;
        } catch {
          // File doesn't exist anymore
          return true;
        }
      }
    }

    // No previous checkpoint found, consider it changed
    return true;
  }

  /**
   * Get the current configuration.
   *
   * @returns Current checkpoint configuration
   */
  getConfig(): CheckpointConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new CheckpointManager instance with optional configuration.
 *
 * @param config - Optional configuration overrides
 * @returns A new CheckpointManager instance
 *
 * @example
 * ```typescript
 * // With defaults
 * const manager = createCheckpointManager();
 *
 * // With custom config
 * const manager = createCheckpointManager({
 *   maxCheckpoints: 100,
 *   autoCheckpointFiles: false,
 * });
 * ```
 */
export function createCheckpointManager(config?: Partial<CheckpointConfig>): CheckpointManager {
  return new CheckpointManager(config);
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultManager: CheckpointManager | null = null;

/**
 * Get the default CheckpointManager instance.
 *
 * Creates a singleton instance with default configuration if one
 * doesn't already exist.
 *
 * @returns The default CheckpointManager instance
 */
export function getCheckpointManager(): CheckpointManager {
  if (!defaultManager) {
    defaultManager = new CheckpointManager();
  }
  return defaultManager;
}

/**
 * Reset the default CheckpointManager instance.
 *
 * Primarily used for testing to ensure isolation between tests.
 */
export function resetCheckpointManager(): void {
  defaultManager = null;
}
