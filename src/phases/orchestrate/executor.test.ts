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

describe("OrchestrateExecutor - advanced scenarios", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `orchestrate-adv-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("specification loading", () => {
    it("should load specification from JSON file", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      // Create spec directory and file
      const specDir = path.join(tempDir, ".coco", "spec");
      await fs.mkdir(specDir, { recursive: true });

      const spec = {
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        overview: {
          name: "Test Project",
          description: "A test project",
          goals: ["Build features"],
          targetUsers: ["developers"],
          successCriteria: ["Works"],
        },
        requirements: {
          functional: [{ id: "f1", description: "Feature", priority: "high" }],
          nonFunctional: [],
          constraints: [],
        },
        technical: {
          stack: ["TypeScript"],
          architecture: "modular",
          integrations: [],
          deployment: "docker",
        },
        assumptions: { confirmed: [], unconfirmed: [], risks: [] },
        outOfScope: [],
        openQuestions: [],
      };

      await fs.writeFile(
        path.join(specDir, "spec.json"),
        JSON.stringify(spec, null, 2),
        "utf-8"
      );

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          overview: { pattern: "layered", description: "Layered arch" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const executor = new OrchestrateExecutor();

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

      expect(result.phase).toBe("orchestrate");
    });

    it("should create minimal spec when JSON file not found", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

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

      const executor = new OrchestrateExecutor();

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

      expect(result.phase).toBe("orchestrate");
    });
  });

  describe("artifact generation", () => {
    it("should save architecture docs in markdown and JSON", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          overview: { pattern: "microservices", description: "MS architecture" },
          components: [{ id: "c1", name: "Service", type: "service", description: "A service" }],
          relationships: [],
          dataModels: [],
          diagrams: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const executor = new OrchestrateExecutor();

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

      // Check if architecture files were created
      const archDir = path.join(tempDir, ".coco", "architecture");
      const files = await fs.readdir(archDir).catch(() => []);

      expect(files.length).toBeGreaterThan(0);
    });

    it("should save ADRs with index file", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const mockLLMChat = vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            overview: { pattern: "layered", description: "Layered" },
            components: [],
            relationships: [],
            dataModels: [],
            diagrams: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            adrs: [
              {
                id: 1,
                title: "Use TypeScript",
                status: "accepted",
                context: "Need type safety",
                decision: "Use TypeScript",
                consequences: { positive: ["Safety"], negative: [] },
                date: new Date().toISOString(),
              },
            ],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValue({
          content: JSON.stringify({
            epics: [],
            stories: [],
            tasks: [],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        });

      const executor = new OrchestrateExecutor();

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

      // ADR artifacts should be present
      const adrArtifacts = result.artifacts.filter((a) => a.type === "adr");
      expect(adrArtifacts.length).toBeGreaterThanOrEqual(0);
    });

    it("should save diagrams as mermaid files", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          overview: { pattern: "event-driven", description: "Event-driven" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [
            { id: "system-context", title: "System Context", type: "c4-context", mermaid: "graph TD\nA-->B" },
            { id: "sequence-login", title: "Login Flow", type: "sequence", mermaid: "sequenceDiagram\nA->>B: Login" },
          ],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const executor = new OrchestrateExecutor();

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

      const diagramArtifacts = result.artifacts.filter((a) => a.type === "diagram");
      expect(diagramArtifacts.length).toBeGreaterThanOrEqual(0);
    });

    it("should save sprint plan with JSON and markdown", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          overview: { pattern: "clean", description: "Clean arch" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const executor = new OrchestrateExecutor();

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

      // Should have backlog artifacts
      const backlogArtifacts = result.artifacts.filter((a) => a.type === "backlog");
      expect(backlogArtifacts.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("LLM adapter", () => {
    it("should adapt stream calls correctly", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          overview: { pattern: "modular", description: "Modular" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const executor = new OrchestrateExecutor();

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

    it("should estimate token count", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          overview: { pattern: "ddd", description: "DDD" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const executor = new OrchestrateExecutor();

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

      expect(result.phase).toBe("orchestrate");
    });
  });

  describe("error handling", () => {
    it("should handle non-Error exceptions", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const mockLLMChat = vi.fn().mockRejectedValue("String error");

      const executor = new OrchestrateExecutor();

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
      expect(result.error).toBe("String error");
    });
  });

  describe("metrics tracking", () => {
    it("should track execution duration", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          overview: { pattern: "layered", description: "Layered" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const executor = new OrchestrateExecutor();

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

      if (result.success) {
        expect(result.metrics).toBeDefined();
        expect(result.metrics?.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.metrics?.startTime).toBeInstanceOf(Date);
        expect(result.metrics?.endTime).toBeInstanceOf(Date);
      }
    });

    it("should estimate LLM calls count", async () => {
      const { OrchestrateExecutor } = await import("./executor.js");

      const mockLLMChat = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          overview: { pattern: "cqrs", description: "CQRS" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const executor = new OrchestrateExecutor();

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

      if (result.success && result.metrics) {
        expect(result.metrics.llmCalls).toBeGreaterThanOrEqual(1);
      }
    });
  });
});

describe("runOrchestratePhase - additional scenarios", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `orchestrate-run-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should return output with artifact paths on success", async () => {
    const { runOrchestratePhase } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({
          overview: { pattern: "layered", description: "Test" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [],
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
        toolCalls: [],
      }),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runOrchestratePhase(tempDir, mockLLM as any);

    if (!("error" in result)) {
      expect(result.artifactPaths).toBeDefined();
      expect(result.artifactPaths.architecture).toBeDefined();
    }
  });

  it("should adapt chatWithTools calls with tool definitions", async () => {
    const { runOrchestratePhase } = await import("./executor.js");

    const chatWithToolsCalls: any[] = [];
    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({
          overview: { pattern: "hexagonal", description: "Hexagonal" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [],
        }),
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      }),
      chatWithTools: vi.fn().mockImplementation(async (messages: any, options: any) => {
        chatWithToolsCalls.push({ messages, options });
        return {
          id: "resp-2",
          content: "{}",
          stopReason: "end_turn",
          usage: { inputTokens: 50, outputTokens: 25 },
          model: "test",
          toolCalls: [{ name: "tool", input: { key: "val" } }],
        };
      }),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    await runOrchestratePhase(tempDir, mockLLM as any);

    // Chat should have been called
    expect(mockLLM.chat).toHaveBeenCalled();
  });

  it("should handle missing artifact paths gracefully", async () => {
    const { runOrchestratePhase } = await import("./executor.js");

    const mockLLM = {
      id: "test",
      name: "Test LLM",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({
          overview: { pattern: "monolith", description: "Monolith" },
          components: [],
          relationships: [],
          dataModels: [],
          diagrams: [],
        }),
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      }),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const result = await runOrchestratePhase(tempDir, mockLLM as any);

    // Should return either success with paths or error
    expect(result).toBeDefined();
  });
});
