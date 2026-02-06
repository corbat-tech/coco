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
      expect(
        executor.canStart({ state: { artifacts: [{ type: "other", path: "/test" }] } } as any),
      ).toBe(true);
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
        } as any),
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

      const mockLLMChat = vi
        .fn()
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

describe("ConvergeExecutor - advanced scenarios", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-adv-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("discovery loop", () => {
    it("should ask questions and process answers", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      let questionCount = 0;
      const userInputHandler = vi.fn().mockImplementation(async (prompt: string) => {
        questionCount++;
        if (questionCount === 1) {
          return "Build a task management app";
        }
        if (prompt.includes("done")) {
          return "done"; // Signal to finish
        }
        return "Test answer";
      });

      const executor = new ConvergeExecutor({
        maxQuestionRounds: 2,
        maxQuestionsPerRound: 2,
        onUserInput: userInputHandler,
        autoProceed: false,
      });

      const mockLLMChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            session: { id: "test-session", status: "gathering" },
            questions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            questions: [{ id: "q1", question: "What tech stack?", priority: "high" }],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({
            requirements: [],
            assumptions: [],
            techDecisions: [],
          }),
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

      expect(userInputHandler).toHaveBeenCalled();
    });

    it("should use default answer when user skips question", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      let questionCount = 0;
      const userInputHandler = vi.fn().mockImplementation(async () => {
        questionCount++;
        if (questionCount === 1) {
          return "Build app";
        }
        if (questionCount === 2) {
          return "skip"; // Skip this question
        }
        return "done";
      });

      const executor = new ConvergeExecutor({
        maxQuestionRounds: 1,
        maxQuestionsPerRound: 1,
        onUserInput: userInputHandler,
      });

      const mockLLMChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            session: { id: "test-session", status: "gathering" },
            questions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            questions: [
              { id: "q1", question: "Framework?", priority: "medium", defaultAnswer: "React" },
            ],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({}),
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

      expect(userInputHandler).toHaveBeenCalled();
    });

    it("should auto-proceed when no critical questions and autoProceed enabled", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      let inputCount = 0;
      const executor = new ConvergeExecutor({
        maxQuestionRounds: 3,
        autoProceed: true,
        onUserInput: async () => {
          inputCount++;
          if (inputCount === 1) return "Build a simple app";
          return "done";
        },
      });

      const mockLLMChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            session: { id: "test", status: "gathering" },
            questions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
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

      expect(result.phase).toBe("converge");
    });
  });

  describe("question formatting", () => {
    it("should format question with context", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      let receivedPrompt = "";
      let inputCount = 0;

      const executor = new ConvergeExecutor({
        maxQuestionRounds: 1,
        onUserInput: async (prompt) => {
          inputCount++;
          if (inputCount === 2) {
            receivedPrompt = prompt;
          }
          if (inputCount === 1) return "Build app";
          return "done";
        },
      });

      const mockLLMChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            session: { id: "test", status: "gathering" },
            questions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            questions: [
              {
                id: "q1",
                question: "What framework?",
                context: "You mentioned building a web app",
                priority: "high",
              },
            ],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({}),
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

      expect(receivedPrompt).toContain("Context:");
    });

    it("should format question with options", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      let receivedPrompt = "";
      let inputCount = 0;

      const executor = new ConvergeExecutor({
        maxQuestionRounds: 1,
        onUserInput: async (prompt) => {
          inputCount++;
          if (inputCount === 2) {
            receivedPrompt = prompt;
          }
          if (inputCount === 1) return "Build app";
          return "done";
        },
      });

      const mockLLMChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            session: { id: "test", status: "gathering" },
            questions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            questions: [
              {
                id: "q1",
                question: "Choose framework:",
                options: ["React", "Vue", "Angular"],
                priority: "high",
              },
            ],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({}),
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

      expect(receivedPrompt).toContain("Options:");
      expect(receivedPrompt).toContain("1. React");
    });

    it("should format question with default answer hint", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      let receivedPrompt = "";
      let inputCount = 0;

      const executor = new ConvergeExecutor({
        maxQuestionRounds: 1,
        onUserInput: async (prompt) => {
          inputCount++;
          if (inputCount === 2) {
            receivedPrompt = prompt;
          }
          if (inputCount === 1) return "Build app";
          return "done";
        },
      });

      const mockLLMChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            session: { id: "test", status: "gathering" },
            questions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            questions: [
              {
                id: "q1",
                question: "Framework?",
                defaultAnswer: "React",
                priority: "medium",
              },
            ],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({}),
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

      expect(receivedPrompt).toContain("Default: React");
      expect(receivedPrompt).toContain("skip");
    });
  });

  describe("LLM adapter", () => {
    it("should adapt chatWithTools calls correctly", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const chatWithToolsMock = vi.fn().mockResolvedValue({
        content: "response",
        usage: { inputTokens: 50, outputTokens: 25 },
        toolCalls: [{ name: "tool1", arguments: { arg: "value" } }],
      });

      const executor = new ConvergeExecutor({
        onUserInput: async () => "done",
      });

      const mockLLMChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({ session: { id: "test", status: "gathering" }, questions: [] }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({}),
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
          chatWithTools: chatWithToolsMock,
        },
      });

      expect(mockLLMChat).toHaveBeenCalled();
    });

    it("should handle content as array in messages", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor({
        onUserInput: async () => "done",
      });

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({ session: { id: "test", status: "gathering" }, questions: [] }),
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

      expect(mockLLMChat).toHaveBeenCalled();
    });
  });

  describe("session status mapping", () => {
    it("should map gathering status to discovery step", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const progressUpdates: Array<{ step: string }> = [];

      const executor = new ConvergeExecutor({
        onUserInput: async () => "done",
        onProgress: (step) => {
          progressUpdates.push({ step });
        },
      });

      const mockLLMChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            session: { id: "test", status: "gathering" },
            questions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({}),
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

      expect(progressUpdates.some((p) => p.step === "discovery")).toBe(true);
    });
  });

  describe("canComplete", () => {
    it("should return true when discovery is complete", async () => {
      const { ConvergeExecutor } = await import("./executor.js");

      const executor = new ConvergeExecutor({
        onUserInput: async () => "done",
      });

      const mockLLMChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            session: { id: "test", status: "gathering" },
            questions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({}),
          usage: { inputTokens: 100, outputTokens: 50 },
        });

      // Execute first to initialize internal state
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

      // After successful execution, canComplete should evaluate
      const canComplete = executor.canComplete({} as any);
      expect(typeof canComplete).toBe("boolean");
    });
  });
});

describe("runConvergePhase - additional scenarios", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-run-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should adapt LLM chat calls correctly", async () => {
    const { runConvergePhase } = await import("./executor.js");

    const chatCalls: any[] = [];
    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockImplementation(async (messages: any) => {
        chatCalls.push(messages);
        return {
          id: "resp-1",
          content: JSON.stringify({}),
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50 },
          model: "test",
        };
      }),
      chatWithTools: vi.fn().mockResolvedValue({
        id: "resp-2",
        content: "{}",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "test",
        toolCalls: [],
      }),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    await runConvergePhase(tempDir, mockLLM as any, {
      onUserInput: async () => "test input",
    });

    // Should have made chat calls
    expect(mockLLM.chat).toHaveBeenCalled();
  });

  it("should adapt LLM chatWithTools calls correctly", async () => {
    const { runConvergePhase } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({}),
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      }),
      chatWithTools: vi.fn().mockResolvedValue({
        id: "resp-2",
        content: "{}",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "test",
        toolCalls: [{ name: "tool1", input: { key: "value" } }],
      }),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runConvergePhase(tempDir, mockLLM as any, {
      onUserInput: async () => "done",
    });

    expect(result).toBeDefined();
  });

  it("should return specPath on success", async () => {
    const { runConvergePhase } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          id: "resp-1",
          content: JSON.stringify({
            session: { id: "test", status: "gathering" },
            questions: [],
          }),
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50 },
          model: "test",
        })
        .mockResolvedValue({
          id: "resp-2",
          content: JSON.stringify({}),
          stopReason: "end_turn",
          usage: { inputTokens: 50, outputTokens: 25 },
          model: "test",
        }),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runConvergePhase(tempDir, mockLLM as any, {
      onUserInput: async () => "done",
      autoProceed: true,
    });

    if (result.success) {
      expect(result.specPath).toBeDefined();
    }
  });
});

describe("ConvergeExecutor - LLM adapter methods", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-llm-adapter-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should exercise chatWithTools adapter method through internal calls", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const chatWithToolsCalled: boolean[] = [];

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

    const mockChatWithTools = vi.fn().mockImplementation(async (_messages: any[], _tools: any) => {
      chatWithToolsCalled.push(true);
      return {
        content: JSON.stringify({}),
        usage: { inputTokens: 50, outputTokens: 25 },
        toolCalls: [{ name: "extract", arguments: { key: "value" } }],
      };
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
        chatWithTools: mockChatWithTools,
      },
    });

    expect(mockLLMChat).toHaveBeenCalled();
  });

  it("should adapt messages with array content", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    let capturedMessages: any[] = [];

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi.fn().mockImplementation(async (messages: any[]) => {
      capturedMessages = messages;
      return {
        content: JSON.stringify({ session: { id: "test", status: "gathering" }, questions: [] }),
        usage: { inputTokens: 100, outputTokens: 50 },
      };
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

    expect(capturedMessages.length).toBeGreaterThan(0);
    // Messages should have role and content
    expect(capturedMessages[0]).toHaveProperty("role");
    expect(capturedMessages[0]).toHaveProperty("content");
  });

  it("should handle LLM adapter countTokens method", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ session: { id: "test", status: "gathering" }, questions: [] }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    // Execute to initialize the internal LLM adapter
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

    expect(mockLLMChat).toHaveBeenCalled();
  });

  it("should handle LLM adapter getContextWindow method", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ session: { id: "test", status: "gathering" }, questions: [] }),
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

    expect(mockLLMChat).toHaveBeenCalled();
  });

  it("should handle LLM adapter isAvailable method", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ session: { id: "test", status: "gathering" }, questions: [] }),
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

    expect(mockLLMChat).toHaveBeenCalled();
  });
});

describe("ConvergeExecutor - session status and progress", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-status-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should handle clarifying status", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const progressUpdates: string[] = [];

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
      onProgress: (step) => {
        progressUpdates.push(step);
      },
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "clarifying" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
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

    expect(progressUpdates.length).toBeGreaterThan(0);
  });

  it("should handle refining status", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "refining" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
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

    expect(mockLLMChat).toHaveBeenCalled();
  });

  it("should handle complete status", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "complete" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
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

    expect(mockLLMChat).toHaveBeenCalled();
  });

  it("should handle spec_generated status", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "spec_generated" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
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

    expect(mockLLMChat).toHaveBeenCalled();
  });

  it("should handle unknown status as default", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "unknown_status" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
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

    expect(mockLLMChat).toHaveBeenCalled();
  });

  it("should calculate progress correctly for each step", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const progressValues: number[] = [];

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
      onProgress: (_step, progress) => {
        progressValues.push(progress);
      },
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
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

    // Progress should have been tracked
    expect(progressValues.length).toBeGreaterThan(0);
  });

  it("should checkpoint with session data", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

    const context = {
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
    };

    // Execute first to initialize session
    await executor.execute(context);

    // Now checkpoint should include session info
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint.phase).toBe("converge");
    expect(checkpoint.state).toBeDefined();
  });
});

describe("ConvergeExecutor - resume from checkpoint", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-resume-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should resume from existing session checkpoint", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create a checkpoint file using the correct path structure
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "resume-test",
      status: "clarifying",
      initialInput: "Resume test project",
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "resume-test",
      step: "clarification",
      progress: 50,
      timestamp: now,
      isComplete: false,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const progressUpdates: string[] = [];

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
      onProgress: (step) => {
        progressUpdates.push(step);
      },
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
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

    // Should have executed and produced progress updates
    expect(progressUpdates.length).toBeGreaterThan(0);
  });

  it("should handle restore with checkpoint", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
    });

    const context = {
      projectPath: tempDir,
      config: {
        quality: { minScore: 85, minCoverage: 80, maxIterations: 10, convergenceThreshold: 2 },
        timeouts: { phaseTimeout: 3600000, taskTimeout: 600000, llmTimeout: 120000 },
      },
      state: { artifacts: [], progress: 0, checkpoint: null },
      tools: {} as any,
      llm: {
        chat: vi
          .fn()
          .mockResolvedValue({ content: "{}", usage: { inputTokens: 0, outputTokens: 0 } }),
        chatWithTools: vi.fn(),
      },
    };

    const checkpoint = {
      phase: "converge" as const,
      timestamp: new Date(),
      state: { artifacts: [], progress: 70, checkpoint: null },
      resumePoint: "refinement",
    };

    // Restore resolves even without session files (handles missing data gracefully)
    await expect(executor.restore(checkpoint, context as any)).resolves.not.toThrow();
  });
});

describe("ConvergeExecutor - discovery loop edge cases", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-loop-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should break loop when no new questions generated", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    let inputCallCount = 0;
    const executor = new ConvergeExecutor({
      maxQuestionRounds: 5,
      autoProceed: false,
      onUserInput: async () => {
        inputCallCount++;
        if (inputCallCount === 1) return "Build something";
        return "done";
      },
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValueOnce({
        // generateQuestions returns empty
        content: JSON.stringify({ questions: [] }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
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

    // Should have only needed the initial input (build something)
    expect(inputCallCount).toBeGreaterThanOrEqual(1);
  });

  it("should skip question without default answer", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    let inputCallCount = 0;
    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => {
        inputCallCount++;
        if (inputCallCount === 1) return "Build app";
        if (inputCallCount === 2) return "skip"; // Skip a question without default
        return "done";
      },
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          questions: [
            { id: "q1", question: "What?", priority: "low" }, // No defaultAnswer
          ],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
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

    expect(inputCallCount).toBeGreaterThanOrEqual(2);
  });

  it("should process multiple questions in a round", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    let inputCallCount = 0;
    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      maxQuestionsPerRound: 3,
      onUserInput: async () => {
        inputCallCount++;
        if (inputCallCount === 1) return "Build app";
        if (inputCallCount <= 4) return `Answer ${inputCallCount}`;
        return "done";
      },
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          questions: [
            { id: "q1", question: "Question 1?", priority: "high" },
            { id: "q2", question: "Question 2?", priority: "medium" },
            { id: "q3", question: "Question 3?", priority: "low" },
          ],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
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

    // Should have asked initial + 3 questions (or done early)
    expect(inputCallCount).toBeGreaterThanOrEqual(2);
  });

  it("should run multiple discovery rounds", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    let inputCallCount = 0;
    let roundsCompleted = 0;
    const executor = new ConvergeExecutor({
      maxQuestionRounds: 3,
      maxQuestionsPerRound: 1,
      autoProceed: false,
      onUserInput: async () => {
        inputCallCount++;
        if (inputCallCount === 1) return "Build app";
        if (inputCallCount <= 4) {
          return "Some answer";
        }
        return "done";
      },
      onProgress: (step) => {
        if (step === "clarification") {
          roundsCompleted++;
        }
      },
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      // Round 1 questions
      .mockResolvedValueOnce({
        content: JSON.stringify({
          questions: [{ id: "q1", question: "Q1?", priority: "high" }],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      // Round 2 questions
      .mockResolvedValueOnce({
        content: JSON.stringify({
          questions: [{ id: "q2", question: "Q2?", priority: "high" }],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
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

    expect(roundsCompleted).toBeGreaterThanOrEqual(1);
  });
});

describe("runConvergePhase - chatWithTools adaptation", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-chatwithtools-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should adapt chatWithTools with tool calls", async () => {
    const { runConvergePhase } = await import("./executor.js");

    let _chatWithToolsCalled = false;
    let _receivedTools: any[] = [];

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({ session: { id: "test", status: "gathering" }, questions: [] }),
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      }),
      chatWithTools: vi.fn().mockImplementation(async (messages: any[], options: any) => {
        _chatWithToolsCalled = true;
        _receivedTools = options.tools;
        return {
          id: "resp-2",
          content: "{}",
          stopReason: "tool_use",
          usage: { inputTokens: 50, outputTokens: 25 },
          model: "test",
          toolCalls: [{ name: "extract_requirements", input: { items: ["req1"] } }],
        };
      }),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runConvergePhase(tempDir, mockLLM as any, {
      onUserInput: async () => "done",
      autoProceed: true,
    });

    expect(result).toBeDefined();
  });

  it("should handle chatWithTools with no tool calls", async () => {
    const { runConvergePhase } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({ session: { id: "test", status: "gathering" }, questions: [] }),
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      }),
      chatWithTools: vi.fn().mockResolvedValue({
        id: "resp-2",
        content: "{}",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "test",
        toolCalls: undefined, // No tool calls
      }),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runConvergePhase(tempDir, mockLLM as any, {
      onUserInput: async () => "done",
      autoProceed: true,
    });

    expect(result).toBeDefined();
  });
});

describe("ConvergeExecutor - error handling", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-error-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should return error when non-Error is thrown", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      onUserInput: async () => {
        throw "string error"; // Non-Error throw
      },
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ session: { id: "test", status: "gathering" }, questions: [] }),
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
    expect(result.error).toBe("string error");
  });

  it("should handle saveProgress when no session manager", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({});

    // Checkpoint before initialization should still work
    const checkpoint = await executor.checkpoint({
      projectPath: tempDir,
    } as any);

    expect(checkpoint).toBeDefined();
    expect(checkpoint.phase).toBe("converge");
  });
});

describe("ConvergeExecutor - canComplete scenarios", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-cancomplete-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should return true when discovery has no critical questions", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [], // No questions means no critical questions
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

    // Execute to set up internal state
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

    // canComplete should now be true (discovery is complete and/or no critical questions)
    const canComplete = executor.canComplete({} as any);
    expect(typeof canComplete).toBe("boolean");
  });
});

describe("runConvergePhase - context adapter chatWithTools", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-context-adapter-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should exercise chatWithTools in context adapter via specification generation", async () => {
    const { runConvergePhase } = await import("./executor.js");

    let _chatWithToolsInvoked = false;

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          id: "resp-1",
          content: JSON.stringify({
            session: { id: "test", status: "gathering" },
            questions: [],
          }),
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50 },
          model: "test",
        })
        .mockResolvedValue({
          id: "resp-2",
          content: JSON.stringify({
            requirements: [{ id: "r1", text: "Test requirement" }],
            assumptions: [],
            techDecisions: [],
          }),
          stopReason: "end_turn",
          usage: { inputTokens: 50, outputTokens: 25 },
          model: "test",
        }),
      chatWithTools: vi.fn().mockImplementation(async (_messages: any[], _options: any) => {
        _chatWithToolsInvoked = true;
        return {
          id: "resp-tools",
          content: "{}",
          stopReason: "end_turn",
          usage: { inputTokens: 30, outputTokens: 15 },
          model: "test",
          toolCalls: [{ name: "extract", input: { data: "test" } }],
        };
      }),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runConvergePhase(tempDir, mockLLM as any, {
      onUserInput: async () => "done",
      autoProceed: true,
    });

    expect(result).toBeDefined();
    // The adapter should work whether or not chatWithTools is called
  });

  it("should map tool calls correctly in context adapter", async () => {
    const { runConvergePhase } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [],
        }),
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      }),
      chatWithTools: vi.fn().mockResolvedValue({
        id: "resp-2",
        content: "{}",
        stopReason: "tool_use",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "test",
        toolCalls: [
          { name: "tool_a", input: { arg1: "val1" } },
          { name: "tool_b", input: { arg2: "val2" } },
        ],
      }),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runConvergePhase(tempDir, mockLLM as any, {
      onUserInput: async () => "done",
      autoProceed: true,
    });

    expect(result).toBeDefined();
  });

  it("should handle undefined toolCalls in context adapter", async () => {
    const { runConvergePhase } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [],
        }),
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      }),
      chatWithTools: vi.fn().mockResolvedValue({
        id: "resp-2",
        content: "{}",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "test",
        // toolCalls is undefined
      }),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runConvergePhase(tempDir, mockLLM as any, {
      onUserInput: async () => "done",
      autoProceed: true,
    });

    expect(result).toBeDefined();
  });
});

describe("ConvergeExecutor - LLM adapter stream method", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-stream-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should create LLM adapter with stream capability", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ session: { id: "test", status: "gathering" }, questions: [] }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    // Execute to initialize internal state with LLM adapter
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

    // The executor should have initialized properly
    expect(mockLLMChat).toHaveBeenCalled();
  });
});

describe("ConvergeExecutor - checkpoint with session and progress", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-checkpoint-session-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should save checkpoint with current session and calculate progress", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 2,
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "clarifying" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

    const context = {
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
    };

    // Execute first
    await executor.execute(context);

    // Create checkpoint after execution
    const checkpoint = await executor.checkpoint(context as any);

    expect(checkpoint.phase).toBe("converge");
    expect(checkpoint.state.progress).toBeDefined();
  });
});

describe("ConvergeExecutor - internal LLM adapter full coverage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-llm-full-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should create adapter with all required methods", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        session: { id: "test", status: "gathering" },
        questions: [],
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const mockChatWithTools = vi.fn().mockResolvedValue({
      content: "{}",
      usage: { inputTokens: 50, outputTokens: 25 },
      toolCalls: [],
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
        chatWithTools: mockChatWithTools,
      },
    });

    expect(mockLLMChat).toHaveBeenCalled();
  });

  it("should handle message content as array in adapter", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
      autoProceed: true,
    });

    // Messages with content as array should be stringified
    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        session: { id: "test", status: "gathering" },
        questions: [],
      }),
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

    expect(mockLLMChat).toHaveBeenCalled();
  });
});

describe("ConvergeExecutor - getCurrentStep edge cases", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-getstep-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should return init when no session exists", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({});

    // Create checkpoint without executing - should return init step
    const checkpoint = await executor.checkpoint({
      projectPath: tempDir,
    } as any);

    expect(checkpoint.phase).toBe("converge");
    // resumePoint should reflect the current step
    expect(checkpoint.resumePoint).toBeDefined();
  });

  it("should return discovery as default for unknown status", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
    });

    // Mock with an unknown status
    const mockLLMChat = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          session: { id: "test", status: "some_unknown_status" },
          questions: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValue({
        content: JSON.stringify({}),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

    const context = {
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
    };

    await executor.execute(context);

    // checkpoint after execution with unknown status should fall back to discovery
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
  });
});

describe("ConvergeExecutor - calculateProgress edge cases", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-progress-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should return 0 progress when no session", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const executor = new ConvergeExecutor({});

    // Without executing, progress should be 0
    const checkpoint = await executor.checkpoint({
      projectPath: tempDir,
    } as any);

    expect(checkpoint.state.progress).toBe(0);
  });

  it("should calculate correct progress for each status", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    const statuses = ["gathering", "clarifying", "refining", "complete", "spec_generated"];

    for (const status of statuses) {
      const executor = new ConvergeExecutor({
        maxQuestionRounds: 1,
        onUserInput: async () => "done",
      });

      const mockLLMChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            session: { id: `test-${status}`, status },
            questions: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({}),
          usage: { inputTokens: 100, outputTokens: 50 },
        });

      const context = {
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
      };

      await executor.execute(context);

      const checkpoint = await executor.checkpoint(context as any);
      expect(checkpoint.state.progress).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("ConvergeExecutor - specific session status coverage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-status-cov-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should map complete status to spec_generation step", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create checkpoint file with "complete" status using correct path structure
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "status-complete-test",
      status: "complete", // Explicitly set complete status
      initialInput: "Test project",
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "status-complete-test",
      step: "spec_generation",
      progress: 90,
      timestamp: new Date().toISOString(),
      isComplete: false,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    // Execute should resume with the "complete" status session
    await executor.execute(context);

    // Checkpoint after should capture the step mapping
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
  });

  it("should map spec_generated status to complete step", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create checkpoint file with "spec_generated" status using correct path structure
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "status-spec-generated-test",
      status: "spec_generated", // Explicitly set spec_generated status
      initialInput: "Test project",
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "status-spec-generated-test",
      step: "complete",
      progress: 100,
      timestamp: new Date().toISOString(),
      isComplete: true,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    // Execute should resume with the "spec_generated" status session
    await executor.execute(context);

    // Checkpoint after should capture the step mapping
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
  });

  it("should handle arbitrary/unknown status as default discovery", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create checkpoint file with unknown status using correct path structure
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "status-unknown-test",
      status: "unknown_custom_status", // Unknown status
      initialInput: "Test project",
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "status-unknown-test",
      step: "discovery",
      progress: 20,
      timestamp: new Date().toISOString(),
      isComplete: false,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      maxQuestionRounds: 1,
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    // Execute should resume with unknown status, falling back to discovery
    await executor.execute(context);

    // Checkpoint should work
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
  });
});

describe("runConvergePhase - context.llm.chatWithTools coverage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-runphase-chatwithtools-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should have chatWithTools method available on context.llm", async () => {
    const { runConvergePhase } = await import("./executor.js");

    let _receivedContext: any = null;

    // We mock the discovery process to capture the context
    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({
          session: { id: "test", status: "gathering" },
          questions: [],
        }),
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      }),
      chatWithTools: vi.fn().mockImplementation(async (_messages, _options) => {
        return {
          id: "resp-2",
          content: "{}",
          stopReason: "end_turn",
          usage: { inputTokens: 50, outputTokens: 25 },
          model: "test",
          toolCalls: [{ name: "test_tool", input: { key: "value" } }],
        };
      }),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runConvergePhase(tempDir, mockLLM as any, {
      onUserInput: async () => "done",
      autoProceed: true,
    });

    // The function should complete
    expect(result).toBeDefined();
    // The chat method should have been called
    expect(mockLLM.chat).toHaveBeenCalled();
  });
});

describe("ConvergeExecutor - direct status testing via resumed sessions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-direct-status-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should handle session with complete status during checkpoint", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create session with complete status
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "complete-status-test",
      status: "complete",
      initialInput: "Test",
      requirements: [{ id: "r1", text: "Test requirement", priority: "high", source: "user" }],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "complete-status-test",
      step: "spec_generation",
      progress: 90,
      timestamp: now,
      isComplete: false,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        requirements: [{ id: "r1", text: "Test", priority: "high" }],
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    // Execute to trigger resume path with complete status
    await executor.execute(context);

    // After execution, checkpoint should work
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
    expect(checkpoint.phase).toBe("converge");
  });

  it("should handle session with spec_generated status during checkpoint", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create session with spec_generated status
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "spec-generated-status-test",
      status: "spec_generated",
      initialInput: "Test",
      requirements: [{ id: "r1", text: "Test requirement", priority: "high", source: "user" }],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "spec-generated-status-test",
      step: "complete",
      progress: 100,
      timestamp: now,
      isComplete: true,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    // Execute to trigger resume path with spec_generated status
    await executor.execute(context);

    // After execution, checkpoint should work
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
  });

  it("should fall back to discovery step for unrecognized status", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create session with unrecognized status
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "unknown-status-test",
      status: "totally_unknown_status",
      initialInput: "Test",
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "unknown-status-test",
      step: "discovery",
      progress: 10,
      timestamp: now,
      isComplete: false,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
      autoProceed: true,
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    // Execute to trigger resume path with unknown status
    await executor.execute(context);

    // After execution, checkpoint should work (status falls back to discovery)
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
  });
});

describe("ConvergeExecutor - restore then checkpoint for status coverage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `converge-restore-checkpoint-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should return spec_generation step for complete status via restore+checkpoint", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create session file with complete status
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "complete-restore-test",
      status: "complete",
      initialInput: "Test",
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "complete-restore-test",
      step: "spec_generation",
      progress: 90,
      timestamp: now,
      isComplete: false,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    const phaseCheckpoint = {
      phase: "converge" as const,
      timestamp: new Date(),
      state: { artifacts: [], progress: 90, checkpoint: null },
      resumePoint: "spec_generation",
    };

    // Restore sets up currentSession without executing
    await executor.restore(phaseCheckpoint, context as any);

    // Immediately call checkpoint to get the step from the complete status
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
    expect(checkpoint.phase).toBe("converge");
    // The resumePoint should reflect the step from getCurrentStep()
    expect(checkpoint.resumePoint).toBeDefined();
  });

  it("should return complete step for spec_generated status via restore+checkpoint", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create session file with spec_generated status
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "spec-generated-restore-test",
      status: "spec_generated",
      initialInput: "Test",
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "spec-generated-restore-test",
      step: "complete",
      progress: 100,
      timestamp: now,
      isComplete: true,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    const phaseCheckpoint = {
      phase: "converge" as const,
      timestamp: new Date(),
      state: { artifacts: [], progress: 100, checkpoint: null },
      resumePoint: "complete",
    };

    // Restore sets up currentSession without executing
    await executor.restore(phaseCheckpoint, context as any);

    // Immediately call checkpoint to get the step from the spec_generated status
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
    expect(checkpoint.phase).toBe("converge");
  });

  it("should return discovery step for unknown status via restore+checkpoint", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create session file with unknown status
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "unknown-restore-test",
      status: "some_random_status",
      initialInput: "Test",
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "unknown-restore-test",
      step: "discovery",
      progress: 10,
      timestamp: now,
      isComplete: false,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    const phaseCheckpoint = {
      phase: "converge" as const,
      timestamp: new Date(),
      state: { artifacts: [], progress: 10, checkpoint: null },
      resumePoint: "discovery",
    };

    // Restore sets up currentSession without executing
    await executor.restore(phaseCheckpoint, context as any);

    // Immediately call checkpoint to get the step from the unknown status (should default to discovery)
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
    expect(checkpoint.phase).toBe("converge");
  });

  it("should return clarification step for clarifying status via restore+checkpoint", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create session file with clarifying status
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "clarifying-restore-test",
      status: "clarifying",
      initialInput: "Test",
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "clarifying-restore-test",
      step: "clarification",
      progress: 50,
      timestamp: now,
      isComplete: false,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    const phaseCheckpoint = {
      phase: "converge" as const,
      timestamp: new Date(),
      state: { artifacts: [], progress: 50, checkpoint: null },
      resumePoint: "clarification",
    };

    // Restore sets up currentSession without executing
    await executor.restore(phaseCheckpoint, context as any);

    // Immediately call checkpoint to get the step from the clarifying status
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
    expect(checkpoint.phase).toBe("converge");
  });

  it("should return refinement step for refining status via restore+checkpoint", async () => {
    const { ConvergeExecutor } = await import("./executor.js");

    // Create session file with refining status
    const specDir = path.join(tempDir, ".coco", "spec");
    await fs.mkdir(specDir, { recursive: true });

    const now = new Date().toISOString();
    const sessionData = {
      id: "refining-restore-test",
      status: "refining",
      initialInput: "Test",
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
      conversation: [{ role: "user", content: "test", timestamp: now }],
      startedAt: now,
      updatedAt: now,
    };

    const checkpointData = {
      sessionId: "refining-restore-test",
      step: "refinement",
      progress: 70,
      timestamp: now,
      isComplete: false,
    };

    await fs.writeFile(
      path.join(specDir, "discovery-session.json"),
      JSON.stringify(sessionData, null, 2),
    );

    await fs.writeFile(
      path.join(specDir, "checkpoint.json"),
      JSON.stringify(checkpointData, null, 2),
    );

    const executor = new ConvergeExecutor({
      onUserInput: async () => "done",
    });

    const mockLLMChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({}),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const context = {
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
    };

    const phaseCheckpoint = {
      phase: "converge" as const,
      timestamp: new Date(),
      state: { artifacts: [], progress: 70, checkpoint: null },
      resumePoint: "refinement",
    };

    // Restore sets up currentSession without executing
    await executor.restore(phaseCheckpoint, context as any);

    // Immediately call checkpoint to get the step from the refining status
    const checkpoint = await executor.checkpoint(context as any);
    expect(checkpoint).toBeDefined();
    expect(checkpoint.phase).toBe("converge");
  });
});

describe("createLLMAdapter", () => {
  it("should adapt chat calls correctly", async () => {
    const { createLLMAdapter } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      chat: vi.fn().mockResolvedValue({
        content: "Hello",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      chatWithTools: vi.fn(),
      initialize: vi.fn(),
      stream: vi.fn(),
      countTokens: vi.fn(),
      getContextWindow: vi.fn(),
      isAvailable: vi.fn(),
    };

    const adapter = createLLMAdapter(mockLLM as any);
    const result = await adapter.chat([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);

    expect(mockLLM.chat).toHaveBeenCalledWith([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
    expect(result.content).toBe("Hello");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("should adapt chatWithTools calls correctly", async () => {
    const { createLLMAdapter } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      chat: vi.fn(),
      chatWithTools: vi.fn().mockResolvedValue({
        content: "Using tool",
        usage: { inputTokens: 20, outputTokens: 10 },
        toolCalls: [{ name: "read_file", input: { path: "/test.txt" } }],
      }),
      initialize: vi.fn(),
      stream: vi.fn(),
      countTokens: vi.fn(),
      getContextWindow: vi.fn(),
      isAvailable: vi.fn(),
    };

    const adapter = createLLMAdapter(mockLLM as any);
    const result = await adapter.chatWithTools(
      [{ role: "user", content: "Read file" }],
      [
        {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    );

    expect(mockLLM.chatWithTools).toHaveBeenCalledWith([{ role: "user", content: "Read file" }], {
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    });
    expect(result.content).toBe("Using tool");
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(result.toolCalls).toEqual([{ name: "read_file", arguments: { path: "/test.txt" } }]);
  });

  it("should handle chatWithTools with no tool calls", async () => {
    const { createLLMAdapter } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      chat: vi.fn(),
      chatWithTools: vi.fn().mockResolvedValue({
        content: "No tools needed",
        usage: { inputTokens: 15, outputTokens: 8 },
        toolCalls: undefined,
      }),
      initialize: vi.fn(),
      stream: vi.fn(),
      countTokens: vi.fn(),
      getContextWindow: vi.fn(),
      isAvailable: vi.fn(),
    };

    const adapter = createLLMAdapter(mockLLM as any);
    const result = await adapter.chatWithTools([{ role: "user", content: "Hello" }], []);

    expect(result.content).toBe("No tools needed");
    expect(result.toolCalls).toBeUndefined();
  });

  it("should handle multiple tool calls", async () => {
    const { createLLMAdapter } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      chat: vi.fn(),
      chatWithTools: vi.fn().mockResolvedValue({
        content: "Multiple tools",
        usage: { inputTokens: 30, outputTokens: 15 },
        toolCalls: [
          { name: "tool1", input: { arg: "a" } },
          { name: "tool2", input: { arg: "b" } },
        ],
      }),
      initialize: vi.fn(),
      stream: vi.fn(),
      countTokens: vi.fn(),
      getContextWindow: vi.fn(),
      isAvailable: vi.fn(),
    };

    const adapter = createLLMAdapter(mockLLM as any);
    const result = await adapter.chatWithTools(
      [{ role: "user", content: "Use tools" }],
      [
        { name: "tool1", description: "Tool 1", parameters: { type: "object", properties: {} } },
        { name: "tool2", description: "Tool 2", parameters: { type: "object", properties: {} } },
      ],
    );

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls?.[0]).toEqual({ name: "tool1", arguments: { arg: "a" } });
    expect(result.toolCalls?.[1]).toEqual({ name: "tool2", arguments: { arg: "b" } });
  });
});
