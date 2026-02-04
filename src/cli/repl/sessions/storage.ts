/**
 * Session Storage Implementation
 *
 * Handles persisting and loading REPL sessions to disk.
 * Uses a directory-per-session structure for efficient reads and writes.
 *
 * Storage Structure:
 *   ~/.config/corbat-coco/sessions/
 *     <session-id>/
 *       metadata.json       - PersistedSession info
 *       conversation.jsonl  - Messages, one per line
 *       context.json        - Context manager state
 */

import { readFile, writeFile, mkdir, readdir, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  PersistedSession,
  SessionStorage,
  SerializedMessage,
  SerializedContext,
  SessionPersistenceConfig,
  SessionFiles,
} from "./types.js";
import type { ReplSession } from "../types.js";
import type { Message } from "../../../providers/types.js";

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default session persistence configuration
 */
const DEFAULT_CONFIG: SessionPersistenceConfig = {
  storageDir: join(homedir(), ".config", "corbat-coco", "sessions"),
  autoSaveInterval: 30000,
  maxSessionsPerProject: 20,
  compressOldSessions: false,
};

/**
 * Get the default storage directory path
 * @returns Absolute path to the default session storage directory
 */
export function getDefaultStorageDir(): string {
  return DEFAULT_CONFIG.storageDir;
}

// =============================================================================
// Session Storage Implementation
// =============================================================================

/**
 * SessionStore class implementing SessionStorage interface
 */
export class SessionStore implements SessionStorage {
  private config: SessionPersistenceConfig;
  private initialized = false;

  constructor(config: Partial<SessionPersistenceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.config.storageDir, { recursive: true });
    this.initialized = true;
  }

  private getSessionFiles(sessionId: string): SessionFiles {
    const sessionDir = this.getSessionDir(sessionId);
    return {
      metadata: join(sessionDir, "metadata.json"),
      conversation: join(sessionDir, "conversation.jsonl"),
      context: join(sessionDir, "context.json"),
    };
  }

  getSessionDir(sessionId: string): string {
    return join(this.config.storageDir, sessionId);
  }

  async exists(sessionId: string): Promise<boolean> {
    try {
      const files = this.getSessionFiles(sessionId);
      await access(files.metadata);
      return true;
    } catch {
      return false;
    }
  }

  async save(session: ReplSession): Promise<void> {
    await this.ensureInitialized();

    const files = this.getSessionFiles(session.id);
    const sessionDir = this.getSessionDir(session.id);
    await mkdir(sessionDir, { recursive: true });

    const metadata: PersistedSession = {
      id: session.id,
      projectPath: session.projectPath,
      startedAt: session.startedAt,
      lastSavedAt: new Date(),
      config: session.config,
      messageCount: session.messages.length,
      totalTokens: this.calculateTokens(session),
      title: this.generateTitle(session),
      status: "active",
    };

    await writeFile(files.metadata, JSON.stringify(metadata, null, 2), "utf-8");

    const conversationLines = session.messages.map((msg) => {
      const serialized: SerializedMessage = {
        role: msg.role,
        content: msg.content,
        timestamp: new Date().toISOString(),
      };
      return JSON.stringify(serialized);
    });

    await writeFile(files.conversation, conversationLines.join("\n"), "utf-8");

    const context: SerializedContext = {
      tokenUsage: this.calculateTokens(session),
    };

    await writeFile(files.context, JSON.stringify(context, null, 2), "utf-8");
  }

  async load(sessionId: string): Promise<ReplSession | null> {
    await this.ensureInitialized();

    const files = this.getSessionFiles(sessionId);

    try {
      const metadataContent = await readFile(files.metadata, "utf-8");
      const metadata = JSON.parse(metadataContent) as PersistedSession;

      const conversationContent = await readFile(files.conversation, "utf-8");
      const messages: Message[] = conversationContent
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const parsed = JSON.parse(line) as SerializedMessage;
          return {
            role: parsed.role,
            content: parsed.content,
          } as Message;
        });

      const session: ReplSession = {
        id: metadata.id,
        startedAt: new Date(metadata.startedAt),
        messages,
        projectPath: metadata.projectPath,
        config: metadata.config,
        trustedTools: new Set(),
      };

      return session;
    } catch {
      return null;
    }
  }

  async listSessions(projectPath?: string): Promise<PersistedSession[]> {
    await this.ensureInitialized();

    const sessions: PersistedSession[] = [];

    try {
      const entries = await readdir(this.config.storageDir, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const metadataPath = join(
          this.config.storageDir,
          entry.name,
          "metadata.json"
        );

        try {
          const content = await readFile(metadataPath, "utf-8");
          const metadata = JSON.parse(content) as PersistedSession;

          metadata.startedAt = new Date(metadata.startedAt);
          metadata.lastSavedAt = new Date(metadata.lastSavedAt);

          if (!projectPath || metadata.projectPath === projectPath) {
            sessions.push(metadata);
          }
        } catch {
          continue;
        }
      }
    } catch {
      return [];
    }

    sessions.sort(
      (a, b) =>
        new Date(b.lastSavedAt).getTime() - new Date(a.lastSavedAt).getTime()
    );

    return sessions;
  }

  async delete(sessionId: string): Promise<boolean> {
    await this.ensureInitialized();

    const sessionDir = this.getSessionDir(sessionId);

    try {
      await rm(sessionDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async getMostRecent(projectPath: string): Promise<PersistedSession | null> {
    const sessions = await this.listSessions(projectPath);
    return sessions[0] ?? null;
  }

  /**
   * Append messages to an existing session's conversation file
   * Creates the file if it doesn't exist
   * @param sessionId - The session ID
   * @param messages - Messages to append
   */
  async appendMessages(sessionId: string, messages: Message[]): Promise<void> {
    await this.ensureInitialized();

    const files = this.getSessionFiles(sessionId);
    const sessionDir = this.getSessionDir(sessionId);
    await mkdir(sessionDir, { recursive: true });

    const newLines = messages.map((msg) => {
      const serialized: SerializedMessage = {
        role: msg.role,
        content: msg.content,
        timestamp: new Date().toISOString(),
      };
      return JSON.stringify(serialized);
    });

    // Read existing content if file exists
    let existingContent = "";
    try {
      existingContent = await readFile(files.conversation, "utf-8");
      if (existingContent && !existingContent.endsWith("\n")) {
        existingContent += "\n";
      }
    } catch {
      // File doesn't exist, start fresh
    }

    await writeFile(
      files.conversation,
      existingContent + newLines.join("\n"),
      "utf-8"
    );
  }

  /**
   * Prune old sessions to keep storage manageable
   * Keeps the most recent maxSessionsPerProject sessions per project
   * @param projectPath - Optional project path to prune (prunes all if not specified)
   * @returns Number of sessions deleted
   */
  async pruneOldSessions(projectPath?: string): Promise<number> {
    await this.ensureInitialized();

    const allSessions = await this.listSessions();

    // Group sessions by project
    const sessionsByProject = new Map<string, PersistedSession[]>();
    for (const session of allSessions) {
      if (projectPath && session.projectPath !== projectPath) {
        continue;
      }

      const existing = sessionsByProject.get(session.projectPath) ?? [];
      existing.push(session);
      sessionsByProject.set(session.projectPath, existing);
    }

    let deletedCount = 0;

    // For each project, delete sessions beyond the limit
    for (const [, sessions] of sessionsByProject) {
      // Sessions are already sorted by lastSavedAt descending
      const sessionsToDelete = sessions.slice(this.config.maxSessionsPerProject);

      for (const session of sessionsToDelete) {
        const deleted = await this.delete(session.id);
        if (deleted) {
          deletedCount++;
        }
      }
    }

    return deletedCount;
  }

  private calculateTokens(session: ReplSession): { input: number; output: number } {
    if (session.contextManager) {
      const stats = session.contextManager.getUsageStats();
      return {
        input: stats.used,
        output: 0,
      };
    }

    let input = 0;
    let output = 0;

    for (const msg of session.messages) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      const tokens = Math.ceil(content.length / 4);

      if (msg.role === "user") {
        input += tokens;
      } else {
        output += tokens;
      }
    }

    return { input, output };
  }

  private generateTitle(session: ReplSession): string {
    for (const msg of session.messages) {
      if (msg.role === "user" && typeof msg.content === "string") {
        const content = msg.content.trim();
        if (content.length > 10) {
          const firstLine = content.split("\n")[0] ?? content;
          return firstLine.length > 50
            ? firstLine.slice(0, 47) + "..."
            : firstLine;
        }
      }
    }
    return "Untitled session";
  }
}

let defaultStore: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!defaultStore) {
    defaultStore = new SessionStore();
  }
  return defaultStore;
}

export function createSessionStore(
  config: Partial<SessionPersistenceConfig>
): SessionStore {
  return new SessionStore(config);
}
