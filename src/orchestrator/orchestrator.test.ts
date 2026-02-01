/**
 * Tests for orchestrator
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("Not found")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock phase executors to avoid real execution
vi.mock("../phases/converge/executor.js", () => ({
  createConvergeExecutor: vi.fn().mockReturnValue({
    name: "converge",
    canStart: vi.fn().mockReturnValue(true),
    execute: vi.fn().mockResolvedValue({ phase: "converge", success: true, artifacts: [] }),
    canComplete: vi.fn().mockReturnValue(true),
    checkpoint: vi.fn().mockResolvedValue({ phase: "converge", timestamp: new Date() }),
    restore: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../phases/orchestrate/executor.js", () => ({
  createOrchestrateExecutor: vi.fn().mockReturnValue({
    name: "orchestrate",
    canStart: vi.fn().mockReturnValue(true),
    execute: vi.fn().mockResolvedValue({ phase: "orchestrate", success: true, artifacts: [] }),
    canComplete: vi.fn().mockReturnValue(true),
    checkpoint: vi.fn().mockResolvedValue({ phase: "orchestrate", timestamp: new Date() }),
    restore: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../phases/complete/executor.js", () => ({
  createCompleteExecutor: vi.fn().mockReturnValue({
    name: "complete",
    canStart: vi.fn().mockReturnValue(true),
    execute: vi.fn().mockResolvedValue({ phase: "complete", success: true, artifacts: [] }),
    canComplete: vi.fn().mockReturnValue(true),
    checkpoint: vi.fn().mockResolvedValue({ phase: "complete", timestamp: new Date() }),
    restore: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../phases/output/executor.js", () => ({
  createOutputExecutor: vi.fn().mockReturnValue({
    name: "output",
    canStart: vi.fn().mockReturnValue(true),
    execute: vi.fn().mockResolvedValue({ phase: "output", success: true, artifacts: [] }),
    canComplete: vi.fn().mockReturnValue(true),
    checkpoint: vi.fn().mockResolvedValue({ phase: "output", timestamp: new Date() }),
    restore: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../providers/index.js", () => ({
  createProvider: vi.fn().mockResolvedValue({
    chat: vi.fn().mockResolvedValue({ content: "{}", usage: { inputTokens: 0, outputTokens: 0 } }),
    chatWithTools: vi.fn().mockResolvedValue({ content: "{}", usage: { inputTokens: 0, outputTokens: 0 } }),
  }),
}));

describe("createOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialize", () => {
    it("should initialize orchestrator with project path", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      await orchestrator.initialize("/test/project");

      const state = orchestrator.getState();
      expect(state.path).toBe("/test/project");
    });

    it("should load existing state if available", async () => {
      const fs = await import("node:fs/promises");
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          id: "existing-id",
          name: "existing-project",
          path: "/existing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentPhase: "converge",
          phaseHistory: [],
          currentTask: null,
          completedTasks: [],
          pendingTasks: [],
          lastScores: null,
          qualityHistory: [],
          lastCheckpoint: null,
        })
      );

      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      await orchestrator.initialize("/existing");

      const state = orchestrator.getState();
      expect(state.id).toBe("existing-id");
      expect(state.currentPhase).toBe("converge");
    });
  });

  describe("start", () => {
    it("should transition to converge phase when idle", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      await orchestrator.start();

      expect(orchestrator.getCurrentPhase()).toBe("converge");
    });
  });

  describe("pause and resume", () => {
    it("should save state on pause", async () => {
      const fs = await import("node:fs/promises");
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      await orchestrator.initialize("/test");
      await orchestrator.pause();

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("should emit phase:start event on resume", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      const handler = vi.fn();
      orchestrator.on("phase:start", handler);

      await orchestrator.start();
      await orchestrator.resume();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("transitionTo", () => {
    it("should transition to specified phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      const result = await orchestrator.transitionTo("orchestrate");

      // The result phase may be "orchestrate" or error depending on executor behavior
      expect(result.phase).toBe("orchestrate");
      // In test environment without real executors, it may fail - just check phase is set
      expect(orchestrator.getCurrentPhase()).toBe("orchestrate");
    });

    it("should record phase transition in history", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      await orchestrator.transitionTo("converge");
      await orchestrator.transitionTo("orchestrate");

      const state = orchestrator.getState();
      expect(state.phaseHistory.length).toBe(2);
      expect(state.phaseHistory[1]?.to).toBe("orchestrate");
    });

    it("should emit phase events", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      const startHandler = vi.fn();
      const completeHandler = vi.fn();

      orchestrator.on("phase:start", startHandler);
      orchestrator.on("phase:complete", completeHandler);

      await orchestrator.transitionTo("complete");

      expect(startHandler).toHaveBeenCalledWith("complete");
      expect(completeHandler).toHaveBeenCalledWith("complete", expect.any(Object));
    });
  });

  describe("getCurrentPhase", () => {
    it("should return current phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      expect(orchestrator.getCurrentPhase()).toBe("idle");

      await orchestrator.transitionTo("output");

      expect(orchestrator.getCurrentPhase()).toBe("output");
    });
  });

  describe("getState", () => {
    it("should return a copy of the state", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      const state1 = orchestrator.getState();
      const state2 = orchestrator.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("getProgress", () => {
    it("should return progress information", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      await orchestrator.transitionTo("orchestrate");

      const progress = orchestrator.getProgress();

      expect(progress.phase).toBe("orchestrate");
      expect(progress.overallProgress).toBeGreaterThanOrEqual(0);
      expect(progress.startedAt).toBeInstanceOf(Date);
    });
  });

  describe("event handling", () => {
    it("should register and unregister event handlers", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      const handler = vi.fn();

      orchestrator.on("phase:start", handler);
      await orchestrator.transitionTo("converge");

      expect(handler).toHaveBeenCalledTimes(1);

      orchestrator.off("phase:start", handler);
      await orchestrator.transitionTo("orchestrate");

      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });

    it("should handle errors in event handlers gracefully", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error("Handler error");
      });

      orchestrator.on("phase:start", errorHandler);

      // Should not throw
      await expect(orchestrator.transitionTo("converge")).resolves.toBeDefined();
    });
  });

  describe("stop", () => {
    it("should save state on stop", async () => {
      const fs = await import("node:fs/promises");
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator({
        projectPath: "/test",
        provider: { type: "anthropic" },
      } as any);

      await orchestrator.initialize("/test");
      await orchestrator.stop();

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });
});
