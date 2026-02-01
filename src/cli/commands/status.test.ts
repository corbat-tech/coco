/**
 * Tests for status command
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
}));

vi.mock("../../config/loader.js", () => ({
  loadConfig: vi.fn(),
  findConfigPath: vi.fn(),
}));

describe("status command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runStatus", () => {
    it("should display project name and phase", async () => {
      const { loadConfig, findConfigPath } = await import("../../config/loader.js");
      const fs = await import("node:fs/promises");
      const prompts = await import("@clack/prompts");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(loadConfig).mockResolvedValue({
        project: { name: "test-project", version: "0.1.0" },
        provider: { type: "anthropic" },
        quality: { minScore: 85 },
      } as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        currentPhase: "complete",
        startedAt: new Date().toISOString(),
      }));

      const { runStatus } = await import("./status.js");
      await runStatus({ cwd: "/test" });

      expect(prompts.log.info).toHaveBeenCalledWith(
        expect.stringContaining("test-project")
      );
    });

    it("should show current sprint progress", async () => {
      const { loadConfig, findConfigPath } = await import("../../config/loader.js");
      const fs = await import("node:fs/promises");
      const prompts = await import("@clack/prompts");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(loadConfig).mockResolvedValue({
        project: { name: "test" },
        provider: { type: "anthropic" },
        quality: { minScore: 85 },
      } as any);
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (String(path).includes("state")) {
          return JSON.stringify({ currentPhase: "complete" });
        }
        if (String(path).includes("backlog")) {
          return JSON.stringify({
            currentSprint: { id: "sprint-0", name: "Foundation" },
            tasks: [
              { id: "t1", status: "completed" },
              { id: "t2", status: "completed" },
              { id: "t3", status: "in_progress" },
              { id: "t4", status: "pending" },
            ],
          });
        }
        return "{}";
      });

      const { runStatus } = await import("./status.js");
      await runStatus({ cwd: "/test" });

      expect(prompts.log.info).toHaveBeenCalledWith(
        expect.stringContaining("Sprint")
      );
    });

    it("should show quality metrics", async () => {
      const { loadConfig, findConfigPath } = await import("../../config/loader.js");
      const fs = await import("node:fs/promises");
      const prompts = await import("@clack/prompts");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(loadConfig).mockResolvedValue({
        project: { name: "test" },
        provider: { type: "anthropic" },
        quality: { minScore: 85 },
      } as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        currentPhase: "complete",
        metrics: {
          averageQuality: 89,
          testCoverage: 85,
          securityIssues: 0,
        },
      }));

      const { runStatus } = await import("./status.js");
      await runStatus({ cwd: "/test", verbose: true });

      expect(prompts.log.info).toHaveBeenCalledWith(
        expect.stringContaining("89")
      );
    });

    it("should list checkpoints when verbose", async () => {
      const { loadConfig, findConfigPath } = await import("../../config/loader.js");
      const fs = await import("node:fs/promises");
      const prompts = await import("@clack/prompts");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(loadConfig).mockResolvedValue({
        project: { name: "test" },
        provider: { type: "anthropic" },
        quality: { minScore: 85 },
      } as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        currentPhase: "complete",
      }));
      vi.mocked(fs.readdir).mockResolvedValue([
        "cp-2024-01-15-100000.json",
        "cp-2024-01-15-110000.json",
      ] as any);
      vi.mocked(fs.stat).mockResolvedValue({
        mtime: new Date(),
        isFile: () => true,
      } as any);

      const { runStatus } = await import("./status.js");
      await runStatus({ cwd: "/test", verbose: true });

      expect(prompts.log.info).toHaveBeenCalledWith(
        expect.stringContaining("checkpoint")
      );
    });

    it("should handle missing project gracefully", async () => {
      const { findConfigPath } = await import("../../config/loader.js");
      const prompts = await import("@clack/prompts");

      vi.mocked(findConfigPath).mockResolvedValue(undefined);

      const { runStatus } = await import("./status.js");
      await runStatus({ cwd: "/test" });

      expect(prompts.log.warning).toHaveBeenCalledWith(
        expect.stringContaining("No project found")
      );
    });
  });

  describe("formatPhaseStatus", () => {
    it("should format phase status with icons", async () => {
      const { formatPhaseStatus } = await import("./status.js");

      expect(formatPhaseStatus("converge", "completed")).toContain("✓");
      expect(formatPhaseStatus("orchestrate", "in_progress")).toContain("→");
      expect(formatPhaseStatus("complete", "pending")).toContain("○");
    });
  });

  describe("calculateProgress", () => {
    it("should calculate progress percentage", async () => {
      const { calculateProgress } = await import("./status.js");

      expect(calculateProgress(5, 10)).toBe(50);
      expect(calculateProgress(0, 10)).toBe(0);
      expect(calculateProgress(10, 10)).toBe(100);
    });

    it("should handle zero total", async () => {
      const { calculateProgress } = await import("./status.js");

      expect(calculateProgress(0, 0)).toBe(0);
    });

    it("should round to nearest integer", async () => {
      const { calculateProgress } = await import("./status.js");

      expect(calculateProgress(1, 3)).toBe(33);
      expect(calculateProgress(2, 3)).toBe(67);
    });
  });

  describe("formatPhaseStatus edge cases", () => {
    it("should format failed status with X icon", async () => {
      const { formatPhaseStatus } = await import("./status.js");

      expect(formatPhaseStatus("complete", "failed")).toContain("✗");
    });

    it("should capitalize phase name", async () => {
      const { formatPhaseStatus } = await import("./status.js");

      const result = formatPhaseStatus("converge", "completed");
      expect(result).toContain("Converge");
    });
  });

  describe("runStatus JSON output", () => {
    it("should output JSON when json option is true", async () => {
      const { loadConfig, findConfigPath } = await import("../../config/loader.js");
      const fs = await import("node:fs/promises");

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(loadConfig).mockResolvedValue({
        project: { name: "json-test" },
        provider: { type: "anthropic" },
        quality: { minScore: 85 },
      } as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        currentPhase: "orchestrate",
      }));

      const { runStatus } = await import("./status.js");
      const result = await runStatus({ cwd: "/test", json: true });

      expect(consoleSpy).toHaveBeenCalled();
      expect(result.project).toBe("json-test");

      consoleSpy.mockRestore();
    });
  });

  describe("registerStatusCommand", () => {
    it("should register status command with all options", async () => {
      const { registerStatusCommand } = await import("./status.js");

      const mockProgram = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerStatusCommand(mockProgram as any);

      expect(mockProgram.command).toHaveBeenCalledWith("status");
      expect(mockProgram.description).toHaveBeenCalledWith("Show current project status and progress");
      expect(mockProgram.option).toHaveBeenCalledWith("-d, --detailed", "Show detailed status");
      expect(mockProgram.option).toHaveBeenCalledWith("-v, --verbose", "Show verbose output including checkpoints");
      expect(mockProgram.option).toHaveBeenCalledWith("--json", "Output as JSON");
    });

    it("should register action handler", async () => {
      const { registerStatusCommand } = await import("./status.js");

      let actionHandler: ((options: any) => Promise<void>) | null = null;

      const mockProgram = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn((handler) => {
          actionHandler = handler;
          return mockProgram;
        }),
      };

      registerStatusCommand(mockProgram as any);

      expect(actionHandler).not.toBeNull();
      expect(typeof actionHandler).toBe("function");
    });
  });

  describe("runStatus edge cases", () => {
    it("should handle missing state file gracefully", async () => {
      const { loadConfig, findConfigPath } = await import("../../config/loader.js");
      const fs = await import("node:fs/promises");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(loadConfig).mockResolvedValue({
        project: { name: "test" },
        provider: { type: "anthropic" },
        quality: { minScore: 85 },
      } as any);
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
      vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));

      const { runStatus } = await import("./status.js");
      const result = await runStatus({ cwd: "/test" });

      expect(result.phase).toBe("idle");
      expect(result.checkpoints).toEqual([]);
    });

    it("should use default project name when not in config", async () => {
      const { loadConfig, findConfigPath } = await import("../../config/loader.js");
      const fs = await import("node:fs/promises");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(loadConfig).mockResolvedValue({
        provider: { type: "anthropic" },
        quality: { minScore: 85 },
      } as any);
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
      vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));

      const { runStatus } = await import("./status.js");
      const result = await runStatus({ cwd: "/test" });

      expect(result.project).toBe("my-project");
    });

    it("should calculate progress from sprint tasks", async () => {
      const { loadConfig, findConfigPath } = await import("../../config/loader.js");
      const fs = await import("node:fs/promises");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(loadConfig).mockResolvedValue({
        project: { name: "test" },
        provider: { type: "anthropic" },
        quality: { minScore: 85 },
      } as any);
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (String(path).includes("state")) {
          return JSON.stringify({ currentPhase: "complete" });
        }
        if (String(path).includes("backlog")) {
          return JSON.stringify({
            currentSprint: { id: "sprint-1", name: "Sprint 1" },
            tasks: [
              { id: "t1", status: "completed" },
              { id: "t2", status: "completed" },
              { id: "t3", status: "pending" },
              { id: "t4", status: "pending" },
            ],
          });
        }
        return "{}";
      });
      vi.mocked(fs.readdir).mockResolvedValue([] as any);

      const { runStatus } = await import("./status.js");
      const result = await runStatus({ cwd: "/test" });

      expect(result.progress).toBe(0.5);
      expect(result.sprint?.completed).toBe(2);
      expect(result.sprint?.total).toBe(4);
    });
  });
});
