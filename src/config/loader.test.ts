/**
 * Tests for configuration loader
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, saveConfig, createDefaultConfig, findConfigPath } from "./loader.js";

// Mock fs/promises with default export
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      access: vi.fn(),
      mkdir: vi.fn(),
    },
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
  };
});

// Mock path with default export
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return {
    ...actual,
    default: {
      join: (...args: string[]) => args.join("/"),
      dirname: (p: string) => p.substring(0, p.lastIndexOf("/")),
    },
    join: (...args: string[]) => args.join("/"),
    dirname: (p: string) => p.substring(0, p.lastIndexOf("/")),
  };
});

describe("loadConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should load valid config from file", async () => {
    const mockConfig = {
      project: { name: "test-project" },
      provider: { type: "anthropic" },
      quality: { minScore: 85 },
    };

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.readFile).mockResolvedValue(JSON.stringify(mockConfig));

    const config = await loadConfig("/path/to/.coco/config.json");

    expect(config.project.name).toBe("test-project");
    expect(config.provider.type).toBe("anthropic");
    expect(config.quality.minScore).toBe(85);
  });

  it("should throw error for invalid JSON", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.readFile).mockResolvedValue("{ invalid json }");

    await expect(loadConfig("/path/to/config.json")).rejects.toThrow();
  });

  it("should throw error for invalid schema", async () => {
    const invalidConfig = {
      project: {}, // missing name
    };

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.readFile).mockResolvedValue(JSON.stringify(invalidConfig));

    await expect(loadConfig("/path/to/config.json")).rejects.toThrow();
  });

  it("should support JSON5 format (comments, trailing commas)", async () => {
    const json5Config = `{
      // This is a comment
      "project": {
        "name": "test-project",
      }, // trailing comma
    }`;

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.readFile).mockResolvedValue(json5Config);

    const config = await loadConfig("/path/to/config.json");

    expect(config.project.name).toBe("test-project");
  });
});

describe("saveConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should save config to file", async () => {
    const config = {
      project: { name: "test-project", version: "0.1.0" },
      provider: { type: "anthropic" as const, model: "claude-sonnet-4-20250514" },
      quality: { minScore: 85, minCoverage: 80, maxIterations: 10, minIterations: 2, convergenceThreshold: 2, securityThreshold: 100 },
      persistence: { checkpointInterval: 300000, maxCheckpoints: 50, retentionDays: 7, compressOldCheckpoints: true },
      stack: { language: "typescript" },
      integrations: {},
    };

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);

    await saveConfig(config, "/path/to/.coco/config.json");

    expect(fs.default.writeFile).toHaveBeenCalledWith(
      "/path/to/.coco/config.json",
      expect.stringContaining('"name": "test-project"'),
      "utf-8"
    );
  });

  it("should create parent directory if needed", async () => {
    const config = {
      project: { name: "test" },
      provider: { type: "anthropic" as const },
      quality: { minScore: 85 },
    };

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);

    await saveConfig(config as any, "/new/path/.coco/config.json");

    expect(fs.default.mkdir).toHaveBeenCalledWith("/new/path/.coco", { recursive: true });
  });

  it("should format JSON with indentation", async () => {
    const config = {
      project: { name: "test" },
      provider: { type: "anthropic" as const },
      quality: {},
      persistence: {},
      stack: {},
      integrations: {},
    };

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);

    await saveConfig(config as any, "/path/to/config.json");

    const writtenContent = vi.mocked(fs.default.writeFile).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain("\n"); // Has newlines
    expect(writtenContent).toContain("  "); // Has indentation
  });
});

describe("createDefaultConfig", () => {
  it("should create config with project name", () => {
    const config = createDefaultConfig("my-project");

    expect(config.project.name).toBe("my-project");
    expect(config.project.version).toBe("0.1.0");
  });

  it("should set default provider to anthropic", () => {
    const config = createDefaultConfig("test");

    expect(config.provider.type).toBe("anthropic");
    expect(config.provider.model).toBe("claude-sonnet-4-20250514");
  });

  it("should set default quality thresholds", () => {
    const config = createDefaultConfig("test");

    expect(config.quality.minScore).toBe(85);
    expect(config.quality.minCoverage).toBe(80);
    expect(config.quality.maxIterations).toBe(10);
    expect(config.quality.convergenceThreshold).toBe(2);
  });

  it("should set default persistence settings", () => {
    const config = createDefaultConfig("test");

    expect(config.persistence.checkpointInterval).toBe(300000);
    expect(config.persistence.maxCheckpoints).toBe(50);
  });

  it("should use provided language", () => {
    const config = createDefaultConfig("test", "python");

    expect(config.stack.language).toBe("python");
  });

  it("should default to typescript if no language provided", () => {
    const config = createDefaultConfig("test");

    expect(config.stack.language).toBe("typescript");
  });
});

describe("findConfigPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should find config in current directory", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.access).mockResolvedValue(undefined);

    const path = await findConfigPath("/project");

    expect(path).toBe("/project/.coco/config.json");
  });

  it("should find config in given directory only", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.access).mockResolvedValue(undefined);

    const path = await findConfigPath("/project/src/deep");

    expect(path).toBe("/project/src/deep/.coco/config.json");
  });

  it("should return undefined if no config found", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.access).mockRejectedValue(new Error("ENOENT"));

    const path = await findConfigPath("/project");

    expect(path).toBeUndefined();
  });

  it("should use custom config path from env", async () => {
    const originalEnv = process.env.COCO_CONFIG_PATH;
    process.env.COCO_CONFIG_PATH = "/custom/path/config.json";

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.access).mockResolvedValue(undefined);

    const path = await findConfigPath("/project");

    expect(path).toBe("/custom/path/config.json");

    process.env.COCO_CONFIG_PATH = originalEnv;
  });
});
