/**
 * Tests for plan command
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  confirm: vi.fn().mockResolvedValue(true),
  select: vi.fn().mockResolvedValue("option1"),
  text: vi.fn().mockResolvedValue("test input"),
  isCancel: vi.fn(() => false),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
  },
}));

vi.mock("../../config/loader.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    project: { name: "test" },
    provider: { type: "anthropic" },
    quality: { minScore: 85 },
  }),
  findConfigPath: vi.fn().mockResolvedValue("/test/.coco/config.json"),
}));

vi.mock("../../phases/converge/executor.js", () => ({
  createConvergeExecutor: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      phase: "converge",
      success: true,
      artifacts: [],
    }),
    canStart: vi.fn().mockReturnValue(true),
  }),
}));

vi.mock("../../phases/orchestrate/executor.js", () => ({
  createOrchestrateExecutor: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      phase: "orchestrate",
      success: true,
      artifacts: [],
    }),
    canStart: vi.fn().mockReturnValue(true),
  }),
}));

vi.mock("../../providers/index.js", () => ({
  createProvider: vi.fn().mockResolvedValue({
    chat: vi.fn().mockResolvedValue({ content: "{}", usage: { inputTokens: 0, outputTokens: 0 } }),
    chatWithTools: vi.fn().mockResolvedValue({ content: "{}", usage: { inputTokens: 0, outputTokens: 0 } }),
  }),
}));

describe("plan command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runPlan", () => {
    it("should load configuration", async () => {
      const { loadConfig, findConfigPath } = await import("../../config/loader.js");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");

      const { runPlan } = await import("./plan.js");
      const result = await runPlan({ cwd: "/test", auto: true });

      expect(findConfigPath).toHaveBeenCalledWith("/test");
      expect(loadConfig).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should execute CONVERGE phase", async () => {
      const { findConfigPath } = await import("../../config/loader.js");
      const { createConvergeExecutor } = await import("../../phases/converge/executor.js");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");

      const { runPlan } = await import("./plan.js");
      await runPlan({ cwd: "/test", auto: true });

      expect(createConvergeExecutor).toHaveBeenCalled();
    });

    it("should execute ORCHESTRATE phase after CONVERGE", async () => {
      const { findConfigPath } = await import("../../config/loader.js");
      const { createOrchestrateExecutor } = await import("../../phases/orchestrate/executor.js");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");

      const { runPlan } = await import("./plan.js");
      await runPlan({ cwd: "/test", auto: true });

      expect(createOrchestrateExecutor).toHaveBeenCalled();
    });

    it("should return error if no config found", async () => {
      const { findConfigPath } = await import("../../config/loader.js");

      vi.mocked(findConfigPath).mockResolvedValue(undefined);

      const { runPlan } = await import("./plan.js");
      const result = await runPlan({ cwd: "/test" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("config");
    });

    it("should support auto mode", async () => {
      const { findConfigPath } = await import("../../config/loader.js");
      const prompts = await import("@clack/prompts");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");

      const { runPlan } = await import("./plan.js");
      await runPlan({ cwd: "/test", auto: true });

      // In auto mode, confirm should not be called
      expect(prompts.confirm).not.toHaveBeenCalled();
    });

    it("should ask for confirmation before proceeding", async () => {
      const { findConfigPath } = await import("../../config/loader.js");
      const prompts = await import("@clack/prompts");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(prompts.confirm).mockResolvedValue(true);

      const { runPlan } = await import("./plan.js");
      await runPlan({ cwd: "/test", auto: false });

      expect(prompts.confirm).toHaveBeenCalled();
    });
  });

  describe("loadExistingSpecification", () => {
    it("should throw error when spec not found", async () => {
      vi.mock("node:fs/promises", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:fs/promises")>();
        return {
          ...actual,
          default: {
            readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
          },
        };
      });

      const { loadExistingSpecification } = await import("./plan.js");

      await expect(loadExistingSpecification("/test")).rejects.toThrow();
    });
  });

  describe("registerPlanCommand", () => {
    it("should register plan command with all options", async () => {
      const { registerPlanCommand } = await import("./plan.js");

      const mockProgram = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerPlanCommand(mockProgram as any);

      expect(mockProgram.command).toHaveBeenCalledWith("plan");
      expect(mockProgram.description).toHaveBeenCalledWith("Run discovery and create a development plan");
      expect(mockProgram.option).toHaveBeenCalledWith("-i, --interactive", "Run in interactive mode (default)");
      expect(mockProgram.option).toHaveBeenCalledWith("--skip-discovery", "Skip discovery, use existing specification");
      expect(mockProgram.option).toHaveBeenCalledWith("--dry-run", "Generate plan without saving");
      expect(mockProgram.option).toHaveBeenCalledWith("--auto", "Run without confirmations");
    });
  });

  describe("runPlan with skipDiscovery", () => {
    it("should skip CONVERGE phase when skipDiscovery is true", async () => {
      const { findConfigPath } = await import("../../config/loader.js");
      const { createConvergeExecutor } = await import("../../phases/converge/executor.js");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");

      const { runPlan } = await import("./plan.js");
      await runPlan({ cwd: "/test", auto: true, skipDiscovery: true });

      // Converge executor should not be called when skipping discovery
      expect(createConvergeExecutor).not.toHaveBeenCalled();
    });
  });

  describe("runPlan error handling", () => {
    it("should return error when CONVERGE phase fails", async () => {
      const { findConfigPath } = await import("../../config/loader.js");
      const { createConvergeExecutor } = await import("../../phases/converge/executor.js");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(createConvergeExecutor).mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          phase: "converge",
          success: false,
          error: "CONVERGE phase failed: Discovery error",
          artifacts: [],
        }),
        canStart: vi.fn().mockReturnValue(true),
      });

      const { runPlan } = await import("./plan.js");
      const result = await runPlan({ cwd: "/test", auto: true });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return error when ORCHESTRATE phase fails", async () => {
      const { findConfigPath } = await import("../../config/loader.js");
      const { createOrchestrateExecutor } = await import("../../phases/orchestrate/executor.js");

      vi.mocked(findConfigPath).mockResolvedValue("/test/.coco/config.json");
      vi.mocked(createOrchestrateExecutor).mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          phase: "orchestrate",
          success: false,
          error: "ORCHESTRATE phase failed: Planning error",
          artifacts: [],
        }),
        canStart: vi.fn().mockReturnValue(true),
      });

      const { runPlan } = await import("./plan.js");
      const result = await runPlan({ cwd: "/test", auto: true });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
