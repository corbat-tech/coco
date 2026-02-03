/**
 * Tests for build command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as p from "@clack/prompts";

// Store original process.exit
const originalExit = process.exit;

// Mock fs.access function (used for checking project and plan)
const mockFsAccess = vi.fn();

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  confirm: vi.fn(),
  isCancel: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
  },
}));

// Mock node:fs/promises - source uses dynamic import
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: mockFsAccess,
    mkdir: vi.fn(),
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: mockFsAccess,
  mkdir: vi.fn(),
}));

describe("build command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
  });

  describe("registerBuildCommand", () => {
    it("should register build command with program", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.command).toHaveBeenCalledWith("build");
      expect(mockCommand.description).toHaveBeenCalled();
    });

    it("should set correct description", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.description).toHaveBeenCalledWith(
        expect.stringContaining("task")
      );
    });

    it("should have task option with short flag", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledWith(
        "-t, --task <task-id>",
        expect.any(String)
      );
    });

    it("should have sprint option with short flag", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledWith(
        "-s, --sprint <sprint-id>",
        expect.any(String)
      );
    });

    it("should have no-review option", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledWith(
        "--no-review",
        expect.any(String)
      );
    });

    it("should have max-iterations option with default value", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledWith(
        "--max-iterations <n>",
        expect.any(String),
        "10"
      );
    });

    it("should have min-quality option with default value", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledWith(
        "--min-quality <n>",
        expect.any(String),
        "85"
      );
    });

    it("should register action handler", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.action).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should have all 5 options configured", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledTimes(5);
    });
  });

  describe("build action handler - runBuild", () => {
    let actionHandler: ((options: any) => Promise<void>) | null = null;

    function setupDefaultMocks() {
      mockFsAccess.mockReset();
      vi.mocked(p.intro).mockReset();
      vi.mocked(p.outro).mockReset();
      vi.mocked(p.spinner).mockReset();
      vi.mocked(p.log.info).mockReset();
      vi.mocked(p.log.success).mockReset();
      vi.mocked(p.log.warn).mockReset();
      vi.mocked(p.log.error).mockReset();
      vi.mocked(p.log.step).mockReset();

      // Default: project and plan exist
      mockFsAccess.mockResolvedValue(undefined);
      vi.mocked(p.spinner).mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      });
    }

    beforeEach(async () => {
      vi.clearAllMocks();
      process.exit = vi.fn() as unknown as typeof process.exit;
      setupDefaultMocks();

      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn((handler) => {
          actionHandler = handler;
          return mockCommand;
        }),
      };

      registerBuildCommand(mockCommand as any);
    });

    afterEach(() => {
      process.exit = originalExit;
    });

    it("should display intro message", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      expect(p.intro).toHaveBeenCalled();
    });

    it("should check for existing project", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      expect(mockFsAccess).toHaveBeenCalledWith(".coco");
    });

    it("should exit with error if no project found", async () => {
      mockFsAccess.mockRejectedValueOnce(new Error("ENOENT"));

      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      expect(p.log.error).toHaveBeenCalledWith(
        "No Corbat-Coco project found. Run 'coco init' first."
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("should check for existing plan", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      expect(mockFsAccess).toHaveBeenCalledWith(".coco/planning/backlog.json");
    });

    it("should exit with error if no plan found", async () => {
      mockFsAccess
        .mockResolvedValueOnce(undefined) // .coco exists
        .mockRejectedValueOnce(new Error("ENOENT")); // backlog.json doesn't exist

      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      expect(p.log.error).toHaveBeenCalledWith(
        "No development plan found. Run 'coco plan' first."
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("should use default minQuality of 85", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      expect(p.log.step).toHaveBeenCalledWith(
        expect.stringContaining("85")
      );
    });

    it("should parse custom minQuality", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({ minQuality: "90" });
      await vi.runAllTimersAsync();
      await promise;

      expect(p.log.step).toHaveBeenCalledWith(
        expect.stringContaining("90")
      );
    });

    it("should log number of tasks found", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      expect(p.log.info).toHaveBeenCalledWith(
        expect.stringMatching(/Found \d+ tasks to complete/)
      );
    });

    it("should execute tasks with spinner", async () => {
      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(p.spinner).mockReturnValue(mockSpinnerInstance);

      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      // Spinner should have been used for task execution
      expect(mockSpinnerInstance.start).toHaveBeenCalled();
      expect(mockSpinnerInstance.stop).toHaveBeenCalled();
    });

    it("should display success outro message", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      expect(p.outro).toHaveBeenCalled();
    });

    it("should handle review flag (default true)", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({ review: true });
      await vi.runAllTimersAsync();
      await promise;

      // Should complete with success message about convergence
      expect(p.log.success).toHaveBeenCalled();
    });

    it("should handle no-review flag (skipReview)", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({ review: false });
      await vi.runAllTimersAsync();
      await promise;

      // Should still complete successfully
      expect(p.outro).toHaveBeenCalled();
    });

    it("should log task progress for each task", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      // Should log success for completed tasks
      expect(p.log.success).toHaveBeenCalled();
    });

    it("should handle task option to filter specific task", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({ task: "task-001" });
      await vi.runAllTimersAsync();
      await promise;

      // Should still run (loadTasks returns placeholder data regardless)
      expect(p.outro).toHaveBeenCalled();
    });

    it("should handle sprint option to filter by sprint", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({ sprint: "sprint-1" });
      await vi.runAllTimersAsync();
      await promise;

      // Should still run (loadTasks returns placeholder data regardless)
      expect(p.outro).toHaveBeenCalled();
    });
  });

  describe("build command options validation", () => {
    it("should parse maxIterations as integer with default 10", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      const maxIterationsCall = mockCommand.option.mock.calls.find(
        (call: string[]) => call[0] === "--max-iterations <n>"
      );

      expect(maxIterationsCall).toBeDefined();
      expect(maxIterationsCall[2]).toBe("10");
    });

    it("should parse minQuality as integer with default 85", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      const minQualityCall = mockCommand.option.mock.calls.find(
        (call: string[]) => call[0] === "--min-quality <n>"
      );

      expect(minQualityCall).toBeDefined();
      expect(minQualityCall[2]).toBe("85");
    });

    it("should have description mentioning build", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.description).toHaveBeenCalledWith(
        expect.stringMatching(/build/i)
      );
    });
  });

  describe("task execution flow", () => {
    let actionHandler: ((options: any) => Promise<void>) | null = null;

    beforeEach(async () => {
      vi.clearAllMocks();
      process.exit = vi.fn() as unknown as typeof process.exit;

      mockFsAccess.mockReset();
      mockFsAccess.mockResolvedValue(undefined);
      vi.mocked(p.spinner).mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      });

      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn((handler) => {
          actionHandler = handler;
          return mockCommand;
        }),
      };

      registerBuildCommand(mockCommand as any);
    });

    afterEach(() => {
      process.exit = originalExit;
    });

    it("should iterate through multiple tasks", async () => {
      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(p.spinner).mockReturnValue(mockSpinnerInstance);

      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      // The placeholder returns 3 tasks, so spinner should be called multiple times
      // Each task has multiple iterations with start/stop calls
      expect(mockSpinnerInstance.start.mock.calls.length).toBeGreaterThan(3);
    });

    it("should log quality scores during iteration", async () => {
      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(p.spinner).mockReturnValue(mockSpinnerInstance);

      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      // Stop should be called with quality score messages
      const stopCalls = mockSpinnerInstance.stop.mock.calls;
      const qualityCalls = stopCalls.filter((call: string[]) =>
        call[0]?.includes("Quality score:")
      );
      expect(qualityCalls.length).toBeGreaterThan(0);
    });

    it("should complete build even with high quality threshold", async () => {
      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({ minQuality: "100" });
      await vi.runAllTimersAsync();
      await promise;

      // At 100 threshold, the function should still complete
      expect(p.outro).toHaveBeenCalled();
    });

    it("should warn when task score is below threshold", async () => {
      expect(actionHandler).not.toBeNull();
      // Using maxIterations=1 and high threshold to ensure warning is triggered
      // With 1 iteration, score = 70 + 8 + random(0-5) = 78-83, below threshold
      const promise = actionHandler!({ minQuality: "95", maxIterations: "1" });
      await vi.runAllTimersAsync();
      await promise;

      // Should log a warning about score below threshold
      expect(p.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("below threshold")
      );
    });

    it("should process tasks in order", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      expect(actionHandler).not.toBeNull();
      const promise = actionHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      // Verify task titles are logged
      const logs = consoleSpy.mock.calls.flat().join(" ");
      expect(logs).toContain("Task 1/3");
      expect(logs).toContain("Task 2/3");
      expect(logs).toContain("Task 3/3");

      consoleSpy.mockRestore();
    });
  });
});
