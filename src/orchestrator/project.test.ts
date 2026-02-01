/**
 * Tests for project management
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs/promises with default export
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("createProjectStructure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create all required directories", async () => {
    const fs = await import("node:fs/promises");
    const { createProjectStructure } = await import("./project.js");

    await createProjectStructure("/test/project", {
      name: "test-project",
      description: "A test project",
      language: "typescript",
    });

    // Check that mkdir was called for all directories
    expect(fs.default.mkdir).toHaveBeenCalled();
    const calls = vi.mocked(fs.default.mkdir).mock.calls;

    const directories = calls.map((call) => call[0]);
    expect(directories.some((d) => String(d).includes(".coco"))).toBe(true);
    expect(directories.some((d) => String(d).includes("state"))).toBe(true);
    expect(directories.some((d) => String(d).includes("checkpoints"))).toBe(true);
    expect(directories.some((d) => String(d).includes("logs"))).toBe(true);
    expect(directories.some((d) => String(d).includes("architecture"))).toBe(true);
    expect(directories.some((d) => String(d).includes("planning"))).toBe(true);
  });

  it("should create config file", async () => {
    const fs = await import("node:fs/promises");
    const { createProjectStructure } = await import("./project.js");

    await createProjectStructure("/test/project", {
      name: "test-project",
      description: "A test project",
      language: "typescript",
      framework: "express",
    });

    const writeFileCalls = vi.mocked(fs.default.writeFile).mock.calls;
    const configCall = writeFileCalls.find((call) =>
      String(call[0]).includes("config.json")
    );

    expect(configCall).toBeDefined();

    const configContent = JSON.parse(String(configCall![1]));
    expect(configContent.project.name).toBe("test-project");
    expect(configContent.stack.language).toBe("typescript");
    expect(configContent.stack.framework).toBe("express");
  });

  it("should create project state file", async () => {
    const fs = await import("node:fs/promises");
    const { createProjectStructure } = await import("./project.js");

    await createProjectStructure("/test/project", {
      name: "test-project",
      description: "A test project",
      language: "typescript",
    });

    const writeFileCalls = vi.mocked(fs.default.writeFile).mock.calls;
    const stateCall = writeFileCalls.find((call) =>
      String(call[0]).includes("project.json")
    );

    expect(stateCall).toBeDefined();

    const stateContent = JSON.parse(String(stateCall![1]));
    expect(stateContent.name).toBe("test-project");
    expect(stateContent.currentPhase).toBe("idle");
    expect(stateContent.id).toBeDefined();
  });

  it("should create .gitignore file", async () => {
    const fs = await import("node:fs/promises");
    const { createProjectStructure } = await import("./project.js");

    await createProjectStructure("/test/project", {
      name: "test-project",
      description: "A test project",
      language: "typescript",
    });

    const writeFileCalls = vi.mocked(fs.default.writeFile).mock.calls;
    const gitignoreCall = writeFileCalls.find((call) =>
      String(call[0]).includes(".gitignore")
    );

    expect(gitignoreCall).toBeDefined();

    const gitignoreContent = String(gitignoreCall![1]);
    expect(gitignoreContent).toContain("config.json");
    expect(gitignoreContent).toContain("logs/");
    expect(gitignoreContent).toContain("checkpoints/");
  });

  it("should create README file", async () => {
    const fs = await import("node:fs/promises");
    const { createProjectStructure } = await import("./project.js");

    await createProjectStructure("/test/project", {
      name: "my-project",
      description: "My test project",
      language: "typescript",
    });

    const writeFileCalls = vi.mocked(fs.default.writeFile).mock.calls;
    const readmeCall = writeFileCalls.find((call) =>
      String(call[0]).includes("README.md")
    );

    expect(readmeCall).toBeDefined();

    const readmeContent = String(readmeCall![1]);
    expect(readmeContent).toContain("my-project");
    expect(readmeContent).toContain("coco status");
    expect(readmeContent).toContain("coco resume");
    expect(readmeContent).toContain("coco build");
  });

  it("should set default quality thresholds in config", async () => {
    const fs = await import("node:fs/promises");
    const { createProjectStructure } = await import("./project.js");

    await createProjectStructure("/test/project", {
      name: "test-project",
      description: "A test project",
      language: "typescript",
    });

    const writeFileCalls = vi.mocked(fs.default.writeFile).mock.calls;
    const configCall = writeFileCalls.find((call) =>
      String(call[0]).includes("config.json")
    );

    const configContent = JSON.parse(String(configCall![1]));
    expect(configContent.quality.minScore).toBe(85);
    expect(configContent.quality.minCoverage).toBe(80);
    expect(configContent.quality.maxIterations).toBe(10);
    expect(configContent.quality.convergenceThreshold).toBe(2);
  });

  it("should set default provider config", async () => {
    const fs = await import("node:fs/promises");
    const { createProjectStructure } = await import("./project.js");

    await createProjectStructure("/test/project", {
      name: "test-project",
      description: "A test project",
      language: "typescript",
    });

    const writeFileCalls = vi.mocked(fs.default.writeFile).mock.calls;
    const configCall = writeFileCalls.find((call) =>
      String(call[0]).includes("config.json")
    );

    const configContent = JSON.parse(String(configCall![1]));
    expect(configContent.provider.type).toBe("anthropic");
    expect(configContent.provider.model).toBe("claude-sonnet-4-20250514");
  });
});
