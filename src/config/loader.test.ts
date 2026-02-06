/**
 * Tests for configuration loader
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CONFIG_PATHS } from "./paths.js";
import {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  findConfigPath,
  configExists,
  getConfigValue,
  setConfigValue,
  mergeWithDefaults,
} from "./loader.js";
import { ConfigError } from "../utils/errors.js";

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
      quality: {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minIterations: 2,
        convergenceThreshold: 2,
        securityThreshold: 100,
      },
      persistence: {
        checkpointInterval: 300000,
        maxCheckpoints: 50,
        retentionDays: 7,
        compressOldCheckpoints: true,
      },
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
      "utf-8",
    );
  });

  it("should create parent directory if needed", async () => {
    // Use a valid config from createDefaultConfig
    const config = createDefaultConfig("test");

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);

    await saveConfig(config, "/new/path/.coco/config.json");

    expect(fs.default.mkdir).toHaveBeenCalledWith("/new/path/.coco", { recursive: true });
  });

  it("should format JSON with indentation", async () => {
    // Use a valid config from createDefaultConfig
    const config = createDefaultConfig("test");

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);

    await saveConfig(config, "/path/to/config.json");

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

  it("should use process.cwd() when cwd is not provided", async () => {
    const originalEnv = process.env.COCO_CONFIG_PATH;
    delete process.env.COCO_CONFIG_PATH;

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.access).mockResolvedValue(undefined);

    // Call without cwd - should use process.cwd()
    const path = await findConfigPath();

    expect(path).toContain(".coco");
    expect(path).toContain("config.json");

    process.env.COCO_CONFIG_PATH = originalEnv;
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

  it("should fall back to default if env path does not exist", async () => {
    const originalEnv = process.env.COCO_CONFIG_PATH;
    process.env.COCO_CONFIG_PATH = "/nonexistent/path/config.json";

    const fs = await import("node:fs/promises");
    // First call (env path) fails, second call (default path) succeeds
    vi.mocked(fs.default.access)
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(undefined);

    const path = await findConfigPath("/project");

    expect(path).toBe("/project/.coco/config.json");

    process.env.COCO_CONFIG_PATH = originalEnv;
  });
});

describe("loadConfig edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return default config when file does not exist (ENOENT)", async () => {
    const fs = await import("node:fs/promises");
    const error = new Error("ENOENT") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    vi.mocked(fs.default.readFile).mockRejectedValue(error);

    const config = await loadConfig("/nonexistent/config.json");

    expect(config.project.name).toBe("my-project");
  });

  it("should re-throw ConfigError without wrapping", async () => {
    const fs = await import("node:fs/promises");
    const invalidConfig = { project: { name: "" } }; // empty name is invalid
    vi.mocked(fs.default.readFile).mockResolvedValue(JSON.stringify(invalidConfig));

    await expect(loadConfig("/path/to/config.json")).rejects.toBeInstanceOf(ConfigError);
  });

  it("should wrap generic errors in ConfigError", async () => {
    const fs = await import("node:fs/promises");
    const error = new Error("Permission denied");
    vi.mocked(fs.default.readFile).mockRejectedValue(error);

    await expect(loadConfig("/path/to/config.json")).rejects.toBeInstanceOf(ConfigError);
    await expect(loadConfig("/path/to/config.json")).rejects.toThrow(
      "Failed to load configuration",
    );
  });

  it("should handle non-Error thrown values", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.readFile).mockRejectedValue("string error");

    await expect(loadConfig("/path/to/config.json")).rejects.toBeInstanceOf(ConfigError);
    await expect(loadConfig("/path/to/config.json")).rejects.toThrow(
      "Failed to load configuration",
    );
  });

  it("should load config with global fallback when project config not found", async () => {
    const globalConfig = {
      project: { name: "global-project" },
    };

    const fs = await import("node:fs/promises");
    // Global config exists, project config doesn't
    vi.mocked(fs.default.readFile).mockImplementation(async (path) => {
      if (String(path) === CONFIG_PATHS.config) {
        // Global config found
        return JSON.stringify(globalConfig);
      }
      // Project config not found
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });

    const config = await loadConfig();

    // Should merge global config into defaults
    expect(config.project.name).toBe("global-project");
  });

  it("should prioritize project config over global config", async () => {
    const globalConfig = {
      project: { name: "global-project" },
      provider: { type: "openai" },
    };
    const projectConfig = {
      project: { name: "project-name" },
    };

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.readFile).mockImplementation(async (path) => {
      const pathStr = String(path);
      // Global config is in home dir (~/.coco), project is in cwd
      const isGlobalPath = pathStr === CONFIG_PATHS.config;
      if (isGlobalPath) {
        return JSON.stringify(globalConfig);
      }
      // Project config (in cwd, contains WORKSPACE)
      return JSON.stringify(projectConfig);
    });

    const config = await loadConfig();

    // Project name should be from project config (higher priority)
    expect(config.project.name).toBe("project-name");
    // Provider should be from global config (merged)
    expect(config.provider.type).toBe("openai");
  });
});

describe("saveConfig edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should throw ConfigError for invalid config", async () => {
    const invalidConfig = {
      project: { name: "" }, // empty name is invalid
    } as any;

    await expect(saveConfig(invalidConfig, "/path/to/config.json")).rejects.toBeInstanceOf(
      ConfigError,
    );
    await expect(saveConfig(invalidConfig, "/path/to/config.json")).rejects.toThrow(
      "Cannot save invalid configuration",
    );
  });

  it("should throw ConfigError for invalid config with explicit path", async () => {
    const invalidConfig = {
      project: { name: "" }, // empty name is invalid
    } as any;

    // This tests the branch where configPath is provided to saveConfig and gets used in error
    try {
      await saveConfig(invalidConfig, "/explicit/path/config.json");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).context.configPath).toBe("/explicit/path/config.json");
    }
  });

  it("should use project path fallback for invalid config when no path provided", async () => {
    const invalidConfig = {
      project: { name: "" }, // empty name is invalid
    } as any;

    // This tests the fallback branch where configPath is undefined
    try {
      await saveConfig(invalidConfig);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      // Should use project config path as fallback
      expect((error as ConfigError).context.configPath).toContain(".coco/config.json");
    }
  });

  it("should save to project config by default", async () => {
    const config = createDefaultConfig("test");

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);

    await saveConfig(config);

    // Should save to project config path
    const calledPath = vi.mocked(fs.default.writeFile).mock.calls[0]?.[0] as string;
    expect(calledPath).toContain(".coco/config.json");
  });

  it("should save to global config when global flag is true", async () => {
    const config = createDefaultConfig("test");

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);

    await saveConfig(config, undefined, true);

    // Should save to global config path (~/.coco/config.json)
    const calledPath = vi.mocked(fs.default.writeFile).mock.calls[0]?.[0] as string;
    expect(calledPath).toContain(".coco/config.json");
    // Global path should be in home directory
    expect(calledPath).toMatch(/\.coco\/config\.json$/);
  });
});

describe("configExists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return true when config file exists", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.access).mockResolvedValue(undefined);

    const exists = await configExists("/path/to/config.json");

    expect(exists).toBe(true);
  });

  it("should return false when config file does not exist", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.access).mockRejectedValue(new Error("ENOENT"));

    const exists = await configExists("/nonexistent/config.json");

    expect(exists).toBe(false);
  });

  it("should check project config when scope is 'project'", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.access).mockResolvedValue(undefined);

    const exists = await configExists(undefined, "project");

    // Should check project config path
    const calledPath = vi.mocked(fs.default.access).mock.calls[0]?.[0] as string;
    expect(calledPath).toContain(".coco/config.json");
    expect(exists).toBe(true);
  });

  it("should check global config when scope is 'global'", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.access).mockResolvedValue(undefined);

    const exists = await configExists(undefined, "global");

    // Should check global config path
    const calledPath = vi.mocked(fs.default.access).mock.calls[0]?.[0] as string;
    expect(calledPath).toContain(".coco/config.json");
    expect(exists).toBe(true);
  });

  it("should use default path when COCO_CONFIG_PATH is not set", async () => {
    const originalEnv = process.env.COCO_CONFIG_PATH;
    delete process.env.COCO_CONFIG_PATH;

    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.access).mockResolvedValue(undefined);

    const exists = await configExists();

    // Should use process.cwd() + .coco/config.json
    expect(fs.default.access).toHaveBeenCalled();
    const calledPath = vi.mocked(fs.default.access).mock.calls[0]?.[0] as string;
    expect(calledPath).toContain(".coco");
    expect(calledPath).toContain("config.json");
    expect(exists).toBe(true);

    process.env.COCO_CONFIG_PATH = originalEnv;
  });
});

describe("getConfigValue", () => {
  it("should get top-level value", () => {
    const config = createDefaultConfig("test");
    const value = getConfigValue(config, "project");

    expect(value).toEqual({ name: "test", version: "0.1.0" });
  });

  it("should get deeply nested value", () => {
    const config = createDefaultConfig("test");
    const value = getConfigValue<string>(config, "provider.type");

    expect(value).toBe("anthropic");
  });

  it("should return undefined for non-existent path", () => {
    const config = createDefaultConfig("test");
    const value = getConfigValue(config, "nonexistent.deep.path");

    expect(value).toBeUndefined();
  });

  it("should return undefined when traversing through null", () => {
    const config = createDefaultConfig("test");
    (config as any).integrations = null;
    const value = getConfigValue(config, "integrations.github.token");

    expect(value).toBeUndefined();
  });

  it("should return undefined when traversing through non-object", () => {
    const config = createDefaultConfig("test");
    const value = getConfigValue(config, "project.name.invalid");

    expect(value).toBeUndefined();
  });
});

describe("setConfigValue", () => {
  it("should set top-level value", () => {
    const config = createDefaultConfig("test");
    const updated = setConfigValue(config, "project", { name: "new-name", version: "2.0.0" });

    expect(updated.project.name).toBe("new-name");
    expect(updated.project.version).toBe("2.0.0");
  });

  it("should set deeply nested value", () => {
    const config = createDefaultConfig("test");
    const updated = setConfigValue(config, "quality.minScore", 95);

    expect(updated.quality.minScore).toBe(95);
    // Original should not be modified
    expect(config.quality.minScore).toBe(85);
  });

  it("should create intermediate objects if needed", () => {
    const config = createDefaultConfig("test");
    const updated = setConfigValue(config, "integrations.github.token", "my-token");

    expect((updated.integrations as any).github.token).toBe("my-token");
  });

  it("should handle empty key parts gracefully", () => {
    const config = createDefaultConfig("test");
    // This tests the `if (!key) continue;` branch
    const updated = setConfigValue(config, "provider..type", "openai");

    expect(updated.provider.type).toBe("openai");
  });

  it("should replace non-object intermediate values with objects", () => {
    const config = createDefaultConfig("test");
    // Set a string value first
    (config as any).custom = "string-value";
    // Now try to set a nested path through it
    const updated = setConfigValue(config, "custom.nested.value", "test");

    expect((updated as any).custom.nested.value).toBe("test");
  });
});

describe("mergeWithDefaults", () => {
  it("should merge empty partial with defaults", () => {
    const merged = mergeWithDefaults({}, "my-project");

    expect(merged.project.name).toBe("my-project");
    expect(merged.provider.type).toBe("anthropic");
    expect(merged.quality.minScore).toBe(85);
  });

  it("should preserve partial project settings", () => {
    const partial = {
      project: { name: "custom-name", description: "A custom project" },
    };
    const merged = mergeWithDefaults(partial, "default-name");

    expect(merged.project.name).toBe("custom-name");
    expect(merged.project.description).toBe("A custom project");
  });

  it("should merge provider settings", () => {
    const partial = {
      provider: { model: "gpt-4" },
    };
    const merged = mergeWithDefaults(partial, "test");

    expect(merged.provider.model).toBe("gpt-4");
    expect(merged.provider.type).toBe("anthropic"); // default preserved
  });

  it("should merge quality settings", () => {
    const partial = {
      quality: { minScore: 90, maxIterations: 5 },
    };
    const merged = mergeWithDefaults(partial, "test");

    expect(merged.quality.minScore).toBe(90);
    expect(merged.quality.maxIterations).toBe(5);
    expect(merged.quality.minCoverage).toBe(80); // default preserved
  });

  it("should merge persistence settings", () => {
    const partial = {
      persistence: { retentionDays: 30 },
    };
    const merged = mergeWithDefaults(partial, "test");

    expect(merged.persistence.retentionDays).toBe(30);
    expect(merged.persistence.maxCheckpoints).toBe(50); // default preserved
  });
});
