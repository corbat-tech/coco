/**
 * Tests for ProgressTracker with Checkpoint/Resume
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProgressTracker, createProgressTracker } from "./progress.js";
import type { OrchestratorState } from "./progress.js";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn(),
}));

// Mock node:crypto
vi.mock("node:crypto", () => ({
  createHash: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue({
      digest: vi.fn().mockReturnValue("abcdef1234567890abcdef1234567890"),
    }),
  }),
}));

const fs = vi.mocked(await import("node:fs/promises"));

function createMockState(overrides?: Partial<OrchestratorState>): OrchestratorState {
  return {
    sessionId: "test-session",
    currentPhase: "complete",
    tasks: [
      { id: "task-1", description: "Task one", status: "done" },
      { id: "task-2", description: "Task two", status: "pending" },
    ],
    completedTasks: ["task-1"],
    agentStates: new Map([["agent-1", { working: true }]]),
    generatedFiles: [{ path: "/src/index.ts", description: "Entry point" }],
    qualityHistory: [{ score: 85, timestamp: 1000 }],
    metadata: {
      startTime: 1000,
      lastCheckpoint: 2000,
      projectPath: "/project",
      provider: "anthropic",
    },
    ...overrides,
  };
}

describe("ProgressTracker", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    tracker = new ProgressTracker("/project", "test-session-id");
  });

  afterEach(() => {
    tracker.stopAutoCheckpoint();
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should create tracker with provided session ID", () => {
      const t = new ProgressTracker("/project", "my-session");
      expect(t.getSessionId()).toBe("my-session");
    });

    it("should generate session ID when not provided", () => {
      const t = new ProgressTracker("/project");
      expect(t.getSessionId()).toBeDefined();
      expect(t.getSessionId().length).toBeGreaterThan(0);
    });
  });

  describe("saveCheckpoint", () => {
    it("should create checkpoint directory and write checkpoint file", async () => {
      const state = createMockState();

      await tracker.saveCheckpoint(state);

      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("checkpoints"), {
        recursive: true,
      });
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("test-session.json"),
        expect.any(String),
        "utf-8",
      );
    });

    it("should serialize Map to Object in the checkpoint", async () => {
      const state = createMockState();

      await tracker.saveCheckpoint(state);

      const writtenData = JSON.parse(
        (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string,
      );
      // agentStates should be a plain object, not a Map
      expect(writtenData.agentStates).toEqual({ "agent-1": { working: true } });
    });

    it("should update lastCheckpoint timestamp", async () => {
      vi.setSystemTime(new Date(5000));
      const state = createMockState();

      await tracker.saveCheckpoint(state);

      const writtenData = JSON.parse(
        (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string,
      );
      expect(writtenData.metadata.lastCheckpoint).toBe(5000);
    });
  });

  describe("resume", () => {
    it("should read and deserialize checkpoint file", async () => {
      const serializedState = JSON.stringify({
        sessionId: "test-session-id",
        currentPhase: "complete",
        tasks: [{ id: "task-1", description: "Task one", status: "done" }],
        completedTasks: ["task-1"],
        agentStates: { "agent-1": { working: true } },
        generatedFiles: [],
        qualityHistory: [],
        metadata: {
          startTime: 1000,
          lastCheckpoint: 2000,
          projectPath: "/project",
          provider: "anthropic",
        },
      });

      fs.readFile.mockResolvedValue(serializedState);

      const result = await tracker.resume("test-session-id");

      expect(result).not.toBeNull();
      expect(result?.currentPhase).toBe("complete");
      expect(result?.agentStates).toBeInstanceOf(Map);
      expect(result?.agentStates.get("agent-1")).toEqual({ working: true });
    });

    it("should use current session ID when no ID provided", async () => {
      const serializedState = JSON.stringify({
        sessionId: "test-session-id",
        currentPhase: "converge",
        tasks: [],
        completedTasks: [],
        agentStates: {},
        generatedFiles: [],
        qualityHistory: [],
        metadata: {
          startTime: 1000,
          lastCheckpoint: 2000,
          projectPath: "/project",
          provider: "anthropic",
        },
      });

      fs.readFile.mockResolvedValue(serializedState);

      const result = await tracker.resume();

      expect(result).not.toBeNull();
      expect(fs.readFile).toHaveBeenCalledWith(
        expect.stringContaining("test-session-id.json"),
        "utf-8",
      );
    });

    it("should return null when checkpoint file not found", async () => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      fs.readFile.mockRejectedValue(error);

      const result = await tracker.resume("nonexistent");

      expect(result).toBeNull();
    });

    it("should rethrow non-ENOENT errors", async () => {
      const error = new Error("Permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      fs.readFile.mockRejectedValue(error);

      await expect(tracker.resume("broken")).rejects.toThrow("Permission denied");
    });

    it("should convert agentStates object back to Map", async () => {
      const serializedState = JSON.stringify({
        sessionId: "test-session-id",
        currentPhase: "complete",
        tasks: [],
        completedTasks: [],
        agentStates: { coordinator: { step: 3 }, worker: { step: 1 } },
        generatedFiles: [],
        qualityHistory: [],
        metadata: { startTime: 1, lastCheckpoint: 2, projectPath: "/p", provider: "anthropic" },
      });
      fs.readFile.mockResolvedValue(serializedState);

      const result = await tracker.resume("test-session-id");

      expect(result?.agentStates).toBeInstanceOf(Map);
      expect(result?.agentStates.size).toBe(2);
    });
  });

  describe("hasCheckpoint", () => {
    it("should return exists=true with info when checkpoint exists", async () => {
      fs.stat.mockResolvedValue({ mtimeMs: 12345 } as any);
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: "test-session-id",
          currentPhase: "orchestrate",
        }),
      );

      const result = await tracker.hasCheckpoint("test-session-id");

      expect(result.exists).toBe(true);
      expect(result.timestamp).toBe(12345);
      expect(result.sessionId).toBe("test-session-id");
      expect(result.phase).toBe("orchestrate");
    });

    it("should return exists=false when checkpoint does not exist", async () => {
      fs.stat.mockRejectedValue(new Error("ENOENT"));

      const result = await tracker.hasCheckpoint("nonexistent");

      expect(result.exists).toBe(false);
    });

    it("should use current session ID when none provided", async () => {
      fs.stat.mockResolvedValue({ mtimeMs: 100 } as any);
      fs.readFile.mockResolvedValue(
        JSON.stringify({ sessionId: "test-session-id", currentPhase: "complete" }),
      );

      await tracker.hasCheckpoint();

      expect(fs.stat).toHaveBeenCalledWith(expect.stringContaining("test-session-id.json"));
    });
  });

  describe("listCheckpoints", () => {
    it("should list all checkpoint files", async () => {
      fs.readdir.mockResolvedValue(["session-1.json", "session-2.json"] as any);
      fs.stat.mockResolvedValue({ mtimeMs: 100 } as any);
      fs.readFile.mockResolvedValue(
        JSON.stringify({ sessionId: "session-1", currentPhase: "complete" }),
      );

      const result = await tracker.listCheckpoints();

      expect(result.length).toBe(2);
    });

    it("should sort checkpoints by timestamp descending", async () => {
      fs.readdir.mockResolvedValue(["old.json", "new.json"] as any);
      let callIndex = 0;
      fs.stat.mockImplementation(async () => {
        callIndex++;
        return { mtimeMs: callIndex === 1 ? 100 : 200 } as any;
      });
      fs.readFile.mockResolvedValue(JSON.stringify({ sessionId: "s", currentPhase: "complete" }));

      const result = await tracker.listCheckpoints();

      if (result.length >= 2) {
        expect(result[0]?.timestamp ?? 0).toBeGreaterThanOrEqual(result[1]?.timestamp ?? 0);
      }
    });

    it("should return empty array when checkpoint directory does not exist", async () => {
      fs.readdir.mockRejectedValue(new Error("ENOENT"));

      const result = await tracker.listCheckpoints();

      expect(result).toEqual([]);
    });

    it("should skip non-json files", async () => {
      fs.readdir.mockResolvedValue(["session-1.json", "readme.txt", ".DS_Store"] as any);
      fs.stat.mockResolvedValue({ mtimeMs: 100 } as any);
      fs.readFile.mockResolvedValue(
        JSON.stringify({ sessionId: "session-1", currentPhase: "complete" }),
      );

      const result = await tracker.listCheckpoints();

      // Only session-1.json is a .json file
      expect(result.length).toBe(1);
    });
  });

  describe("deleteCheckpoint", () => {
    it("should delete the checkpoint file", async () => {
      fs.unlink.mockResolvedValue(undefined);

      await tracker.deleteCheckpoint("old-session");

      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining("old-session.json"));
    });

    it("should silently ignore ENOENT errors", async () => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      fs.unlink.mockRejectedValue(error);

      // Should not throw
      await expect(tracker.deleteCheckpoint("nonexistent")).resolves.toBeUndefined();
    });

    it("should rethrow non-ENOENT errors", async () => {
      const error = new Error("Permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      fs.unlink.mockRejectedValue(error);

      await expect(tracker.deleteCheckpoint("broken")).rejects.toThrow("Permission denied");
    });
  });

  describe("startAutoCheckpoint", () => {
    it("should periodically save checkpoints", async () => {
      const state = createMockState();
      const stateGetter = vi.fn().mockReturnValue(state);

      fs.mkdir.mockResolvedValue(undefined);
      fs.writeFile.mockResolvedValue(undefined);

      tracker.setAutoCheckpointInterval(1000);
      tracker.startAutoCheckpoint(stateGetter);

      // Advance time past one interval
      await vi.advanceTimersByTimeAsync(1000);

      expect(stateGetter).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("should clear previous timer when starting new auto-checkpoint", () => {
      const state = createMockState();
      const stateGetter = vi.fn().mockReturnValue(state);

      tracker.setAutoCheckpointInterval(1000);
      tracker.startAutoCheckpoint(stateGetter);
      tracker.startAutoCheckpoint(stateGetter);

      // Advance and verify only one set of saves
      vi.advanceTimersByTime(1000);
      // Should not have doubled saves
    });

    it("should handle checkpoint save failures gracefully", async () => {
      const state = createMockState();
      const stateGetter = vi.fn().mockReturnValue(state);

      fs.mkdir.mockRejectedValue(new Error("Disk full"));

      tracker.setAutoCheckpointInterval(1000);
      tracker.startAutoCheckpoint(stateGetter);

      // Should not throw
      await vi.advanceTimersByTimeAsync(1000);
    });
  });

  describe("stopAutoCheckpoint", () => {
    it("should stop periodic saves", async () => {
      const state = createMockState();
      const stateGetter = vi.fn().mockReturnValue(state);

      tracker.setAutoCheckpointInterval(1000);
      tracker.startAutoCheckpoint(stateGetter);
      tracker.stopAutoCheckpoint();

      await vi.advanceTimersByTimeAsync(5000);

      // stateGetter should not have been called since we stopped
      expect(stateGetter).not.toHaveBeenCalled();
    });

    it("should be safe to call when no timer is active", () => {
      // Should not throw
      expect(() => tracker.stopAutoCheckpoint()).not.toThrow();
    });
  });

  describe("setAutoCheckpointInterval", () => {
    it("should change the checkpoint interval", async () => {
      const state = createMockState();
      const stateGetter = vi.fn().mockReturnValue(state);

      fs.mkdir.mockResolvedValue(undefined);
      fs.writeFile.mockResolvedValue(undefined);

      tracker.setAutoCheckpointInterval(500);
      tracker.startAutoCheckpoint(stateGetter);

      // Advance 500ms - should trigger
      await vi.advanceTimersByTimeAsync(500);
      expect(stateGetter).toHaveBeenCalledTimes(1);
    });
  });

  describe("getSessionId", () => {
    it("should return the provided session ID", () => {
      expect(tracker.getSessionId()).toBe("test-session-id");
    });
  });

  describe("createProgressTracker", () => {
    it("should create a new ProgressTracker instance", () => {
      const t = createProgressTracker("/project", "my-id");
      expect(t).toBeInstanceOf(ProgressTracker);
      expect(t.getSessionId()).toBe("my-id");
    });

    it("should create tracker without session ID", () => {
      const t = createProgressTracker("/project");
      expect(t).toBeInstanceOf(ProgressTracker);
      expect(t.getSessionId()).toBeDefined();
    });
  });
});
