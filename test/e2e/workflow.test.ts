/**
 * End-to-end tests for Corbat-Coco workflow
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFs = {
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockImplementation(async (path: string) => {
    if (path.includes("package.json")) {
      return JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        devDependencies: { vitest: "^1.0.0", oxlint: "^0.1.0" },
      });
    }
    if (path.includes("config.json")) {
      return JSON.stringify({
        project: { name: "test-project" },
        provider: { type: "anthropic" },
        quality: { minScore: 85, minCoverage: 80 },
      });
    }
    if (path.includes("project.json")) {
      return JSON.stringify({
        id: "proj_test",
        currentPhase: "idle",
        phaseHistory: [],
      });
    }
    return "{}";
  }),
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({
    size: 1024,
    mtime: new Date(),
    isFile: () => true,
    isDirectory: () => false,
  }),
};

// Mock all external dependencies with default export
vi.mock("node:fs/promises", () => ({
  default: mockFs,
}));

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: "Success",
    stderr: "",
  }),
}));

describe("E2E: Orchestrator Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize orchestrator and transition through phases", async () => {
    const { createOrchestrator } = await import("../../src/orchestrator/orchestrator.js");

    const orchestrator = createOrchestrator({
      projectPath: "/test/project",
      provider: { type: "anthropic" },
    } as any);

    await orchestrator.initialize("/test/project");

    // Start should transition to converge
    await orchestrator.start();
    expect(orchestrator.getCurrentPhase()).toBe("converge");

    // Transition to orchestrate
    await orchestrator.transitionTo("orchestrate");
    expect(orchestrator.getCurrentPhase()).toBe("orchestrate");

    // Transition to complete
    await orchestrator.transitionTo("complete");
    expect(orchestrator.getCurrentPhase()).toBe("complete");

    // Transition to output
    await orchestrator.transitionTo("output");
    expect(orchestrator.getCurrentPhase()).toBe("output");
  });

  it("should track progress through phases", async () => {
    const { createOrchestrator } = await import("../../src/orchestrator/orchestrator.js");

    const orchestrator = createOrchestrator({
      projectPath: "/test/project",
      provider: { type: "anthropic" },
    } as any);

    await orchestrator.initialize("/test/project");
    await orchestrator.start();

    const progress = orchestrator.getProgress();

    expect(progress.phase).toBe("converge");
    expect(progress.overallProgress).toBeGreaterThanOrEqual(0);
    expect(progress.startedAt).toBeInstanceOf(Date);
  });

  it("should maintain state history", async () => {
    const { createOrchestrator } = await import("../../src/orchestrator/orchestrator.js");

    const orchestrator = createOrchestrator({
      projectPath: "/test/project",
      provider: { type: "anthropic" },
    } as any);

    await orchestrator.initialize("/test/project");
    await orchestrator.transitionTo("converge");
    await orchestrator.transitionTo("orchestrate");

    const state = orchestrator.getState();

    expect(state.phaseHistory.length).toBe(2);
    expect(state.phaseHistory[0]?.to).toBe("converge");
    expect(state.phaseHistory[1]?.to).toBe("orchestrate");
  });
});

describe("E2E: Tool Execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute bash commands", async () => {
    const { bashExecTool } = await import("../../src/tools/bash.js");

    const result = await bashExecTool.execute({
      command: "echo 'test'",
    });

    expect(result.exitCode).toBe(0);
    expect(result.duration).toBeGreaterThan(0);
  });

  it("should block dangerous commands", async () => {
    const { bashExecTool } = await import("../../src/tools/bash.js");

    await expect(
      bashExecTool.execute({ command: "rm -rf /" })
    ).rejects.toThrow(/dangerous/i);
  });
});

describe("E2E: Tool Registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should register and execute tools", async () => {
    const { createToolRegistry, defineTool } = await import("../../src/tools/registry.js");
    const { z } = await import("zod");

    const registry = createToolRegistry();

    const testTool = defineTool({
      name: "test_tool",
      description: "A test tool",
      category: "test" as const,
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => ({ output: input.toUpperCase() }),
    });

    registry.register(testTool);

    const result = await registry.execute("test_tool", { input: "hello" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ output: "HELLO" });
  });

  it("should get tool definitions for LLM", async () => {
    const { createToolRegistry, defineTool } = await import("../../src/tools/registry.js");
    const { z } = await import("zod");

    const registry = createToolRegistry();

    registry.register(
      defineTool({
        name: "llm_tool",
        description: "Tool for LLM",
        category: "test" as const,
        parameters: z.object({ query: z.string() }),
        execute: async () => ({}),
      })
    );

    const definitions = registry.getToolDefinitionsForLLM();

    expect(definitions.length).toBe(1);
    expect(definitions[0]?.name).toBe("llm_tool");
    expect(definitions[0]?.input_schema).toBeDefined();
  });
});

describe("E2E: Output Generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate CI/CD workflows", async () => {
    const { CICDGenerator, createDefaultCICDConfig } = await import(
      "../../src/phases/output/cicd.js"
    );

    const generator = new CICDGenerator(
      { name: "test-project", language: "typescript", packageManager: "pnpm" } as any,
      createDefaultCICDConfig()
    );

    const files = generator.generate();

    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.path.includes("ci.yml"))).toBe(true);
    expect(files.some((f) => f.content.includes("pnpm"))).toBe(true);
  });

  it("should generate Docker files", async () => {
    const { DockerGenerator } = await import("../../src/phases/output/docker.js");

    const generator = new DockerGenerator({
      name: "test-project",
      language: "typescript",
      packageManager: "pnpm",
    } as any);

    const dockerfile = generator.generateDockerfile();
    const compose = generator.generateDockerCompose();
    const dockerignore = generator.generateDockerignore();

    expect(dockerfile).toContain("FROM node");
    expect(compose).toContain("services:");
    expect(dockerignore).toContain("node_modules");
  });
});

describe("E2E: Error Handling", () => {
  it("should wrap errors with context", async () => {
    const { ToolError, PhaseError, ConfigError } = await import("../../src/utils/errors.js");

    const toolError = new ToolError("Tool failed", { tool: "test_tool" });
    expect(toolError.name).toBe("ToolError");
    expect(toolError.context.tool).toBe("test_tool");

    const phaseError = new PhaseError("Phase failed", { phase: "converge" });
    expect(phaseError.name).toBe("PhaseError");
    expect(phaseError.context.phase).toBe("converge");

    const configError = new ConfigError("Config invalid");
    expect(configError.name).toBe("ConfigError");
  });
});

describe("E2E: Async Utilities", () => {
  it("should retry failed operations", async () => {
    const { retry } = await import("../../src/utils/async.js");

    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Not yet");
      }
      return "success";
    };

    const result = await retry(fn, { maxAttempts: 5, initialDelay: 10 });

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("should run operations in parallel with concurrency", async () => {
    const { parallel } = await import("../../src/utils/async.js");

    const items = [1, 2, 3, 4, 5];
    const results = await parallel(
      items,
      async (item) => item * 2,
      2
    );

    expect(results).toEqual([2, 4, 6, 8, 10]);
  });
});
