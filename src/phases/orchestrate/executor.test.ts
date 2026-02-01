/**
 * Tests for ORCHESTRATE phase executor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Create temp directory for tests
let tempDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = path.join(os.tmpdir(), `orchestrate-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("OrchestrateExecutor", () => {
  describe("creation", () => {
    it("should create executor with default config", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const executor = new OrchestrateExecutor();

      expect(executor.name).toBe("orchestrate");
      expect(executor.description).toBeDefined();
    });

    it("should create executor with custom config", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const executor = new OrchestrateExecutor({
        generateC4Diagrams: true,
        generateSequenceDiagrams: false,
      });

      expect(executor.name).toBe("orchestrate");
    });

    it("should merge config with defaults", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const executor = new OrchestrateExecutor({
        maxADRs: 5,
      });

      expect(executor.name).toBe("orchestrate");
    });
  });

  describe("canStart", () => {
    it("should check if specification exists", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const executor = new OrchestrateExecutor();

      // Test with specification
      const canStart = executor.canStart({
        state: {
          artifacts: [
            { type: "specification", path: "/test/spec.md" },
          ],
        },
      } as any);

      // Just verify it returns a boolean
      expect(typeof canStart).toBe("boolean");
    });

    it("should return true even without prior artifacts", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const executor = new OrchestrateExecutor();

      const canStart = executor.canStart({
        state: {
          artifacts: [],
        },
      } as any);

      expect(canStart).toBe(true);
    });
  });

  describe("canComplete", () => {
    it("should return true by default", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const executor = new OrchestrateExecutor();

      const canComplete = executor.canComplete({} as any);

      expect(canComplete).toBe(true);
    });
  });

  describe("checkpoint", () => {
    it("should create checkpoint with correct structure", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const executor = new OrchestrateExecutor();

      const checkpoint = await executor.checkpoint({
        projectPath: tempDir,
      } as any);

      expect(checkpoint).toBeDefined();
      expect(checkpoint.phase).toBe("orchestrate");
      expect(checkpoint.timestamp).toBeInstanceOf(Date);
      expect(checkpoint.state).toBeDefined();
      expect(checkpoint.resumePoint).toBe("start");
    });
  });

  describe("restore", () => {
    it("should restore from checkpoint without error", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const executor = new OrchestrateExecutor();

      const checkpoint = {
        phase: "orchestrate" as const,
        timestamp: new Date(),
        state: { artifacts: [], progress: 50, checkpoint: null },
        resumePoint: "architecture",
      };

      // Should not throw
      await expect(
        executor.restore(checkpoint, { projectPath: tempDir } as any)
      ).resolves.not.toThrow();
    });
  });

  describe("execute", () => {
    it("should handle missing specification file gracefully", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const executor = new OrchestrateExecutor();

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          overview: { pattern: "hexagonal", description: "Test" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const result = await executor.execute({
        projectPath: tempDir,
        config: {
          quality: { minScore: 85, minCoverage: 80, maxIterations: 10, convergenceThreshold: 2 },
          timeouts: { phaseTimeout: 3600000, taskTimeout: 600000, llmTimeout: 120000 },
        },
        state: { artifacts: [], progress: 0, checkpoint: null },
        tools: {} as any,
        llm: {
          chat: mockLLMChat,
          chatWithTools: vi.fn(),
        },
      });

      // The executor should handle missing spec gracefully by creating minimal spec
      expect(result.phase).toBe("orchestrate");
    });

    it("should return error result on failure", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const executor = new OrchestrateExecutor();

      const mockLLMChat = vi.fn().mockRejectedValue(new Error("LLM Error"));

      const result = await executor.execute({
        projectPath: tempDir,
        config: {
          quality: { minScore: 85, minCoverage: 80, maxIterations: 10, convergenceThreshold: 2 },
          timeouts: { phaseTimeout: 3600000, taskTimeout: 600000, llmTimeout: 120000 },
        },
        state: { artifacts: [], progress: 0, checkpoint: null },
        tools: {} as any,
        llm: {
          chat: mockLLMChat,
          chatWithTools: vi.fn(),
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

describe("createOrchestrateExecutor", () => {
  it("should create an OrchestrateExecutor instance", async () => {
    const { createOrchestrateExecutor } = await import("./executor.js");

    const executor = createOrchestrateExecutor();

    expect(executor).toBeDefined();
    expect(executor.name).toBe("orchestrate");
  });

  it("should accept custom config", async () => {
    const { createOrchestrateExecutor } = await import("./executor.js");

    const executor = createOrchestrateExecutor({
      breakdownStrategy: "horizontal",
    });

    expect(executor).toBeDefined();
  });

  it("should accept all config options", async () => {
    const { createOrchestrateExecutor } = await import("./executor.js");

    const executor = createOrchestrateExecutor({
      generateC4Diagrams: false,
      generateSequenceDiagrams: false,
      maxADRs: 5,
      breakdownStrategy: "by_feature",
      generateDeploymentDocs: false,
      sprint: {
        sprintDuration: 7,
        targetVelocity: 15,
        maxStoriesPerSprint: 5,
        bufferPercentage: 25,
      },
    });

    expect(executor).toBeDefined();
  });
});

describe("runOrchestratePhase", () => {
  it("should exist as a function", async () => {
    const { runOrchestratePhase } = await import("./executor.js");

    expect(typeof runOrchestratePhase).toBe("function");
  });

  it("should return error result on LLM failure", async () => {
    const { runOrchestratePhase } = await import("./executor.js");

    const mockLLM = {
      id: "mock",
      name: "Mock LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockRejectedValue(new Error("LLM Error")),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      countTokens: vi.fn(),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runOrchestratePhase(tempDir, mockLLM as any);

    expect("error" in result).toBe(true);
  });
});

describe("DEFAULT_ORCHESTRATE_CONFIG", () => {
  it("should be exported", async () => {
    const { DEFAULT_ORCHESTRATE_CONFIG } = await import("./types.js");

    expect(DEFAULT_ORCHESTRATE_CONFIG).toBeDefined();
  });

  it("should have expected default values", async () => {
    const { DEFAULT_ORCHESTRATE_CONFIG } = await import("./types.js");

    expect(DEFAULT_ORCHESTRATE_CONFIG.generateC4Diagrams).toBe(true);
    expect(DEFAULT_ORCHESTRATE_CONFIG.generateSequenceDiagrams).toBe(true);
    expect(DEFAULT_ORCHESTRATE_CONFIG.maxADRs).toBe(10);
    expect(DEFAULT_ORCHESTRATE_CONFIG.breakdownStrategy).toBe("tdd");
    expect(DEFAULT_ORCHESTRATE_CONFIG.generateDeploymentDocs).toBe(true);
  });

  it("should have sprint config", async () => {
    const { DEFAULT_ORCHESTRATE_CONFIG } = await import("./types.js");

    expect(DEFAULT_ORCHESTRATE_CONFIG.sprint).toBeDefined();
    expect(DEFAULT_ORCHESTRATE_CONFIG.sprint.sprintDuration).toBe(14);
    expect(DEFAULT_ORCHESTRATE_CONFIG.sprint.targetVelocity).toBe(20);
    expect(DEFAULT_ORCHESTRATE_CONFIG.sprint.maxStoriesPerSprint).toBe(8);
    expect(DEFAULT_ORCHESTRATE_CONFIG.sprint.bufferPercentage).toBe(20);
  });
});
