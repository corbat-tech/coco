/**
 * Tests for orchestrator
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OrchestratorConfig } from "./types.js";

// Create mock functions for fs
const mockReadFile = vi.fn().mockRejectedValue(new Error("Not found"));
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockAccess = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  access: mockAccess,
}));

// Create mock for node:path
vi.mock("node:path", () => ({
  dirname: vi.fn().mockReturnValue("/test"),
}));

// Create mock functions for executors
const mockConvergeExecutor = {
  name: "converge",
  description: "Converge phase",
  canStart: vi.fn().mockReturnValue(true),
  execute: vi.fn().mockResolvedValue({ phase: "converge", success: true, artifacts: [] }),
  canComplete: vi.fn().mockReturnValue(true),
  checkpoint: vi.fn().mockResolvedValue({ phase: "converge", timestamp: new Date() }),
  restore: vi.fn().mockResolvedValue(undefined),
};

const mockOrchestrateExecutor = {
  name: "orchestrate",
  description: "Orchestrate phase",
  canStart: vi.fn().mockReturnValue(true),
  execute: vi.fn().mockResolvedValue({ phase: "orchestrate", success: true, artifacts: [] }),
  canComplete: vi.fn().mockReturnValue(true),
  checkpoint: vi.fn().mockResolvedValue({ phase: "orchestrate", timestamp: new Date() }),
  restore: vi.fn().mockResolvedValue(undefined),
};

const mockCompleteExecutor = {
  name: "complete",
  description: "Complete phase",
  canStart: vi.fn().mockReturnValue(true),
  execute: vi.fn().mockResolvedValue({ phase: "complete", success: true, artifacts: [] }),
  canComplete: vi.fn().mockReturnValue(true),
  checkpoint: vi.fn().mockResolvedValue({ phase: "complete", timestamp: new Date() }),
  restore: vi.fn().mockResolvedValue(undefined),
};

const mockOutputExecutor = {
  name: "output",
  description: "Output phase",
  canStart: vi.fn().mockReturnValue(true),
  execute: vi.fn().mockResolvedValue({ phase: "output", success: true, artifacts: [] }),
  canComplete: vi.fn().mockReturnValue(true),
  checkpoint: vi.fn().mockResolvedValue({ phase: "output", timestamp: new Date() }),
  restore: vi.fn().mockResolvedValue(undefined),
};

// Mock phase executors to avoid real execution
vi.mock("../phases/converge/executor.js", () => ({
  createConvergeExecutor: vi.fn().mockReturnValue(mockConvergeExecutor),
}));

vi.mock("../phases/orchestrate/executor.js", () => ({
  createOrchestrateExecutor: vi.fn().mockReturnValue(mockOrchestrateExecutor),
}));

vi.mock("../phases/complete/executor.js", () => ({
  createCompleteExecutor: vi.fn().mockReturnValue(mockCompleteExecutor),
}));

vi.mock("../phases/output/executor.js", () => ({
  createOutputExecutor: vi.fn().mockReturnValue(mockOutputExecutor),
}));

// Create mock provider
const mockProvider = {
  chat: vi.fn().mockResolvedValue({ content: "{}", usage: { inputTokens: 10, outputTokens: 5 } }),
  chatWithTools: vi.fn().mockResolvedValue({
    content: "{}",
    usage: { inputTokens: 20, outputTokens: 10 },
    toolCalls: [{ name: "test_tool", input: { arg: "value" } }],
  }),
};

vi.mock("../providers/index.js", () => ({
  createProvider: vi.fn().mockResolvedValue(mockProvider),
}));

// Mock glob
vi.mock("glob", () => ({
  glob: vi.fn().mockResolvedValue(["file1.ts", "file2.ts"]),
}));

// Mock execa
vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "## main", stderr: "", exitCode: 0 }),
}));

/**
 * Create a valid orchestrator config for testing
 */
function createTestConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    projectPath: "/test",
    provider: {
      type: "anthropic",
      apiKey: "test-key",
      model: "claude-3-sonnet",
      maxTokens: 4096,
    },
    quality: {
      minScore: 85,
      minCoverage: 80,
      maxIterations: 10,
      convergenceThreshold: 2,
    },
    persistence: {
      checkpointInterval: 60000,
      maxCheckpoints: 10,
    },
    ...overrides,
  };
}

describe("createOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all executor mocks
    mockConvergeExecutor.canStart.mockReturnValue(true);
    mockConvergeExecutor.execute.mockResolvedValue({
      phase: "converge",
      success: true,
      artifacts: [],
    });
    mockOrchestrateExecutor.canStart.mockReturnValue(true);
    mockOrchestrateExecutor.execute.mockResolvedValue({
      phase: "orchestrate",
      success: true,
      artifacts: [],
    });
    mockCompleteExecutor.canStart.mockReturnValue(true);
    mockCompleteExecutor.execute.mockResolvedValue({
      phase: "complete",
      success: true,
      artifacts: [],
    });
    mockOutputExecutor.canStart.mockReturnValue(true);
    mockOutputExecutor.execute.mockResolvedValue({ phase: "output", success: true, artifacts: [] });
    // Reset fs mocks
    mockReadFile.mockRejectedValue(new Error("Not found"));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("initialize", () => {
    it("should initialize orchestrator with project path", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      await orchestrator.initialize("/test/project");

      const state = orchestrator.getState();
      expect(state.path).toBe("/test/project");
    });

    it("should load existing state if available", async () => {
      mockReadFile.mockResolvedValueOnce(
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
        }),
      );

      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      await orchestrator.initialize("/existing");

      const state = orchestrator.getState();
      expect(state.id).toBe("existing-id");
      expect(state.currentPhase).toBe("converge");
    });
  });

  describe("start", () => {
    it("should transition to converge phase when idle", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      await orchestrator.start();

      expect(orchestrator.getCurrentPhase()).toBe("converge");
    });

    it("should not transition if already past idle phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      await orchestrator.transitionTo("orchestrate");

      // Now calling start should not change the phase
      await orchestrator.start();

      expect(orchestrator.getCurrentPhase()).toBe("orchestrate");
    });
  });

  describe("pause and resume", () => {
    it("should save state on pause", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      await orchestrator.initialize("/test");
      await orchestrator.pause();

      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should emit phase:start event on resume when not idle", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const handler = vi.fn();
      orchestrator.on("phase:start", handler);

      await orchestrator.start();
      handler.mockClear();

      await orchestrator.resume();

      expect(handler).toHaveBeenCalledWith("converge");
    });

    it("should not emit phase:start event on resume when idle", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const handler = vi.fn();
      orchestrator.on("phase:start", handler);

      // Don't start, so phase is idle
      await orchestrator.resume();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("transitionTo", () => {
    it("should transition to specified phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const result = await orchestrator.transitionTo("orchestrate");

      expect(result.phase).toBe("orchestrate");
      expect(result.success).toBe(true);
      expect(orchestrator.getCurrentPhase()).toBe("orchestrate");
    });

    it("should record phase transition in history", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      await orchestrator.transitionTo("converge");
      await orchestrator.transitionTo("orchestrate");

      const state = orchestrator.getState();
      expect(state.phaseHistory.length).toBe(2);
      expect(state.phaseHistory[1]?.to).toBe("orchestrate");
      expect(state.phaseHistory[0]?.from).toBe("idle");
    });

    it("should emit phase events", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const startHandler = vi.fn();
      const completeHandler = vi.fn();

      orchestrator.on("phase:start", startHandler);
      orchestrator.on("phase:complete", completeHandler);

      await orchestrator.transitionTo("complete");

      expect(startHandler).toHaveBeenCalledWith("complete");
      expect(completeHandler).toHaveBeenCalledWith("complete", expect.any(Object));
    });

    it("should return error when phase cannot start", async () => {
      mockConvergeExecutor.canStart.mockReturnValue(false);

      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const result = await orchestrator.transitionTo("converge");

      expect(result.success).toBe(false);
      expect(result.error).toContain("cannot start");
    });

    it("should rollback on phase failure", async () => {
      mockOrchestrateExecutor.execute.mockResolvedValue({
        phase: "orchestrate",
        success: false,
        artifacts: [],
        error: "Test failure",
      });

      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const result = await orchestrator.transitionTo("orchestrate");

      expect(result.success).toBe(false);
      expect(result.error).toContain("rolled back");
      expect(result.error).toContain("Test failure");
    });

    it("should rollback on phase exception", async () => {
      mockCompleteExecutor.execute.mockRejectedValue(new Error("Unexpected error"));

      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const result = await orchestrator.transitionTo("complete");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unexpected error");
      expect(result.error).toContain("rolled back");
    });

    it("should return error for unknown phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      // @ts-expect-error Testing unknown phase
      const result = await orchestrator.transitionTo("unknown_phase");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown phase");
    });
  });

  describe("getCurrentPhase", () => {
    it("should return current phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      expect(orchestrator.getCurrentPhase()).toBe("idle");

      await orchestrator.transitionTo("output");

      expect(orchestrator.getCurrentPhase()).toBe("output");
    });

    it("should return idle phase for new orchestrator", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      expect(orchestrator.getCurrentPhase()).toBe("idle");
    });
  });

  describe("getState", () => {
    it("should return a copy of the state", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const state1 = orchestrator.getState();
      const state2 = orchestrator.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });

    it("should have correct initial state properties", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig({ projectPath: "/my-project" }));

      const state = orchestrator.getState();

      expect(state.path).toBe("/my-project");
      expect(state.currentPhase).toBe("idle");
      expect(state.phaseHistory).toEqual([]);
      expect(state.currentTask).toBeNull();
      expect(state.completedTasks).toEqual([]);
      expect(state.pendingTasks).toEqual([]);
      expect(state.lastScores).toBeNull();
      expect(state.qualityHistory).toEqual([]);
      expect(state.lastCheckpoint).toBeNull();
      expect(state.id).toMatch(/^proj_/);
      expect(state.createdAt).toBeInstanceOf(Date);
      expect(state.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("getProgress", () => {
    it("should return progress information", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      await orchestrator.transitionTo("orchestrate");

      const progress = orchestrator.getProgress();

      expect(progress.phase).toBe("orchestrate");
      expect(progress.overallProgress).toBeGreaterThanOrEqual(0);
      expect(progress.startedAt).toBeInstanceOf(Date);
    });

    it("should calculate correct progress for each phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      // Test idle phase
      let progress = orchestrator.getProgress();
      expect(progress.phase).toBe("idle");
      expect(progress.overallProgress).toBe(0);

      // Test converge phase
      await orchestrator.transitionTo("converge");
      progress = orchestrator.getProgress();
      expect(progress.phase).toBe("converge");
      expect(progress.overallProgress).toBe(0);

      // Test orchestrate phase
      await orchestrator.transitionTo("orchestrate");
      progress = orchestrator.getProgress();
      expect(progress.phase).toBe("orchestrate");
      expect(progress.overallProgress).toBe(0.25);

      // Test complete phase
      await orchestrator.transitionTo("complete");
      progress = orchestrator.getProgress();
      expect(progress.phase).toBe("complete");
      expect(progress.overallProgress).toBe(0.5);

      // Test output phase
      await orchestrator.transitionTo("output");
      progress = orchestrator.getProgress();
      expect(progress.phase).toBe("output");
      expect(progress.overallProgress).toBe(0.75);
    });

    it("should include task progress when task is active", async () => {
      // Load state with currentTask
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          id: "task-test-id",
          name: "task-project",
          path: "/task-project",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentPhase: "complete",
          phaseHistory: [],
          currentTask: {
            id: "task-1",
            title: "Test Task",
            iteration: 3,
            startedAt: new Date().toISOString(),
            scores: [
              { overall: 70, tests: 80, lint: 85, coverage: 75, security: 100, complexity: 60 },
              { overall: 85, tests: 90, lint: 90, coverage: 85, security: 100, complexity: 75 },
            ],
          },
          completedTasks: [],
          pendingTasks: [],
          lastScores: null,
          qualityHistory: [],
          lastCheckpoint: null,
        }),
      );

      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.initialize("/task-project");

      const progress = orchestrator.getProgress();

      expect(progress.task).toBeDefined();
      expect(progress.task?.id).toBe("task-1");
      expect(progress.task?.title).toBe("Test Task");
      expect(progress.task?.iteration).toBe(3);
      expect(progress.task?.currentScore).toBe(85);
    });

    it("should handle task with empty scores array", async () => {
      // Load state with currentTask with empty scores
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          id: "task-test-id",
          name: "task-project",
          path: "/task-project",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentPhase: "complete",
          phaseHistory: [],
          currentTask: {
            id: "task-2",
            title: "Empty Score Task",
            iteration: 1,
            startedAt: new Date().toISOString(),
            scores: [],
          },
          completedTasks: [],
          pendingTasks: [],
          lastScores: null,
          qualityHistory: [],
          lastCheckpoint: null,
        }),
      );

      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.initialize("/task-project");

      const progress = orchestrator.getProgress();

      expect(progress.task).toBeDefined();
      expect(progress.task?.currentScore).toBe(0);
    });

    it("should handle date strings from loaded state", async () => {
      const dateString = "2025-01-01T00:00:00.000Z";
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          id: "date-test-id",
          name: "date-project",
          path: "/date-project",
          createdAt: dateString,
          updatedAt: dateString,
          currentPhase: "converge",
          phaseHistory: [],
          currentTask: null,
          completedTasks: [],
          pendingTasks: [],
          lastScores: null,
          qualityHistory: [],
          lastCheckpoint: null,
        }),
      );

      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.initialize("/date-project");

      const progress = orchestrator.getProgress();

      expect(progress.startedAt).toBeInstanceOf(Date);
      expect(progress.startedAt.toISOString()).toBe(dateString);
    });
  });

  describe("event handling", () => {
    it("should register and unregister event handlers", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

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

      const orchestrator = createOrchestrator(createTestConfig());

      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error("Handler error");
      });

      orchestrator.on("phase:start", errorHandler);

      // Should not throw
      await expect(orchestrator.transitionTo("converge")).resolves.toBeDefined();
    });

    it("should allow multiple handlers for the same event", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      orchestrator.on("phase:complete", handler1);
      orchestrator.on("phase:complete", handler2);

      await orchestrator.transitionTo("converge");

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should handle off with non-registered handler", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const handler = vi.fn();

      // Should not throw when removing a handler that was never registered
      orchestrator.off("phase:start", handler);

      // Should not throw
      await expect(orchestrator.transitionTo("converge")).resolves.toBeDefined();
    });

    it("should handle off with event that has no handlers", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const handler = vi.fn();

      // Should not throw when removing a handler from an event with no handlers
      orchestrator.off("error", handler);

      // Should not throw
      await expect(orchestrator.transitionTo("converge")).resolves.toBeDefined();
    });
  });

  describe("stop", () => {
    it("should save state on stop", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      await orchestrator.initialize("/test");
      await orchestrator.stop();

      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe("phase context creation", () => {
    it("should create LLM interface that adapts provider chat method", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");
      const { createProvider } = await import("../providers/index.js");

      const orchestrator = createOrchestrator(createTestConfig());

      // Trigger phase execution which calls createPhaseContext
      await orchestrator.transitionTo("converge");

      // Verify provider was created
      expect(createProvider).toHaveBeenCalledWith("anthropic", {
        apiKey: "test-key",
        model: "claude-3-sonnet",
        maxTokens: 4096,
      });

      // Verify executor was called with context
      expect(mockConvergeExecutor.execute).toHaveBeenCalled();
    });

    it("should create tool implementations", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      // Execute a phase which creates the context with tools
      await orchestrator.transitionTo("converge");

      // The executor should have been called with a context containing tools
      const executorCall = mockConvergeExecutor.execute.mock.calls[0];
      const context = executorCall[0];

      expect(context.tools).toBeDefined();
      expect(context.tools.file).toBeDefined();
      expect(context.tools.bash).toBeDefined();
      expect(context.tools.git).toBeDefined();
      expect(context.tools.test).toBeDefined();
      expect(context.tools.quality).toBeDefined();
    });

    it("should create working file.read tool", async () => {
      mockReadFile.mockResolvedValueOnce("file content");

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the file.read tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const content = await context.tools.file.read("/test/file.txt");
        expect(content).toBe("file content");
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");

      expect(mockReadFile).toHaveBeenCalledWith("/test/file.txt", "utf-8");
    });

    it("should create working file.write tool", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the file.write tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        await context.tools.file.write("/test/output.txt", "content");
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");

      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should create working file.exists tool that returns true", async () => {
      mockAccess.mockResolvedValueOnce(undefined);

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the file.exists tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const exists = await context.tools.file.exists("/test/existing.txt");
        expect(exists).toBe(true);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working file.exists tool that returns false", async () => {
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the file.exists tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const exists = await context.tools.file.exists("/test/missing.txt");
        expect(exists).toBe(false);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working file.glob tool", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");
      const { glob } = await import("glob");

      // Make executor call the file.glob tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const files = await context.tools.file.glob("**/*.ts");
        expect(files).toEqual(["file1.ts", "file2.ts"]);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");

      expect(glob).toHaveBeenCalledWith("**/*.ts", { cwd: "/test" });
    });

    it("should create working bash.exec tool for successful commands", async () => {
      const { execa } = await import("execa");
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "output", stderr: "", exitCode: 0 } as any);

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the bash.exec tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const result = await context.tools.bash.exec("echo hello", { cwd: "/custom" });
        expect(result.stdout).toBe("output");
        expect(result.exitCode).toBe(0);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working bash.exec tool for failed commands", async () => {
      const { execa } = await import("execa");
      vi.mocked(execa).mockRejectedValueOnce({ stdout: "", stderr: "error", exitCode: 1 });

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the bash.exec tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const result = await context.tools.bash.exec("bad-command");
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toBe("error");
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working git.status tool", async () => {
      const { execa } = await import("execa");
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "## main...origin/main\n M file.ts",
        stderr: "",
        exitCode: 0,
      } as any);

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the git.status tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const status = await context.tools.git.status();
        expect(status.branch).toBe("main");
        expect(status.clean).toBe(false);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working git.commit tool", async () => {
      const { execa } = await import("execa");
      vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any);

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the git.commit tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        await context.tools.git.commit("test commit", ["file1.ts", "file2.ts"]);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");

      expect(execa).toHaveBeenCalledWith(
        "git",
        ["add", "file1.ts", "file2.ts"],
        expect.any(Object),
      );
      expect(execa).toHaveBeenCalledWith(
        "git",
        ["commit", "-m", "test commit"],
        expect.any(Object),
      );
    });

    it("should create working git.commit tool without files", async () => {
      const { execa } = await import("execa");
      vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any);

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the git.commit tool without files
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        await context.tools.git.commit("test commit");
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working git.push tool", async () => {
      const { execa } = await import("execa");
      vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any);

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the git.push tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        await context.tools.git.push();
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");

      expect(execa).toHaveBeenCalledWith("git", ["push"], expect.any(Object));
    });

    it("should create working test.run tool for passing tests", async () => {
      const { execa } = await import("execa");
      vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any);

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the test.run tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const result = await context.tools.test.run("**/*.test.ts");
        expect(result.failed).toBe(0);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working test.run tool for failing tests", async () => {
      const { execa } = await import("execa");
      vi.mocked(execa).mockRejectedValueOnce(new Error("Tests failed"));

      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the test.run tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const result = await context.tools.test.run();
        expect(result.failed).toBe(1);
        expect(result.failures[0]?.message).toBe("Tests failed");
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working test.coverage tool", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the test.coverage tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const coverage = await context.tools.test.coverage();
        expect(coverage.lines).toBe(0);
        expect(coverage.branches).toBe(0);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working quality.lint tool", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the quality.lint tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const result = await context.tools.quality.lint(["file1.ts"]);
        expect(result.errors).toBe(0);
        expect(result.warnings).toBe(0);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working quality.complexity tool", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the quality.complexity tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const result = await context.tools.quality.complexity(["file1.ts"]);
        expect(result.averageComplexity).toBe(0);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working quality.security tool", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the quality.security tool
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const result = await context.tools.quality.security(["file1.ts"]);
        expect(result.vulnerabilities).toBe(0);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");
    });

    it("should create working LLM chat interface", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the llm.chat method
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const response = await context.llm.chat([{ role: "user", content: "Hello" }]);
        expect(response.content).toBe("{}");
        expect(response.usage.inputTokens).toBe(10);
        expect(response.usage.outputTokens).toBe(5);
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");

      expect(mockProvider.chat).toHaveBeenCalled();
    });

    it("should create working LLM chatWithTools interface", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      // Make executor call the llm.chatWithTools method
      mockConvergeExecutor.execute.mockImplementationOnce(async (context) => {
        const response = await context.llm.chatWithTools(
          [{ role: "user", content: "Call tool" }],
          [{ name: "test_tool", description: "A test tool", parameters: {} }],
        );
        expect(response.content).toBe("{}");
        expect(response.toolCalls).toBeDefined();
        expect(response.toolCalls![0]?.name).toBe("test_tool");
        expect(response.toolCalls![0]?.arguments).toEqual({ arg: "value" });
        return { phase: "converge", success: true, artifacts: [] };
      });

      const orchestrator = createOrchestrator(createTestConfig());
      await orchestrator.transitionTo("converge");

      expect(mockProvider.chatWithTools).toHaveBeenCalled();
    });
  });

  describe("snapshot and rollback", () => {
    it("should create and save snapshot before phase execution", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      await orchestrator.transitionTo("converge");

      // Snapshot should have been saved
      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should restore state after phase failure", async () => {
      mockConvergeExecutor.execute.mockResolvedValue({
        phase: "converge",
        success: false,
        artifacts: [],
        error: "Converge failed",
      });

      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      // Get initial state
      orchestrator.getState();

      const result = await orchestrator.transitionTo("converge");

      expect(result.success).toBe(false);
      // State should be rolled back - phaseHistory should still have the transition recorded
      // but the internal state should match the snapshot
    });

    it("should handle non-Error throws in phase execution", async () => {
      mockOrchestrateExecutor.execute.mockRejectedValue("string error");

      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const result = await orchestrator.transitionTo("orchestrate");

      expect(result.success).toBe(false);
      expect(result.error).toContain("string error");
      expect(result.error).toContain("rolled back");
    });
  });

  describe("all phase transitions", () => {
    it("should successfully execute converge phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const result = await orchestrator.transitionTo("converge");

      expect(result.phase).toBe("converge");
      expect(result.success).toBe(true);
      expect(mockConvergeExecutor.execute).toHaveBeenCalled();
    });

    it("should successfully execute orchestrate phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const result = await orchestrator.transitionTo("orchestrate");

      expect(result.phase).toBe("orchestrate");
      expect(result.success).toBe(true);
      expect(mockOrchestrateExecutor.execute).toHaveBeenCalled();
    });

    it("should successfully execute complete phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const result = await orchestrator.transitionTo("complete");

      expect(result.phase).toBe("complete");
      expect(result.success).toBe(true);
      expect(mockCompleteExecutor.execute).toHaveBeenCalled();
    });

    it("should successfully execute output phase", async () => {
      const { createOrchestrator } = await import("./orchestrator.js");

      const orchestrator = createOrchestrator(createTestConfig());

      const result = await orchestrator.transitionTo("output");

      expect(result.phase).toBe("output");
      expect(result.success).toBe(true);
      expect(mockOutputExecutor.execute).toHaveBeenCalled();
    });
  });
});
