/**
 * Session Persistence for the CONVERGE phase
 *
 * Handles saving and loading discovery sessions for recovery
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { DiscoverySession } from "./types.js";
import { FileSystemError } from "../../utils/errors.js";

/**
 * Paths for persisted data
 */
export interface PersistencePaths {
  /** Base directory for all CONVERGE data */
  baseDir: string;

  /** Discovery session file */
  sessionFile: string;

  /** Specification file */
  specFile: string;

  /** Conversation log */
  conversationLog: string;

  /** Checkpoint file */
  checkpointFile: string;
}

/**
 * Get persistence paths for a project
 */
export function getPersistencePaths(projectPath: string): PersistencePaths {
  const baseDir = path.join(projectPath, ".coco", "spec");

  return {
    baseDir,
    sessionFile: path.join(baseDir, "discovery-session.json"),
    specFile: path.join(baseDir, "spec.md"),
    conversationLog: path.join(baseDir, "conversation.jsonl"),
    checkpointFile: path.join(baseDir, "checkpoint.json"),
  };
}

/**
 * Session persistence manager
 */
export class SessionPersistence {
  private paths: PersistencePaths;

  constructor(projectPath: string) {
    this.paths = getPersistencePaths(projectPath);
  }

  /**
   * Ensure the persistence directory exists
   */
  async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.paths.baseDir, { recursive: true });
    } catch {
      throw new FileSystemError(
        `Failed to create persistence directory: ${this.paths.baseDir}`,
        { path: this.paths.baseDir, operation: "write" }
      );
    }
  }

  /**
   * Save a discovery session
   */
  async saveSession(session: DiscoverySession): Promise<void> {
    await this.ensureDir();

    try {
      const data = JSON.stringify(session, null, 2);
      await fs.writeFile(this.paths.sessionFile, data, "utf-8");
    } catch {
      throw new FileSystemError(
        "Failed to save discovery session",
        { path: this.paths.sessionFile, operation: "write" }
      );
    }
  }

  /**
   * Load a discovery session
   */
  async loadSession(): Promise<DiscoverySession | null> {
    try {
      const data = await fs.readFile(this.paths.sessionFile, "utf-8");
      const parsed = JSON.parse(data) as DiscoverySession;

      // Convert date strings back to Date objects
      parsed.startedAt = new Date(parsed.startedAt);
      parsed.updatedAt = new Date(parsed.updatedAt);

      for (const msg of parsed.conversation) {
        msg.timestamp = new Date(msg.timestamp);
      }

      for (const clarification of parsed.clarifications) {
        clarification.timestamp = new Date(clarification.timestamp);
      }

      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw new FileSystemError(
        "Failed to load discovery session",
        { path: this.paths.sessionFile, operation: "read" }
      );
    }
  }

  /**
   * Check if a session exists
   */
  async hasSession(): Promise<boolean> {
    try {
      await fs.access(this.paths.sessionFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(): Promise<void> {
    try {
      await fs.unlink(this.paths.sessionFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new FileSystemError(
          "Failed to delete discovery session",
          { path: this.paths.sessionFile, operation: "delete" }
        );
      }
    }
  }

  /**
   * Save the specification markdown
   */
  async saveSpecification(content: string): Promise<void> {
    await this.ensureDir();

    try {
      await fs.writeFile(this.paths.specFile, content, "utf-8");
    } catch {
      throw new FileSystemError(
        "Failed to save specification",
        { path: this.paths.specFile, operation: "write" }
      );
    }
  }

  /**
   * Load the specification markdown
   */
  async loadSpecification(): Promise<string | null> {
    try {
      return await fs.readFile(this.paths.specFile, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Append a message to the conversation log
   */
  async appendConversation(
    role: "user" | "assistant",
    content: string
  ): Promise<void> {
    await this.ensureDir();

    const entry = {
      timestamp: new Date().toISOString(),
      role,
      content,
    };

    try {
      await fs.appendFile(
        this.paths.conversationLog,
        JSON.stringify(entry) + "\n",
        "utf-8"
      );
    } catch {
      throw new FileSystemError(
        "Failed to append to conversation log",
        { path: this.paths.conversationLog, operation: "write" }
      );
    }
  }

  /**
   * Load the full conversation log
   */
  async loadConversationLog(): Promise<
    Array<{ timestamp: string; role: string; content: string }>
  > {
    try {
      const data = await fs.readFile(this.paths.conversationLog, "utf-8");
      const lines = data.trim().split("\n");
      return lines
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as { timestamp: string; role: string; content: string });
    } catch {
      return [];
    }
  }

  /**
   * Save a checkpoint
   */
  async saveCheckpoint(checkpoint: ConvergeCheckpoint): Promise<void> {
    await this.ensureDir();

    try {
      const data = JSON.stringify(checkpoint, null, 2);
      await fs.writeFile(this.paths.checkpointFile, data, "utf-8");
    } catch {
      throw new FileSystemError(
        "Failed to save checkpoint",
        { path: this.paths.checkpointFile, operation: "write" }
      );
    }
  }

  /**
   * Load a checkpoint
   */
  async loadCheckpoint(): Promise<ConvergeCheckpoint | null> {
    try {
      const data = await fs.readFile(this.paths.checkpointFile, "utf-8");
      const parsed = JSON.parse(data) as ConvergeCheckpoint;
      parsed.timestamp = new Date(parsed.timestamp);
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Clear all persisted data
   */
  async clearAll(): Promise<void> {
    try {
      await fs.rm(this.paths.baseDir, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new FileSystemError(
          "Failed to clear persistence data",
          { path: this.paths.baseDir, operation: "delete" }
        );
      }
    }
  }

  /**
   * Get the specification file path
   */
  getSpecPath(): string {
    return this.paths.specFile;
  }
}

/**
 * Checkpoint data for CONVERGE phase
 */
export interface ConvergeCheckpoint {
  /** Checkpoint ID */
  id: string;

  /** When the checkpoint was created */
  timestamp: Date;

  /** Current step in the converge process */
  step: ConvergeStep;

  /** Session ID being processed */
  sessionId: string;

  /** Progress percentage */
  progress: number;

  /** Whether spec has been generated */
  specGenerated: boolean;

  /** Metadata for resumption */
  metadata: Record<string, unknown>;
}

/**
 * Steps in the CONVERGE process
 */
export type ConvergeStep =
  | "init"
  | "discovery"
  | "clarification"
  | "refinement"
  | "spec_generation"
  | "complete";

/**
 * Create a checkpoint
 */
export function createCheckpoint(
  sessionId: string,
  step: ConvergeStep,
  progress: number,
  specGenerated: boolean = false,
  metadata: Record<string, unknown> = {}
): ConvergeCheckpoint {
  return {
    id: `converge-${Date.now()}`,
    timestamp: new Date(),
    step,
    sessionId,
    progress,
    specGenerated,
    metadata,
  };
}

/**
 * Session manager that combines persistence with session operations
 */
export class SessionManager {
  private persistence: SessionPersistence;

  constructor(projectPath: string) {
    this.persistence = new SessionPersistence(projectPath);
  }

  /**
   * Get the persistence layer
   */
  getPersistence(): SessionPersistence {
    return this.persistence;
  }

  /**
   * Save session with automatic checkpoint
   */
  async saveWithCheckpoint(
    session: DiscoverySession,
    step: ConvergeStep,
    progress: number
  ): Promise<void> {
    await this.persistence.saveSession(session);

    const checkpoint = createCheckpoint(
      session.id,
      step,
      progress,
      session.status === "spec_generated"
    );
    await this.persistence.saveCheckpoint(checkpoint);
  }

  /**
   * Resume from last checkpoint
   */
  async resume(): Promise<{
    session: DiscoverySession;
    checkpoint: ConvergeCheckpoint;
  } | null> {
    const checkpoint = await this.persistence.loadCheckpoint();
    if (!checkpoint) return null;

    const session = await this.persistence.loadSession();
    if (!session) return null;

    return { session, checkpoint };
  }

  /**
   * Check if can resume
   */
  async canResume(): Promise<boolean> {
    const checkpoint = await this.persistence.loadCheckpoint();
    return checkpoint !== null && checkpoint.step !== "complete";
  }

  /**
   * Get resume info without loading full session
   */
  async getResumeInfo(): Promise<{
    sessionId: string;
    step: ConvergeStep;
    progress: number;
    timestamp: Date;
  } | null> {
    const checkpoint = await this.persistence.loadCheckpoint();
    if (!checkpoint) return null;

    return {
      sessionId: checkpoint.sessionId,
      step: checkpoint.step,
      progress: checkpoint.progress,
      timestamp: checkpoint.timestamp,
    };
  }

  /**
   * Complete the session and save specification
   */
  async complete(session: DiscoverySession, specMarkdown: string): Promise<void> {
    session.status = "spec_generated";
    session.updatedAt = new Date();

    await this.persistence.saveSession(session);
    await this.persistence.saveSpecification(specMarkdown);

    const checkpoint = createCheckpoint(
      session.id,
      "complete",
      100,
      true
    );
    await this.persistence.saveCheckpoint(checkpoint);
  }
}

/**
 * Create a session manager for a project
 */
export function createSessionManager(projectPath: string): SessionManager {
  return new SessionManager(projectPath);
}
