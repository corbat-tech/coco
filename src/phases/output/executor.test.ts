/**
 * Tests for OUTPUT phase executor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs/promises
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify({
  name: "test-project",
  description: "A test project",
  version: "1.0.0",
  author: "Test Author",
  license: "MIT",
  repository: { url: "https://github.com/test/test-project" },
  scripts: {
    test: "vitest",
    build: "tsup",
    start: "node dist/index.js",
  },
}));
const mockAccess = vi.fn();

vi.mock("node:fs/promises", async () => {
  return {
    default: {
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      readFile: mockReadFile,
      access: mockAccess,
    },
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    readFile: mockReadFile,
    access: mockAccess,
  };
});

describe("OutputExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: npm (no lock files)
    mockAccess.mockRejectedValue(new Error("Not found"));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("creation", () => {
    it("should create executor with default config", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor();

      expect(executor.name).toBe("output");
      expect(executor.description).toBeDefined();
    });

    it("should create executor with custom config", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        cicd: { provider: "github_actions", features: { tests: true } },
        docker: { enabled: true },
      });

      expect(executor.name).toBe("output");
    });

    it("should merge config deeply", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        cicd: { features: { deploy: true } },
        docker: { compose: true },
        docs: { api: false },
      });

      expect(executor.name).toBe("output");
    });
  });

  describe("canStart", () => {
    it("should return true", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor();
      const result = executor.canStart({} as any);

      expect(result).toBe(true);
    });
  });

  describe("canComplete", () => {
    it("should return true", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor();
      const result = executor.canComplete({} as any);

      expect(result).toBe(true);
    });
  });

  describe("checkpoint", () => {
    it("should create checkpoint with correct structure", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor();
      const checkpoint = await executor.checkpoint({} as any);

      expect(checkpoint.phase).toBe("output");
      expect(checkpoint.timestamp).toBeInstanceOf(Date);
      expect(checkpoint.resumePoint).toBe("start");
      expect(checkpoint.state).toEqual({
        artifacts: [],
        progress: 0,
        checkpoint: null,
      });
    });
  });

  describe("restore", () => {
    it("should restore from checkpoint without error", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor();
      const checkpoint = {
        phase: "output",
        timestamp: new Date(),
        state: { artifacts: [] },
        resumePoint: "start",
      };

      // Should not throw
      await expect(executor.restore(checkpoint as any, {} as any)).resolves.toBeUndefined();
    });
  });

  describe("execute", () => {
    it("should generate all CI/CD files", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        cicd: { provider: "github_actions" },
        docker: { enabled: false },
        docs: { readme: false, contributing: false, changelog: false, api: false },
      });

      const context = {
        projectPath: "/test/project",
        config: { project: { name: "test" } },
        llm: {},
        tools: {},
      };

      const result = await executor.execute(context as any);

      expect(result.phase).toBe("output");
      expect(result.success).toBe(true);
      expect(result.artifacts).toBeDefined();
      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should generate Docker files when enabled", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        docker: { enabled: true, compose: true },
        docs: { readme: false, contributing: false, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: { project: { name: "test" } },
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);

      // Should have Dockerfile, .dockerignore, and docker-compose.yml
      const dockerArtifacts = result.artifacts.filter(a => a.type === "deployment");
      expect(dockerArtifacts.length).toBeGreaterThanOrEqual(2);
    });

    it("should generate README when enabled", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: true, contributing: false, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
      const readmeArtifact = result.artifacts.find(a => a.path.includes("README.md"));
      expect(readmeArtifact).toBeDefined();
    });

    it("should generate CONTRIBUTING.md when enabled", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: false, contributing: true, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
      const contributingArtifact = result.artifacts.find(a => a.path.includes("CONTRIBUTING.md"));
      expect(contributingArtifact).toBeDefined();
    });

    it("should generate CHANGELOG.md when enabled", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: false, contributing: false, changelog: true, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
      const changelogArtifact = result.artifacts.find(a => a.path.includes("CHANGELOG.md"));
      expect(changelogArtifact).toBeDefined();
    });

    it("should generate API docs when enabled", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: false, contributing: false, changelog: false, api: true },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
      const apiArtifact = result.artifacts.find(a => a.path.includes("api.md"));
      expect(apiArtifact).toBeDefined();
    });

    it("should generate deployment docs when API docs enabled", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: false, contributing: false, changelog: false, api: true },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
      const deployArtifact = result.artifacts.find(a => a.path.includes("deployment.md"));
      expect(deployArtifact).toBeDefined();
    });

    it("should generate development docs when API docs enabled", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: false, contributing: false, changelog: false, api: true },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
      const devArtifact = result.artifacts.find(a => a.path.includes("development.md"));
      expect(devArtifact).toBeDefined();
    });

    it("should return metrics on success", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: true, contributing: false, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
      expect(result.metrics).toBeDefined();
      expect(result.metrics?.startTime).toBeInstanceOf(Date);
      expect(result.metrics?.endTime).toBeInstanceOf(Date);
      expect(result.metrics?.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.llmCalls).toBe(0);
      expect(result.metrics?.tokensUsed).toBe(0);
    });

    it("should handle errors gracefully", async () => {
      const { OutputExecutor } = await import("./executor.js");

      // Make readFile throw
      mockReadFile.mockRejectedValueOnce(new Error("File not found"));

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: true },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      // Should still succeed with defaults
      expect(result.phase).toBe("output");
      expect(result.success).toBe(true);
    });

    it("should handle writeFile errors", async () => {
      const { OutputExecutor } = await import("./executor.js");

      mockWriteFile.mockRejectedValueOnce(new Error("Write failed"));

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: true, contributing: false, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should detect pnpm package manager", async () => {
      const { OutputExecutor } = await import("./executor.js");

      // pnpm-lock.yaml exists
      mockAccess.mockImplementation((path: string) => {
        if (path.includes("pnpm-lock.yaml")) {
          return Promise.resolve();
        }
        return Promise.reject(new Error("Not found"));
      });

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: true, contributing: false, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
    });

    it("should detect yarn package manager", async () => {
      const { OutputExecutor } = await import("./executor.js");

      // yarn.lock exists but not pnpm-lock.yaml
      mockAccess.mockImplementation((path: string) => {
        if (path.includes("yarn.lock")) {
          return Promise.resolve();
        }
        return Promise.reject(new Error("Not found"));
      });

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: true, contributing: false, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
    });

    it("should handle repository as string in package.json", async () => {
      const { OutputExecutor } = await import("./executor.js");

      mockReadFile.mockResolvedValueOnce(JSON.stringify({
        name: "test-project",
        description: "Test",
        repository: "https://github.com/test/repo",
      }));

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: true, contributing: false, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
    });

    it("should use defaults when package.json is empty", async () => {
      const { OutputExecutor } = await import("./executor.js");

      mockReadFile.mockResolvedValueOnce("{}");

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: true, contributing: false, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
    });

    it("should generate gitlab CI files", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        cicd: { provider: "gitlab_ci" },
        docker: { enabled: false },
        docs: { readme: false, contributing: false, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);
      expect(result.artifacts.some(a => a.type === "cicd")).toBe(true);
    });

    it("should generate all documentation types", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        docker: { enabled: false },
        docs: { readme: true, contributing: true, changelog: true, api: true },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);

      const docArtifacts = result.artifacts.filter(a => a.type === "documentation");
      expect(docArtifacts.length).toBeGreaterThanOrEqual(5); // README, CONTRIBUTING, CHANGELOG, api, deployment, development
    });

    it("should generate docker files without compose", async () => {
      const { OutputExecutor } = await import("./executor.js");

      const executor = new OutputExecutor({
        docker: { enabled: true, compose: false },
        docs: { readme: false, contributing: false, changelog: false, api: false },
      });

      const result = await executor.execute({
        projectPath: "/test/project",
        config: {},
        llm: {},
        tools: {},
      } as any);

      expect(result.success).toBe(true);

      const dockerArtifacts = result.artifacts.filter(a => a.type === "deployment");
      // Should have Dockerfile and .dockerignore but NOT docker-compose.yml
      const hasCompose = dockerArtifacts.some(a => a.path.includes("docker-compose"));
      expect(hasCompose).toBe(false);
    });
  });
});

describe("createOutputExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create executor with default config", async () => {
    const { createOutputExecutor } = await import("./executor.js");

    const executor = createOutputExecutor();

    expect(executor).toBeDefined();
    expect(executor.name).toBe("output");
  });

  it("should create executor with custom config", async () => {
    const { createOutputExecutor } = await import("./executor.js");

    const executor = createOutputExecutor({
      cicd: { provider: "gitlab_ci" },
      docker: { enabled: false },
    });

    expect(executor).toBeDefined();
    expect(executor.name).toBe("output");
  });

  it("should create executor with all config options", async () => {
    const { createOutputExecutor } = await import("./executor.js");

    const executor = createOutputExecutor({
      cicd: {
        provider: "github_actions",
        features: {
          tests: true,
          lint: true,
          typecheck: true,
          build: true,
          security: true,
          codeql: true,
          dependabot: true,
          deploy: true,
        },
      },
      docker: {
        enabled: true,
        compose: true,
      },
      docs: {
        readme: true,
        contributing: true,
        changelog: true,
        api: true,
      },
      release: {
        enabled: true,
        semver: true,
      },
    });

    expect(executor).toBeDefined();
  });
});

describe("DEFAULT_OUTPUT_CONFIG", () => {
  it("should have expected default values", async () => {
    const { DEFAULT_OUTPUT_CONFIG } = await import("./executor.js");

    expect(DEFAULT_OUTPUT_CONFIG).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.cicd).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.cicd.provider).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.cicd.features).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.docker).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.docker.enabled).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.docs).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.docs.readme).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.docs.contributing).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.docs.changelog).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.docs.api).toBeDefined();
    expect(DEFAULT_OUTPUT_CONFIG.release).toBeDefined();
  });

  it("should have github_actions as default provider", async () => {
    const { DEFAULT_OUTPUT_CONFIG } = await import("./executor.js");

    expect(DEFAULT_OUTPUT_CONFIG.cicd.provider).toBe("github_actions");
  });

  it("should have docker enabled by default", async () => {
    const { DEFAULT_OUTPUT_CONFIG } = await import("./executor.js");

    expect(DEFAULT_OUTPUT_CONFIG.docker.enabled).toBe(true);
  });

  it("should have readme enabled by default", async () => {
    const { DEFAULT_OUTPUT_CONFIG } = await import("./executor.js");

    expect(DEFAULT_OUTPUT_CONFIG.docs.readme).toBe(true);
  });
});
