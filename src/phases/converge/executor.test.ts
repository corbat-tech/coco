/**
 * Tests for CONVERGE phase executor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Create temp directory for tests
let tempDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = path.join(os.tmpdir(), `converge-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("ConvergeExecutor", () => {
  describe("creation", () => {
    it("should create executor with default config", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor();

      expect(executor.name).toBe("converge");
      expect(executor.description).toBeDefined();
    });

    it("should create executor with custom config", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor({
        maxQuestionRounds: 5,
        autoProceed: true,
      });

      expect(executor.name).toBe("converge");
    });

    it("should merge config with defaults", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor({
        includeDiagrams: false,
      });

      expect(executor.name).toBe("converge");
    });

    it("should accept all config options", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor({
        maxQuestionRounds: 10,
        maxQuestionsPerRound: 5,
        autoProceed: true,
        includeDiagrams: true,
        onUserInput: async () => "test input",
        onProgress: () => {},
      });

      expect(executor.name).toBe("converge");
    });
  });

  describe("canStart", () => {
    it("should always return true for CONVERGE phase", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor();

      const canStart = executor.canStart({} as any);

      expect(canStart).toBe(true);
    });

    it("should return true regardless of context state", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor();

      expect(executor.canStart({ state: { artifacts: [] } } as any)).toBe(true);
      expect(executor.canStart({ state: { artifacts: [{ type: "other", path: "/test" }] } } as any)).toBe(true);
    });
  });

  describe("canComplete", () => {
    it("should return false without session", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor();

      const canComplete = executor.canComplete({} as any);

      expect(canComplete).toBe(false);
    });
  });

  describe("checkpoint", () => {
    it("should create checkpoint with correct structure", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor();

      const checkpoint = await executor.checkpoint({
        projectPath: tempDir,
      } as any);

      expect(checkpoint).toBeDefined();
      expect(checkpoint.phase).toBe("converge");
      expect(checkpoint.timestamp).toBeInstanceOf(Date);
      expect(checkpoint.state).toBeDefined();
      expect(checkpoint.state.artifacts).toEqual([]);
    });
  });

  describe("restore", () => {
    it("should restore from checkpoint without error", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor({
        onUserInput: async () => "test",
      });

      const checkpoint = {
        phase: "converge" as const,
        timestamp: new Date(),
        state: { artifacts: [], progress: 50, checkpoint: null },
        resumePoint: "clarification",
      };

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({ questions: [] }),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      // Should not throw
      await expect(
        executor.restore(checkpoint, {
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
        } as any)
      ).resolves.not.toThrow();
    });
  });

  describe("execute", () => {
    it("should fail without user input handler", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor();

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({}),
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

      expect(result.success).toBe(false);
      expect(result.error).toContain("No user input handler configured");
    });

    it("should track progress via callback", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const progressUpdates: Array<{ step: string; progress: number; message: string }> = [];

      const executor = new ConvergeExecutor({
        onUserInput: async () => "done", // Signal to finish
        onProgress: (step, progress, message) => {
          progressUpdates.push({ step, progress, message });
        },
        autoProceed: true,
      });

      const mockLLMChat = vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            session: { id: "test", status: "gathering" },
            questions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            requirements: [],
            assumptions: [],
            techDecisions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({ specification: {} }),
          usage: { inputTokens: 100, outputTokens: 50 },
        });

      await executor.execute({
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

      // Progress should have been reported
      expect(progressUpdates.length).toBeGreaterThan(0);
    });
  });
});

describe("createConvergeExecutor", () => {
  it("should create a ConvergeExecutor instance", async () => {
    const { createConvergeExecutor } = await import("./executor.js");

    const executor = createConvergeExecutor();

    expect(executor).toBeDefined();
    expect(executor.name).toBe("converge");
  });

  it("should accept custom config", async () => {
    const { createConvergeExecutor } = await import("./executor.js");

    const executor = createConvergeExecutor({
      includeDiagrams: false,
    });

    expect(executor).toBeDefined();
  });

  it("should pass all config options", async () => {
    const { createConvergeExecutor } = await import("./executor.js");

    const userInputHandler = async (_prompt: string) => "response";
    const progressHandler = (_step: string, _progress: number, _msg: string) => {};

    const executor = createConvergeExecutor({
      maxQuestionRounds: 5,
      maxQuestionsPerRound: 4,
      autoProceed: true,
      includeDiagrams: false,
      onUserInput: userInputHandler,
      onProgress: progressHandler,
    });

    expect(executor).toBeDefined();
  });
});

describe("runConvergePhase", () => {
  it("should exist as a function", async () => {
    const { runConvergePhase } = await import("./executor.js");

    expect(typeof runConvergePhase).toBe("function");
  });

  it("should return error result on LLM failure", async () => {
    const { runConvergePhase } = await import("./executor.js");

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

    const result = await runConvergePhase(tempDir, mockLLM as any);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("DEFAULT_CONVERGE_CONFIG", () => {
  it("should have expected default values", async () => {
    const { DEFAULT_CONVERGE_CONFIG } = await import("./executor.js");

    expect(DEFAULT_CONVERGE_CONFIG.maxQuestionRounds).toBe(3);
    expect(DEFAULT_CONVERGE_CONFIG.maxQuestionsPerRound).toBe(3);
    expect(DEFAULT_CONVERGE_CONFIG.autoProceed).toBe(false);
    expect(DEFAULT_CONVERGE_CONFIG.includeDiagrams).toBe(true);
  });

  it("should not have onUserInput by default", async () => {
    const { DEFAULT_CONVERGE_CONFIG } = await import("./executor.js");

    expect(DEFAULT_CONVERGE_CONFIG.onUserInput).toBeUndefined();
  });

  it("should not have onProgress by default", async () => {
    const { DEFAULT_CONVERGE_CONFIG } = await import("./executor.js");

    expect(DEFAULT_CONVERGE_CONFIG.onProgress).toBeUndefined();
  });
});

describe("ConvergeConfig interface", () => {
  it("should accept all valid step values for onProgress", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    type ReceivedStep = string;
    const receivedSteps: ReceivedStep[] = [];

    const executor = new ConvergeExecutor({
      onProgress: (step) => {
        receivedSteps.push(step);
      },
    });

    expect(executor).toBeDefined();
    // Steps are validated by TypeScript types
  });
});
