/**
 * Tests for session persistence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  SessionPersistence,
  SessionManager,
  getPersistencePaths,
  createCheckpoint,
  createSessionManager,
  type ConvergeStep,
} from "./persistence.js";
import type { DiscoverySession } from "./types.js";

// Create temp directory for tests
let tempDir: string;

beforeEach(async () => {
  tempDir = path.join(os.tmpdir(), `coco-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// Helper to create a mock session
function createMockSession(id = "session-123"): DiscoverySession {
  return {
    id,
    status: "active",
    startedAt: new Date(),
    updatedAt: new Date(),
    initialInput: "Build a todo app",
    projectType: "api",
    conversation: [
      {
        role: "user" as const,
        content: "Build a todo app",
        timestamp: new Date(),
      },
    ],
    extractedRequirements: [],
    assumptions: [],
    techDecisions: [],
    clarifications: [],
    confidenceScore: 0.5,
  };
}

describe("getPersistencePaths", () => {
  it("should return correct paths for a project", () => {
    const paths = getPersistencePaths("/test/project");

    expect(paths.baseDir).toBe("/test/project/.coco/spec");
    expect(paths.sessionFile).toBe("/test/project/.coco/spec/discovery-session.json");
    expect(paths.specFile).toBe("/test/project/.coco/spec/spec.md");
    expect(paths.conversationLog).toBe("/test/project/.coco/spec/conversation.jsonl");
    expect(paths.checkpointFile).toBe("/test/project/.coco/spec/checkpoint.json");
  });

  it("should handle different project paths", () => {
    const paths1 = getPersistencePaths("/home/user/my-project");
    const paths2 = getPersistencePaths("/var/www/app");

    expect(paths1.baseDir).toContain("my-project");
    expect(paths2.baseDir).toContain("app");
  });
});

describe("createCheckpoint", () => {
  it("should create a valid checkpoint", () => {
    const checkpoint = createCheckpoint(
      "session-123",
      "discovery",
      50,
      false,
      { key: "value" }
    );

    expect(checkpoint.id).toContain("converge-");
    expect(checkpoint.sessionId).toBe("session-123");
    expect(checkpoint.step).toBe("discovery");
    expect(checkpoint.progress).toBe(50);
    expect(checkpoint.specGenerated).toBe(false);
    expect(checkpoint.metadata).toEqual({ key: "value" });
    expect(checkpoint.timestamp).toBeInstanceOf(Date);
  });

  it("should use default values", () => {
    const checkpoint = createCheckpoint("session-1", "init", 0);

    expect(checkpoint.specGenerated).toBe(false);
    expect(checkpoint.metadata).toEqual({});
  });

  it("should handle different steps", () => {
    const steps: ConvergeStep[] = [
      "init",
      "discovery",
      "clarification",
      "refinement",
      "spec_generation",
      "complete",
    ];

    for (const step of steps) {
      const checkpoint = createCheckpoint("session-1", step, 0);
      expect(checkpoint.step).toBe(step);
    }
  });
});

describe("SessionPersistence", () => {
  describe("ensureDir", () => {
    it("should create persistence directory", async () => {
      const persistence = new SessionPersistence(tempDir);
      await persistence.ensureDir();

      const paths = getPersistencePaths(tempDir);
      const stats = await fs.stat(paths.baseDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should not fail if directory already exists", async () => {
      const persistence = new SessionPersistence(tempDir);
      await persistence.ensureDir();
      await persistence.ensureDir(); // Should not throw

      const paths = getPersistencePaths(tempDir);
      const stats = await fs.stat(paths.baseDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe("saveSession and loadSession", () => {
    it("should save and load a session", async () => {
      const persistence = new SessionPersistence(tempDir);
      const session = createMockSession();

      await persistence.saveSession(session);
      const loaded = await persistence.loadSession();

      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(session.id);
      expect(loaded?.initialInput).toBe(session.initialInput);
      expect(loaded?.status).toBe(session.status);
    });

    it("should restore Date objects correctly", async () => {
      const persistence = new SessionPersistence(tempDir);
      const session = createMockSession();
      const originalStartedAt = session.startedAt;

      await persistence.saveSession(session);
      const loaded = await persistence.loadSession();

      expect(loaded?.startedAt).toBeInstanceOf(Date);
      expect(loaded?.updatedAt).toBeInstanceOf(Date);
      expect(loaded?.startedAt.getTime()).toBe(originalStartedAt.getTime());
    });

    it("should return null if no session exists", async () => {
      const persistence = new SessionPersistence(tempDir);
      const loaded = await persistence.loadSession();

      expect(loaded).toBeNull();
    });
  });

  describe("hasSession", () => {
    it("should return true if session exists", async () => {
      const persistence = new SessionPersistence(tempDir);
      await persistence.saveSession(createMockSession());

      const hasSession = await persistence.hasSession();
      expect(hasSession).toBe(true);
    });

    it("should return false if session does not exist", async () => {
      const persistence = new SessionPersistence(tempDir);

      const hasSession = await persistence.hasSession();
      expect(hasSession).toBe(false);
    });
  });

  describe("deleteSession", () => {
    it("should delete existing session", async () => {
      const persistence = new SessionPersistence(tempDir);
      await persistence.saveSession(createMockSession());

      await persistence.deleteSession();

      const hasSession = await persistence.hasSession();
      expect(hasSession).toBe(false);
    });

    it("should not throw if session does not exist", async () => {
      const persistence = new SessionPersistence(tempDir);

      await expect(persistence.deleteSession()).resolves.not.toThrow();
    });
  });

  describe("saveSpecification and loadSpecification", () => {
    it("should save and load specification", async () => {
      const persistence = new SessionPersistence(tempDir);
      const specContent = "# Project Specification\n\n## Overview\n\nTest project";

      await persistence.saveSpecification(specContent);
      const loaded = await persistence.loadSpecification();

      expect(loaded).toBe(specContent);
    });

    it("should return null if no specification exists", async () => {
      const persistence = new SessionPersistence(tempDir);
      const loaded = await persistence.loadSpecification();

      expect(loaded).toBeNull();
    });
  });

  describe("appendConversation and loadConversationLog", () => {
    it("should append and load conversation messages", async () => {
      const persistence = new SessionPersistence(tempDir);

      await persistence.appendConversation("user", "Hello");
      await persistence.appendConversation("assistant", "Hi there!");

      const log = await persistence.loadConversationLog();

      expect(log.length).toBe(2);
      expect(log[0]?.role).toBe("user");
      expect(log[0]?.content).toBe("Hello");
      expect(log[1]?.role).toBe("assistant");
      expect(log[1]?.content).toBe("Hi there!");
    });

    it("should return empty array if no conversation exists", async () => {
      const persistence = new SessionPersistence(tempDir);
      const log = await persistence.loadConversationLog();

      expect(log).toEqual([]);
    });
  });

  describe("saveCheckpoint and loadCheckpoint", () => {
    it("should save and load checkpoint", async () => {
      const persistence = new SessionPersistence(tempDir);
      const checkpoint = createCheckpoint("session-1", "discovery", 50);

      await persistence.saveCheckpoint(checkpoint);
      const loaded = await persistence.loadCheckpoint();

      expect(loaded).not.toBeNull();
      expect(loaded?.sessionId).toBe("session-1");
      expect(loaded?.step).toBe("discovery");
      expect(loaded?.progress).toBe(50);
    });

    it("should restore timestamp as Date", async () => {
      const persistence = new SessionPersistence(tempDir);
      const checkpoint = createCheckpoint("session-1", "discovery", 50);

      await persistence.saveCheckpoint(checkpoint);
      const loaded = await persistence.loadCheckpoint();

      expect(loaded?.timestamp).toBeInstanceOf(Date);
    });

    it("should return null if no checkpoint exists", async () => {
      const persistence = new SessionPersistence(tempDir);
      const loaded = await persistence.loadCheckpoint();

      expect(loaded).toBeNull();
    });
  });

  describe("clearAll", () => {
    it("should clear all persisted data", async () => {
      const persistence = new SessionPersistence(tempDir);

      await persistence.saveSession(createMockSession());
      await persistence.saveSpecification("# Spec");
      await persistence.appendConversation("user", "Test");
      await persistence.saveCheckpoint(createCheckpoint("s1", "init", 0));

      await persistence.clearAll();

      expect(await persistence.hasSession()).toBe(false);
      expect(await persistence.loadSpecification()).toBeNull();
      expect(await persistence.loadConversationLog()).toEqual([]);
      expect(await persistence.loadCheckpoint()).toBeNull();
    });

    it("should not throw if nothing to clear", async () => {
      const persistence = new SessionPersistence(tempDir);
      await expect(persistence.clearAll()).resolves.not.toThrow();
    });
  });

  describe("getSpecPath", () => {
    it("should return the spec file path", () => {
      const persistence = new SessionPersistence(tempDir);
      const specPath = persistence.getSpecPath();

      expect(specPath).toContain(".coco/spec/spec.md");
    });
  });
});

describe("SessionManager", () => {
  describe("getPersistence", () => {
    it("should return the persistence layer", () => {
      const manager = new SessionManager(tempDir);
      const persistence = manager.getPersistence();

      expect(persistence).toBeInstanceOf(SessionPersistence);
    });
  });

  describe("saveWithCheckpoint", () => {
    it("should save session with automatic checkpoint", async () => {
      const manager = new SessionManager(tempDir);
      const session = createMockSession();

      await manager.saveWithCheckpoint(session, "discovery", 50);

      const persistence = manager.getPersistence();
      const loadedSession = await persistence.loadSession();
      const loadedCheckpoint = await persistence.loadCheckpoint();

      expect(loadedSession?.id).toBe(session.id);
      expect(loadedCheckpoint?.step).toBe("discovery");
      expect(loadedCheckpoint?.progress).toBe(50);
    });
  });

  describe("resume", () => {
    it("should resume from checkpoint", async () => {
      const manager = new SessionManager(tempDir);
      const session = createMockSession();

      await manager.saveWithCheckpoint(session, "clarification", 75);

      const resumed = await manager.resume();

      expect(resumed).not.toBeNull();
      expect(resumed?.session.id).toBe(session.id);
      expect(resumed?.checkpoint.step).toBe("clarification");
      expect(resumed?.checkpoint.progress).toBe(75);
    });

    it("should return null if no checkpoint exists", async () => {
      const manager = new SessionManager(tempDir);
      const resumed = await manager.resume();

      expect(resumed).toBeNull();
    });

    it("should return null if session missing but checkpoint exists", async () => {
      const manager = new SessionManager(tempDir);
      const persistence = manager.getPersistence();

      // Save only checkpoint, not session
      await persistence.saveCheckpoint(createCheckpoint("s1", "discovery", 50));

      const resumed = await manager.resume();
      expect(resumed).toBeNull();
    });
  });

  describe("canResume", () => {
    it("should return true if can resume (not complete)", async () => {
      const manager = new SessionManager(tempDir);
      const session = createMockSession();

      await manager.saveWithCheckpoint(session, "discovery", 50);

      const canResume = await manager.canResume();
      expect(canResume).toBe(true);
    });

    it("should return false if checkpoint is complete", async () => {
      const manager = new SessionManager(tempDir);
      const session = createMockSession();

      await manager.saveWithCheckpoint(session, "complete", 100);

      const canResume = await manager.canResume();
      expect(canResume).toBe(false);
    });

    it("should return false if no checkpoint exists", async () => {
      const manager = new SessionManager(tempDir);

      const canResume = await manager.canResume();
      expect(canResume).toBe(false);
    });
  });

  describe("getResumeInfo", () => {
    it("should return resume info without loading full session", async () => {
      const manager = new SessionManager(tempDir);
      const session = createMockSession("session-abc");

      await manager.saveWithCheckpoint(session, "refinement", 80);

      const info = await manager.getResumeInfo();

      expect(info).not.toBeNull();
      expect(info?.sessionId).toBe("session-abc");
      expect(info?.step).toBe("refinement");
      expect(info?.progress).toBe(80);
      expect(info?.timestamp).toBeInstanceOf(Date);
    });

    it("should return null if no checkpoint exists", async () => {
      const manager = new SessionManager(tempDir);
      const info = await manager.getResumeInfo();

      expect(info).toBeNull();
    });
  });

  describe("complete", () => {
    it("should complete session and save specification", async () => {
      const manager = new SessionManager(tempDir);
      const session = createMockSession();
      const specMarkdown = "# Project Specification\n\nComplete spec content";

      await manager.complete(session, specMarkdown);

      const persistence = manager.getPersistence();
      const loadedSession = await persistence.loadSession();
      const loadedSpec = await persistence.loadSpecification();
      const loadedCheckpoint = await persistence.loadCheckpoint();

      expect(loadedSession?.status).toBe("spec_generated");
      expect(loadedSpec).toBe(specMarkdown);
      expect(loadedCheckpoint?.step).toBe("complete");
      expect(loadedCheckpoint?.progress).toBe(100);
      expect(loadedCheckpoint?.specGenerated).toBe(true);
    });
  });
});

describe("createSessionManager", () => {
  it("should create a SessionManager instance", () => {
    const manager = createSessionManager(tempDir);
    expect(manager).toBeInstanceOf(SessionManager);
  });
});
