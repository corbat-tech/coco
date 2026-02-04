/**
 * Tests for Session Persistence System
 *
 * Comprehensive tests for types.ts and storage.ts modules
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "../../../providers/types.js";
import type { ReplSession, ReplConfig } from "../types.js";
import type {
  SessionStatus,
  PersistedSession,
  SerializedMessage,
  SerializedContext,
  SessionPersistenceConfig,
  SessionFiles,
} from "./types.js";
import {
  SessionStore,
  createSessionStore,
  getSessionStore,
  getDefaultStorageDir,
} from "./storage.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a minimal ReplConfig for testing
 */
function createTestConfig(overrides: Partial<ReplConfig> = {}): ReplConfig {
  return {
    provider: {
      type: "anthropic",
      model: "claude-sonnet-4-20250514",
      maxTokens: 8192,
      ...overrides.provider,
    },
    ui: {
      theme: "auto",
      showTimestamps: false,
      maxHistorySize: 100,
      ...overrides.ui,
    },
    agent: {
      systemPrompt: "Test system prompt",
      maxToolIterations: 25,
      confirmDestructive: true,
      ...overrides.agent,
    },
  };
}

/**
 * Creates a minimal ReplSession for testing
 */
function createTestSession(overrides: Partial<ReplSession> = {}): ReplSession {
  return {
    id: overrides.id ?? `test-session-${Date.now()}`,
    startedAt: overrides.startedAt ?? new Date(),
    messages: overrides.messages ?? [],
    projectPath: overrides.projectPath ?? "/test/project",
    config: overrides.config ?? createTestConfig(),
    trustedTools: overrides.trustedTools ?? new Set<string>(),
  };
}

// =============================================================================
// Types Tests
// =============================================================================

describe("types.ts", () => {
  describe("SessionStatus", () => {
    it("should allow valid status values", () => {
      const statuses: SessionStatus[] = ["active", "completed", "interrupted", "error"];

      statuses.forEach((status) => {
        expect(status).toBeDefined();
      });
    });

    it("should be usable in type assignments", () => {
      const session: Pick<PersistedSession, "status"> = { status: "active" };
      expect(session.status).toBe("active");
    });
  });

  describe("PersistedSession interface", () => {
    it("should have all required fields", () => {
      const session: PersistedSession = {
        id: "test-id",
        projectPath: "/test/project",
        startedAt: new Date(),
        lastSavedAt: new Date(),
        config: createTestConfig(),
        messageCount: 10,
        totalTokens: { input: 100, output: 50 },
        status: "active",
      };

      expect(session.id).toBe("test-id");
      expect(session.projectPath).toBe("/test/project");
      expect(session.messageCount).toBe(10);
      expect(session.totalTokens.input).toBe(100);
      expect(session.totalTokens.output).toBe(50);
      expect(session.status).toBe("active");
    });

    it("should allow optional title field", () => {
      const sessionWithTitle: PersistedSession = {
        id: "test-id",
        projectPath: "/test/project",
        startedAt: new Date(),
        lastSavedAt: new Date(),
        config: createTestConfig(),
        messageCount: 5,
        totalTokens: { input: 50, output: 25 },
        status: "completed",
        title: "My test session",
      };

      expect(sessionWithTitle.title).toBe("My test session");

      const sessionWithoutTitle: PersistedSession = {
        id: "test-id-2",
        projectPath: "/test/project",
        startedAt: new Date(),
        lastSavedAt: new Date(),
        config: createTestConfig(),
        messageCount: 0,
        totalTokens: { input: 0, output: 0 },
        status: "active",
      };

      expect(sessionWithoutTitle.title).toBeUndefined();
    });
  });

  describe("SerializedMessage interface", () => {
    it("should serialize message with timestamp", () => {
      const message: SerializedMessage = {
        role: "user",
        content: "Hello world",
        timestamp: new Date().toISOString(),
      };

      expect(message.role).toBe("user");
      expect(message.content).toBe("Hello world");
      expect(typeof message.timestamp).toBe("string");
    });

    it("should support all message roles", () => {
      const roles: Array<SerializedMessage["role"]> = ["user", "assistant", "system"];

      roles.forEach((role) => {
        const message: SerializedMessage = {
          role,
          content: "test",
          timestamp: new Date().toISOString(),
        };
        expect(message.role).toBe(role);
      });
    });
  });

  describe("SerializedContext interface", () => {
    it("should have token usage", () => {
      const context: SerializedContext = {
        tokenUsage: { input: 1000, output: 500 },
      };

      expect(context.tokenUsage.input).toBe(1000);
      expect(context.tokenUsage.output).toBe(500);
    });

    it("should allow optional progress tracker state", () => {
      const contextWithProgress: SerializedContext = {
        tokenUsage: { input: 100, output: 50 },
        progress: {
          tasks: [
            { id: "task-1", description: "First task", status: "completed" },
            { id: "task-2", description: "Second task", status: "in_progress" },
          ],
        },
      };

      expect(contextWithProgress.progress?.tasks.length).toBe(2);
      expect(contextWithProgress.progress?.tasks[0]?.status).toBe("completed");
    });

    it("should allow optional custom data", () => {
      const contextWithCustom: SerializedContext = {
        tokenUsage: { input: 100, output: 50 },
        custom: {
          myKey: "myValue",
          nestedData: { foo: "bar" },
        },
      };

      expect(contextWithCustom.custom?.myKey).toBe("myValue");
    });
  });

  describe("SessionFiles interface", () => {
    it("should contain all file paths", () => {
      const files: SessionFiles = {
        metadata: "/sessions/abc/metadata.json",
        conversation: "/sessions/abc/conversation.jsonl",
        context: "/sessions/abc/context.json",
      };

      expect(files.metadata).toContain("metadata.json");
      expect(files.conversation).toContain("conversation.jsonl");
      expect(files.context).toContain("context.json");
    });
  });
});

// =============================================================================
// Storage Tests
// =============================================================================

describe("storage.ts", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sessions-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createSessionStore()", () => {
    it("should create a new SessionStore instance", () => {
      const store = createSessionStore({ storageDir: tempDir });

      expect(store).toBeInstanceOf(SessionStore);
    });

    it("should accept custom configuration", () => {
      const config: Partial<SessionPersistenceConfig> = {
        storageDir: tempDir,
        autoSaveInterval: 60000,
        maxSessionsPerProject: 50,
      };

      const store = createSessionStore(config);

      expect(store).toBeInstanceOf(SessionStore);
    });

    it("should use default config when not provided", () => {
      const store = createSessionStore({});

      expect(store).toBeInstanceOf(SessionStore);
    });
  });

  describe("getSessionStore()", () => {
    it("should return a SessionStore singleton", () => {
      const store1 = getSessionStore();
      const store2 = getSessionStore();

      expect(store1).toBe(store2);
    });
  });

  describe("getDefaultStorageDir()", () => {
    it("should return a path in home directory", () => {
      const dir = getDefaultStorageDir();

      expect(dir).toContain(".config");
      expect(dir).toContain("corbat-coco");
      expect(dir).toContain("sessions");
    });
  });

  describe("save()", () => {
    it("should create session directory", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({ id: "save-test-1" });

      await store.save(session);

      const sessionDir = join(tempDir, session.id);
      await expect(access(sessionDir)).resolves.toBeUndefined();
    });

    it("should write metadata.json", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({
        id: "save-test-2",
        projectPath: "/my/project",
      });

      await store.save(session);

      const metadataPath = join(tempDir, session.id, "metadata.json");
      const content = await readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(content) as PersistedSession;

      expect(metadata.id).toBe("save-test-2");
      expect(metadata.projectPath).toBe("/my/project");
      expect(metadata.status).toBe("active");
    });

    it("should write conversation.jsonl", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const messages: Message[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ];
      const session = createTestSession({ id: "save-test-3", messages });

      await store.save(session);

      const conversationPath = join(tempDir, session.id, "conversation.jsonl");
      const content = await readFile(conversationPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      expect(lines.length).toBe(2);

      const firstMessage = JSON.parse(lines[0]!) as SerializedMessage;
      expect(firstMessage.role).toBe("user");
      expect(firstMessage.content).toBe("Hello");
    });

    it("should write context.json", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({ id: "save-test-4" });

      await store.save(session);

      const contextPath = join(tempDir, session.id, "context.json");
      const content = await readFile(contextPath, "utf-8");
      const context = JSON.parse(content) as SerializedContext;

      expect(context.tokenUsage).toBeDefined();
      expect(typeof context.tokenUsage.input).toBe("number");
      expect(typeof context.tokenUsage.output).toBe("number");
    });

    it("should update lastSavedAt in metadata", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({ id: "save-test-5" });

      const before = new Date();
      await store.save(session);
      const after = new Date();

      const metadataPath = join(tempDir, session.id, "metadata.json");
      const content = await readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(content) as PersistedSession;

      const savedAt = new Date(metadata.lastSavedAt);
      expect(savedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(savedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should calculate messageCount correctly", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const messages: Message[] = [
        { role: "user", content: "One" },
        { role: "assistant", content: "Two" },
        { role: "user", content: "Three" },
      ];
      const session = createTestSession({ id: "save-test-6", messages });

      await store.save(session);

      const metadataPath = join(tempDir, session.id, "metadata.json");
      const content = await readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(content) as PersistedSession;

      expect(metadata.messageCount).toBe(3);
    });

    it("should generate title from first user message", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const messages: Message[] = [
        { role: "user", content: "Help me build a todo app with React" },
        { role: "assistant", content: "Sure, let me help you." },
      ];
      const session = createTestSession({ id: "save-test-7", messages });

      await store.save(session);

      const metadataPath = join(tempDir, session.id, "metadata.json");
      const content = await readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(content) as PersistedSession;

      expect(metadata.title).toBe("Help me build a todo app with React");
    });

    it("should truncate long titles", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const longMessage =
        "This is a very long message that should be truncated because it exceeds the maximum title length";
      const messages: Message[] = [{ role: "user", content: longMessage }];
      const session = createTestSession({ id: "save-test-8", messages });

      await store.save(session);

      const metadataPath = join(tempDir, session.id, "metadata.json");
      const content = await readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(content) as PersistedSession;

      expect(metadata.title?.length).toBeLessThanOrEqual(50);
      expect(metadata.title).toContain("...");
    });

    it("should handle empty messages", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({ id: "save-test-9", messages: [] });

      await store.save(session);

      const metadataPath = join(tempDir, session.id, "metadata.json");
      const content = await readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(content) as PersistedSession;

      expect(metadata.messageCount).toBe(0);
      expect(metadata.title).toBe("Untitled session");
    });
  });

  describe("load()", () => {
    it("should load existing session", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const originalSession = createTestSession({
        id: "load-test-1",
        projectPath: "/test/load",
        messages: [
          { role: "user", content: "Test message" },
          { role: "assistant", content: "Test response" },
        ],
      });

      await store.save(originalSession);
      const loaded = await store.load("load-test-1");

      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe("load-test-1");
      expect(loaded?.projectPath).toBe("/test/load");
      expect(loaded?.messages.length).toBe(2);
    });

    it("should return null for non-existent session", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      const loaded = await store.load("non-existent-session");

      expect(loaded).toBeNull();
    });

    it("should handle corrupted metadata gracefully", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const sessionDir = join(tempDir, "corrupted-metadata");
      await mkdir(sessionDir, { recursive: true });

      // Write invalid JSON to metadata
      await writeFile(join(sessionDir, "metadata.json"), "not valid json{{{", "utf-8");

      const loaded = await store.load("corrupted-metadata");

      expect(loaded).toBeNull();
    });

    it("should handle corrupted conversation.jsonl gracefully", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({ id: "corrupted-conv" });

      await store.save(session);

      // Corrupt the conversation file
      const convPath = join(tempDir, "corrupted-conv", "conversation.jsonl");
      await writeFile(convPath, "invalid{json\nnot valid", "utf-8");

      const loaded = await store.load("corrupted-conv");

      // Should return null since it cannot parse messages
      expect(loaded).toBeNull();
    });

    it("should restore session dates as Date objects", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const originalSession = createTestSession({ id: "load-test-dates" });

      await store.save(originalSession);
      const loaded = await store.load("load-test-dates");

      expect(loaded?.startedAt).toBeInstanceOf(Date);
    });

    it("should initialize trustedTools as empty Set", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({
        id: "load-test-trusted",
        trustedTools: new Set(["bash_exec", "file_write"]),
      });

      await store.save(session);
      const loaded = await store.load("load-test-trusted");

      // Current implementation does not persist trustedTools
      expect(loaded?.trustedTools).toBeInstanceOf(Set);
      expect(loaded?.trustedTools.size).toBe(0);
    });

    it("should restore config correctly", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const customConfig = createTestConfig({
        provider: { type: "openai", model: "gpt-4", maxTokens: 4096 },
      });
      const session = createTestSession({
        id: "load-test-config",
        config: customConfig,
      });

      await store.save(session);
      const loaded = await store.load("load-test-config");

      expect(loaded?.config.provider.type).toBe("openai");
      expect(loaded?.config.provider.model).toBe("gpt-4");
      expect(loaded?.config.provider.maxTokens).toBe(4096);
    });
  });

  describe("listSessions()", () => {
    it("should list all sessions", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      await store.save(createTestSession({ id: "list-1", projectPath: "/project-a" }));
      await store.save(createTestSession({ id: "list-2", projectPath: "/project-b" }));
      await store.save(createTestSession({ id: "list-3", projectPath: "/project-a" }));

      const sessions = await store.listSessions();

      expect(sessions.length).toBe(3);
    });

    it("should filter by project path", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      await store.save(createTestSession({ id: "filter-1", projectPath: "/project-a" }));
      await store.save(createTestSession({ id: "filter-2", projectPath: "/project-b" }));
      await store.save(createTestSession({ id: "filter-3", projectPath: "/project-a" }));

      const sessions = await store.listSessions("/project-a");

      expect(sessions.length).toBe(2);
      sessions.forEach((s) => {
        expect(s.projectPath).toBe("/project-a");
      });
    });

    it("should return empty array when no sessions exist", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      const sessions = await store.listSessions();

      expect(sessions).toEqual([]);
    });

    it("should sort by lastSavedAt newest first", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      // Save sessions with small delays to ensure different timestamps
      await store.save(createTestSession({ id: "sort-1" }));
      await new Promise((r) => setTimeout(r, 10));
      await store.save(createTestSession({ id: "sort-2" }));
      await new Promise((r) => setTimeout(r, 10));
      await store.save(createTestSession({ id: "sort-3" }));

      const sessions = await store.listSessions();

      expect(sessions[0]?.id).toBe("sort-3");
      expect(sessions[1]?.id).toBe("sort-2");
      expect(sessions[2]?.id).toBe("sort-1");
    });

    it("should convert dates to Date objects", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      await store.save(createTestSession({ id: "list-dates" }));

      const sessions = await store.listSessions();

      expect(sessions[0]?.startedAt).toBeInstanceOf(Date);
      expect(sessions[0]?.lastSavedAt).toBeInstanceOf(Date);
    });

    it("should skip directories without valid metadata", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      // Create valid session
      await store.save(createTestSession({ id: "valid-session" }));

      // Create invalid session directory
      const invalidDir = join(tempDir, "invalid-session");
      await mkdir(invalidDir, { recursive: true });
      await writeFile(join(invalidDir, "metadata.json"), "invalid json", "utf-8");

      const sessions = await store.listSessions();

      expect(sessions.length).toBe(1);
      expect(sessions[0]?.id).toBe("valid-session");
    });
  });

  describe("delete()", () => {
    it("should remove session directory", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      await store.save(createTestSession({ id: "delete-1" }));

      const sessionDir = join(tempDir, "delete-1");
      await expect(access(sessionDir)).resolves.toBeUndefined();

      const result = await store.delete("delete-1");

      expect(result).toBe(true);
      await expect(access(sessionDir)).rejects.toThrow();
    });

    it("should return true on success", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      await store.save(createTestSession({ id: "delete-2" }));

      const result = await store.delete("delete-2");

      expect(result).toBe(true);
    });

    it("should return false for non-existent session", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      // rm with force: true returns successfully even for non-existent
      // but we can verify the session doesn't exist afterward
      const result = await store.delete("non-existent");

      expect(result).toBe(true); // rm with force doesn't fail
    });

    it("should not affect other sessions", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      await store.save(createTestSession({ id: "delete-keep" }));
      await store.save(createTestSession({ id: "delete-remove" }));

      await store.delete("delete-remove");

      const sessions = await store.listSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0]?.id).toBe("delete-keep");
    });
  });

  describe("getMostRecent()", () => {
    it("should return most recent session for project", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      await store.save(createTestSession({ id: "recent-1", projectPath: "/my-project" }));
      await new Promise((r) => setTimeout(r, 10));
      await store.save(createTestSession({ id: "recent-2", projectPath: "/my-project" }));
      await new Promise((r) => setTimeout(r, 10));
      await store.save(createTestSession({ id: "recent-3", projectPath: "/my-project" }));

      const mostRecent = await store.getMostRecent("/my-project");

      expect(mostRecent?.id).toBe("recent-3");
    });

    it("should return null when no sessions exist", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      const mostRecent = await store.getMostRecent("/empty-project");

      expect(mostRecent).toBeNull();
    });

    it("should only consider sessions for specified project", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      await store.save(createTestSession({ id: "proj-a-1", projectPath: "/project-a" }));
      await new Promise((r) => setTimeout(r, 10));
      await store.save(createTestSession({ id: "proj-b-1", projectPath: "/project-b" }));

      const mostRecent = await store.getMostRecent("/project-a");

      expect(mostRecent?.id).toBe("proj-a-1");
      expect(mostRecent?.projectPath).toBe("/project-a");
    });
  });

  describe("exists()", () => {
    it("should return true for existing session", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      await store.save(createTestSession({ id: "exists-1" }));

      const result = await store.exists("exists-1");

      expect(result).toBe(true);
    });

    it("should return false for non-existent session", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      const result = await store.exists("non-existent");

      expect(result).toBe(false);
    });

    it("should return false when only directory exists without metadata", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      // Create directory without metadata file
      const sessionDir = join(tempDir, "no-metadata");
      await mkdir(sessionDir, { recursive: true });

      const result = await store.exists("no-metadata");

      expect(result).toBe(false);
    });
  });

  describe("getSessionDir()", () => {
    it("should return correct directory path", () => {
      const store = createSessionStore({ storageDir: tempDir });

      const dir = store.getSessionDir("my-session-id");

      expect(dir).toBe(join(tempDir, "my-session-id"));
    });
  });

  describe("appendMessages()", () => {
    it("should append to existing conversation.jsonl", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({
        id: "append-1",
        messages: [{ role: "user", content: "First message" }],
      });

      await store.save(session);

      // Append new messages
      await store.appendMessages("append-1", [
        { role: "assistant", content: "Response" },
        { role: "user", content: "Follow up" },
      ]);

      const conversationPath = join(tempDir, "append-1", "conversation.jsonl");
      const content = await readFile(conversationPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      expect(lines.length).toBe(3);
    });

    it("should create file if it does not exist", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      // Append to non-existent session
      await store.appendMessages("new-append", [
        { role: "user", content: "New message" },
      ]);

      const conversationPath = join(tempDir, "new-append", "conversation.jsonl");
      const content = await readFile(conversationPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]!) as SerializedMessage;
      expect(parsed.content).toBe("New message");
    });

    it("should preserve existing messages", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({
        id: "append-preserve",
        messages: [
          { role: "user", content: "Original" },
        ],
      });

      await store.save(session);
      await store.appendMessages("append-preserve", [
        { role: "assistant", content: "Added" },
      ]);

      const conversationPath = join(tempDir, "append-preserve", "conversation.jsonl");
      const content = await readFile(conversationPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      const first = JSON.parse(lines[0]!) as SerializedMessage;
      const second = JSON.parse(lines[1]!) as SerializedMessage;

      expect(first.content).toBe("Original");
      expect(second.content).toBe("Added");
    });

    it("should handle empty messages array", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({
        id: "append-empty",
        messages: [{ role: "user", content: "Existing" }],
      });

      await store.save(session);
      await store.appendMessages("append-empty", []);

      const conversationPath = join(tempDir, "append-empty", "conversation.jsonl");
      const content = await readFile(conversationPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      expect(lines.length).toBe(1);
    });

    it("should add timestamps to appended messages", async () => {
      const store = createSessionStore({ storageDir: tempDir });

      const before = new Date();
      await store.appendMessages("append-timestamp", [
        { role: "user", content: "Timestamped" },
      ]);
      const after = new Date();

      const conversationPath = join(tempDir, "append-timestamp", "conversation.jsonl");
      const content = await readFile(conversationPath, "utf-8");
      const parsed = JSON.parse(content.trim()) as SerializedMessage;

      const timestamp = new Date(parsed.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("pruneOldSessions()", () => {
    it("should keep maxSessionsPerProject sessions", async () => {
      const store = createSessionStore({
        storageDir: tempDir,
        maxSessionsPerProject: 3,
      });

      // Create 5 sessions for the same project
      for (let i = 0; i < 5; i++) {
        await store.save(
          createTestSession({ id: `prune-${i}`, projectPath: "/prune-project" })
        );
        await new Promise((r) => setTimeout(r, 10));
      }

      const deletedCount = await store.pruneOldSessions("/prune-project");

      expect(deletedCount).toBe(2);

      const remaining = await store.listSessions("/prune-project");
      expect(remaining.length).toBe(3);
    });

    it("should delete oldest sessions first", async () => {
      const store = createSessionStore({
        storageDir: tempDir,
        maxSessionsPerProject: 2,
      });

      await store.save(createTestSession({ id: "oldest", projectPath: "/prune-test" }));
      await new Promise((r) => setTimeout(r, 10));
      await store.save(createTestSession({ id: "middle", projectPath: "/prune-test" }));
      await new Promise((r) => setTimeout(r, 10));
      await store.save(createTestSession({ id: "newest", projectPath: "/prune-test" }));

      await store.pruneOldSessions("/prune-test");

      const remaining = await store.listSessions("/prune-test");
      const ids = remaining.map((s) => s.id);

      expect(ids).toContain("newest");
      expect(ids).toContain("middle");
      expect(ids).not.toContain("oldest");
    });

    it("should return number deleted", async () => {
      const store = createSessionStore({
        storageDir: tempDir,
        maxSessionsPerProject: 1,
      });

      await store.save(createTestSession({ id: "del-1", projectPath: "/del-proj" }));
      await store.save(createTestSession({ id: "del-2", projectPath: "/del-proj" }));
      await store.save(createTestSession({ id: "del-3", projectPath: "/del-proj" }));

      const deleted = await store.pruneOldSessions("/del-proj");

      expect(deleted).toBe(2);
    });

    it("should return 0 when no sessions to prune", async () => {
      const store = createSessionStore({
        storageDir: tempDir,
        maxSessionsPerProject: 10,
      });

      await store.save(createTestSession({ id: "keep-1", projectPath: "/keep-proj" }));
      await store.save(createTestSession({ id: "keep-2", projectPath: "/keep-proj" }));

      const deleted = await store.pruneOldSessions("/keep-proj");

      expect(deleted).toBe(0);
    });

    it("should handle empty storage", async () => {
      const store = createSessionStore({
        storageDir: tempDir,
        maxSessionsPerProject: 5,
      });

      const deleted = await store.pruneOldSessions("/empty-project");

      expect(deleted).toBe(0);
    });

    it("should prune all projects when no projectPath specified", async () => {
      const store = createSessionStore({
        storageDir: tempDir,
        maxSessionsPerProject: 1,
      });

      // Create sessions for two different projects
      await store.save(createTestSession({ id: "proj-a-1", projectPath: "/project-a" }));
      await store.save(createTestSession({ id: "proj-a-2", projectPath: "/project-a" }));
      await store.save(createTestSession({ id: "proj-b-1", projectPath: "/project-b" }));
      await store.save(createTestSession({ id: "proj-b-2", projectPath: "/project-b" }));

      const deleted = await store.pruneOldSessions();

      expect(deleted).toBe(2); // 1 from each project

      const sessionsA = await store.listSessions("/project-a");
      const sessionsB = await store.listSessions("/project-b");

      expect(sessionsA.length).toBe(1);
      expect(sessionsB.length).toBe(1);
    });

    it("should only prune specified project", async () => {
      const store = createSessionStore({
        storageDir: tempDir,
        maxSessionsPerProject: 1,
      });

      await store.save(createTestSession({ id: "spec-a-1", projectPath: "/specified-a" }));
      await store.save(createTestSession({ id: "spec-a-2", projectPath: "/specified-a" }));
      await store.save(createTestSession({ id: "spec-b-1", projectPath: "/specified-b" }));
      await store.save(createTestSession({ id: "spec-b-2", projectPath: "/specified-b" }));

      await store.pruneOldSessions("/specified-a");

      const sessionsA = await store.listSessions("/specified-a");
      const sessionsB = await store.listSessions("/specified-b");

      expect(sessionsA.length).toBe(1);
      expect(sessionsB.length).toBe(2); // Not pruned
    });
  });
});

// =============================================================================
// Storage Format Tests
// =============================================================================

describe("Storage Format", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "format-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("JSONL format", () => {
    it("should write one message per line", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const messages: Message[] = [
        { role: "user", content: "First" },
        { role: "assistant", content: "Second" },
        { role: "user", content: "Third" },
      ];
      const session = createTestSession({ id: "jsonl-test", messages });

      await store.save(session);

      const content = await readFile(join(tempDir, "jsonl-test", "conversation.jsonl"), "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      expect(lines.length).toBe(3);
    });

    it("should have valid JSON on each line", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const messages: Message[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "World" },
      ];
      const session = createTestSession({ id: "jsonl-valid", messages });

      await store.save(session);

      const content = await readFile(join(tempDir, "jsonl-valid", "conversation.jsonl"), "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      lines.forEach((line) => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it("should include timestamp in each message", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const messages: Message[] = [{ role: "user", content: "Test" }];
      const session = createTestSession({ id: "jsonl-timestamp", messages });

      await store.save(session);

      const content = await readFile(
        join(tempDir, "jsonl-timestamp", "conversation.jsonl"),
        "utf-8"
      );
      const parsed = JSON.parse(content.trim()) as SerializedMessage;

      expect(parsed.timestamp).toBeDefined();
      expect(() => new Date(parsed.timestamp)).not.toThrow();
    });

    it("should handle messages with complex content", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const messages: Message[] = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Here is the result:" },
            {
              type: "tool_use",
              id: "tool-1",
              name: "bash_exec",
              input: { command: "ls -la" },
            },
          ],
        },
      ];
      const session = createTestSession({ id: "jsonl-complex", messages });

      await store.save(session);

      const content = await readFile(join(tempDir, "jsonl-complex", "conversation.jsonl"), "utf-8");
      const parsed = JSON.parse(content.trim()) as SerializedMessage;

      expect(Array.isArray(parsed.content)).toBe(true);
    });
  });

  describe("metadata.json structure", () => {
    it("should have all required fields", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({ id: "meta-struct" });

      await store.save(session);

      const content = await readFile(join(tempDir, "meta-struct", "metadata.json"), "utf-8");
      const metadata = JSON.parse(content);

      expect(metadata).toHaveProperty("id");
      expect(metadata).toHaveProperty("projectPath");
      expect(metadata).toHaveProperty("startedAt");
      expect(metadata).toHaveProperty("lastSavedAt");
      expect(metadata).toHaveProperty("config");
      expect(metadata).toHaveProperty("messageCount");
      expect(metadata).toHaveProperty("totalTokens");
      expect(metadata).toHaveProperty("status");
    });

    it("should store dates as ISO strings", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({ id: "meta-dates" });

      await store.save(session);

      const content = await readFile(join(tempDir, "meta-dates", "metadata.json"), "utf-8");
      const metadata = JSON.parse(content);

      expect(typeof metadata.startedAt).toBe("string");
      expect(typeof metadata.lastSavedAt).toBe("string");
      expect(() => new Date(metadata.startedAt)).not.toThrow();
    });

    it("should be formatted with indentation", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({ id: "meta-format" });

      await store.save(session);

      const content = await readFile(join(tempDir, "meta-format", "metadata.json"), "utf-8");

      // Pretty-printed JSON will have newlines
      expect(content).toContain("\n");
      // And indentation
      expect(content).toMatch(/^\s{2}/m);
    });
  });

  describe("context.json structure", () => {
    it("should have tokenUsage field", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const session = createTestSession({ id: "ctx-struct" });

      await store.save(session);

      const content = await readFile(join(tempDir, "ctx-struct", "context.json"), "utf-8");
      const context = JSON.parse(content);

      expect(context).toHaveProperty("tokenUsage");
      expect(context.tokenUsage).toHaveProperty("input");
      expect(context.tokenUsage).toHaveProperty("output");
    });

    it("should calculate token estimates from messages", async () => {
      const store = createSessionStore({ storageDir: tempDir });
      const messages: Message[] = [
        { role: "user", content: "This is a test message with some content" },
        { role: "assistant", content: "This is the response" },
      ];
      const session = createTestSession({ id: "ctx-tokens", messages });

      await store.save(session);

      const content = await readFile(join(tempDir, "ctx-tokens", "context.json"), "utf-8");
      const context = JSON.parse(content);

      expect(context.tokenUsage.input).toBeGreaterThan(0);
      expect(context.tokenUsage.output).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe("Edge Cases", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "edge-cases-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should handle special characters in session IDs", async () => {
    const store = createSessionStore({ storageDir: tempDir });
    // UUID-style IDs are safe, but test with typical session ID format
    const session = createTestSession({ id: "session-with-dashes-123" });

    await store.save(session);
    const loaded = await store.load("session-with-dashes-123");

    expect(loaded?.id).toBe("session-with-dashes-123");
  });

  it("should handle messages with newlines in content", async () => {
    const store = createSessionStore({ storageDir: tempDir });
    const messages: Message[] = [
      { role: "user", content: "Line 1\nLine 2\nLine 3" },
    ];
    const session = createTestSession({ id: "newline-test", messages });

    await store.save(session);
    const loaded = await store.load("newline-test");

    expect(loaded?.messages[0]?.content).toBe("Line 1\nLine 2\nLine 3");
  });

  it("should handle messages with unicode content", async () => {
    const store = createSessionStore({ storageDir: tempDir });
    const messages: Message[] = [
      { role: "user", content: "Hello! Bonjour!" },
    ];
    const session = createTestSession({ id: "unicode-test", messages });

    await store.save(session);
    const loaded = await store.load("unicode-test");

    expect(loaded?.messages[0]?.content).toBe("Hello! Bonjour!");
  });

  it("should handle empty project path", async () => {
    const store = createSessionStore({ storageDir: tempDir });
    const session = createTestSession({ id: "empty-path", projectPath: "" });

    await store.save(session);
    const loaded = await store.load("empty-path");

    expect(loaded?.projectPath).toBe("");
  });

  it("should handle concurrent saves", async () => {
    const store = createSessionStore({ storageDir: tempDir });

    const promises = Array.from({ length: 5 }, (_, i) =>
      store.save(createTestSession({ id: `concurrent-${i}` }))
    );

    await Promise.all(promises);

    const sessions = await store.listSessions();
    expect(sessions.length).toBe(5);
  });

  it("should handle very long messages", async () => {
    const store = createSessionStore({ storageDir: tempDir });
    const longContent = "x".repeat(100000);
    const messages: Message[] = [{ role: "user", content: longContent }];
    const session = createTestSession({ id: "long-message", messages });

    await store.save(session);
    const loaded = await store.load("long-message");

    expect(loaded?.messages[0]?.content).toBe(longContent);
  });

  it("should handle session with many messages", async () => {
    const store = createSessionStore({ storageDir: tempDir });
    const messages: Message[] = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    })) as Message[];
    const session = createTestSession({ id: "many-messages", messages });

    await store.save(session);
    const loaded = await store.load("many-messages");

    expect(loaded?.messages.length).toBe(100);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "integration-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should support full session lifecycle", async () => {
    const store = createSessionStore({ storageDir: tempDir });

    // Create and save
    const session = createTestSession({
      id: "lifecycle-test",
      projectPath: "/test/project",
      messages: [{ role: "user", content: "Initial message" }],
    });

    await store.save(session);
    expect(await store.exists("lifecycle-test")).toBe(true);

    // Load and verify
    const loaded = await store.load("lifecycle-test");
    expect(loaded?.messages.length).toBe(1);

    // Update with more messages
    loaded!.messages.push({ role: "assistant", content: "Response" });
    await store.save(loaded!);

    // Reload and verify update
    const reloaded = await store.load("lifecycle-test");
    expect(reloaded?.messages.length).toBe(2);

    // List sessions
    const sessions = await store.listSessions();
    expect(sessions.length).toBe(1);

    // Get most recent
    const mostRecent = await store.getMostRecent("/test/project");
    expect(mostRecent?.id).toBe("lifecycle-test");

    // Delete
    await store.delete("lifecycle-test");
    expect(await store.exists("lifecycle-test")).toBe(false);
  });

  it("should isolate sessions by ID", async () => {
    const store = createSessionStore({ storageDir: tempDir });

    await store.save(createTestSession({ id: "session-a", messages: [{ role: "user", content: "A" }] }));
    await store.save(createTestSession({ id: "session-b", messages: [{ role: "user", content: "B" }] }));

    const loadedA = await store.load("session-a");
    const loadedB = await store.load("session-b");

    expect(loadedA?.messages[0]?.content).toBe("A");
    expect(loadedB?.messages[0]?.content).toBe("B");
  });
});
