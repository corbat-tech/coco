/**
 * Tests for project-level configuration (.coco.config.json)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PROJECT_CONFIG_FILENAME,
  ProjectConfigSchema,
  getProjectConfigPath,
  projectConfigExists,
  loadProjectConfig,
  saveProjectConfig,
  mergeProjectConfigs,
  createDefaultProjectConfig,
  validateProjectConfig,
  type ProjectConfig,
} from "./project-config.js";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

async function writeTmpConfig(dir: string, data: unknown, filename = PROJECT_CONFIG_FILENAME) {
  await writeFile(join(dir, filename), JSON.stringify(data, null, 2));
}

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "coco-proj-cfg-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// getProjectConfigPath
// ──────────────────────────────────────────────────────────────────────────────

describe("getProjectConfigPath", () => {
  it("should return absolute path ending with .coco.config.json", () => {
    const path = getProjectConfigPath("/my/project");
    expect(path).toMatch(/\.coco\.config\.json$/);
    expect(path.startsWith("/")).toBe(true);
  });

  it("should resolve relative paths", () => {
    const path = getProjectConfigPath("./some/project");
    expect(path.startsWith("/")).toBe(true);
    expect(path).toContain("some/project");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// projectConfigExists
// ──────────────────────────────────────────────────────────────────────────────

describe("projectConfigExists", () => {
  it("should return false when file does not exist", async () => {
    const result = await projectConfigExists(tmpDir);
    expect(result).toBe(false);
  });

  it("should return true when .coco.config.json is present", async () => {
    await writeTmpConfig(tmpDir, { name: "test" });
    const result = await projectConfigExists(tmpDir);
    expect(result).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// loadProjectConfig
// ──────────────────────────────────────────────────────────────────────────────

describe("loadProjectConfig", () => {
  it("should return null when file does not exist", async () => {
    const config = await loadProjectConfig(tmpDir);
    expect(config).toBeNull();
  });

  it("should load a minimal valid config", async () => {
    await writeTmpConfig(tmpDir, { name: "my-project" });
    const config = await loadProjectConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config?.name).toBe("my-project");
  });

  it("should load a full config with all sections", async () => {
    const full: ProjectConfig = {
      name: "full-project",
      version: "2.0.0",
      description: "A full config",
      language: "typescript",
      quality: {
        minScore: 90,
        minCoverage: 85,
        maxIterations: 5,
        securityThreshold: 100,
        weights: { correctness: 0.2 },
        ignoreRules: ["react/missing-jsdoc"],
        ignoreFiles: ["**/generated/**"],
      },
      analyzers: {
        enabledLanguages: ["typescript"],
        react: { checkA11y: true, checkHooks: false },
        java: { minCoverage: 80, reportPath: "target/site/jacoco/jacoco.xml" },
      },
    };
    await writeTmpConfig(tmpDir, full);
    const loaded = await loadProjectConfig(tmpDir);
    expect(loaded?.name).toBe("full-project");
    expect(loaded?.quality?.minScore).toBe(90);
    expect(loaded?.quality?.ignoreRules).toContain("react/missing-jsdoc");
    expect(loaded?.analyzers?.react?.checkHooks).toBe(false);
    expect(loaded?.analyzers?.java?.reportPath).toBe("target/site/jacoco/jacoco.xml");
  });

  it("should throw on malformed JSON", async () => {
    await writeFile(join(tmpDir, PROJECT_CONFIG_FILENAME), "{ invalid json }");
    await expect(loadProjectConfig(tmpDir)).rejects.toThrow();
  });

  it("should throw on schema violations", async () => {
    await writeTmpConfig(tmpDir, { quality: { minScore: 999 } });
    await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/Invalid/);
  });

  it("should load and merge an extended base config", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "coco-base-"));
    try {
      // Write base config
      await writeTmpConfig(baseDir, {
        name: "base",
        quality: { minScore: 85, minCoverage: 80 },
      });

      // Write child config that extends base
      await writeTmpConfig(tmpDir, {
        name: "child",
        extend: join(baseDir, PROJECT_CONFIG_FILENAME),
        quality: { minScore: 90 }, // overrides base minScore
      });

      const config = await loadProjectConfig(tmpDir);
      expect(config?.name).toBe("child");
      expect(config?.quality?.minScore).toBe(90); // child wins
      expect(config?.quality?.minCoverage).toBe(80); // base value inherited
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("should throw when extended base config is missing", async () => {
    await writeTmpConfig(tmpDir, {
      name: "child",
      extend: "/nonexistent/path/.coco.config.json",
    });
    await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/Cannot extend/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// saveProjectConfig
// ──────────────────────────────────────────────────────────────────────────────

describe("saveProjectConfig", () => {
  it("should write a valid config as pretty JSON", async () => {
    const config = createDefaultProjectConfig("my-app", "typescript");
    await saveProjectConfig(config, tmpDir);

    const loaded = await loadProjectConfig(tmpDir);
    expect(loaded?.name).toBe("my-app");
    expect(loaded?.language).toBe("typescript");
    expect(loaded?.quality?.minScore).toBe(85);
  });

  it("should overwrite an existing config file", async () => {
    await writeTmpConfig(tmpDir, { name: "old" });
    await saveProjectConfig({ name: "new" }, tmpDir);

    const loaded = await loadProjectConfig(tmpDir);
    expect(loaded?.name).toBe("new");
  });

  it("should throw on invalid config", async () => {
    // minScore > 100 is invalid
    await expect(saveProjectConfig({ quality: { minScore: 200 } }, tmpDir)).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// mergeProjectConfigs
// ──────────────────────────────────────────────────────────────────────────────

describe("mergeProjectConfigs", () => {
  it("should override scalar fields from base", () => {
    const base: ProjectConfig = { name: "base", version: "1.0.0" };
    const override: ProjectConfig = { name: "child", language: "java" };
    const merged = mergeProjectConfigs(base, override);
    expect(merged.name).toBe("child");
    expect(merged.language).toBe("java");
    expect(merged.version).toBe("1.0.0"); // inherited from base
  });

  it("should merge quality scalars (override wins)", () => {
    const base: ProjectConfig = { quality: { minScore: 80, minCoverage: 70 } };
    const override: ProjectConfig = { quality: { minScore: 90 } };
    const merged = mergeProjectConfigs(base, override);
    expect(merged.quality?.minScore).toBe(90);
    expect(merged.quality?.minCoverage).toBe(70); // from base
  });

  it("should merge quality.weights (override wins per key)", () => {
    const base: ProjectConfig = { quality: { weights: { correctness: 0.2, security: 0.1 } } };
    const override: ProjectConfig = { quality: { weights: { security: 0.15 } } };
    const merged = mergeProjectConfigs(base, override);
    expect(merged.quality?.weights?.correctness).toBe(0.2);
    expect(merged.quality?.weights?.security).toBe(0.15);
  });

  it("should concatenate ignoreRules arrays from both configs", () => {
    const base: ProjectConfig = { quality: { ignoreRules: ["rule-a"] } };
    const override: ProjectConfig = { quality: { ignoreRules: ["rule-b"] } };
    const merged = mergeProjectConfigs(base, override);
    expect(merged.quality?.ignoreRules).toContain("rule-a");
    expect(merged.quality?.ignoreRules).toContain("rule-b");
  });

  it("should concatenate ignoreFiles arrays from both configs", () => {
    const base: ProjectConfig = { quality: { ignoreFiles: ["**/vendor/**"] } };
    const override: ProjectConfig = { quality: { ignoreFiles: ["**/generated/**"] } };
    const merged = mergeProjectConfigs(base, override);
    expect(merged.quality?.ignoreFiles).toHaveLength(2);
  });

  it("should merge analyzers.java (override wins per key)", () => {
    const base: ProjectConfig = {
      analyzers: { java: { minCoverage: 70, reportPath: "base.xml" } },
    };
    const override: ProjectConfig = { analyzers: { java: { minCoverage: 80 } } };
    const merged = mergeProjectConfigs(base, override);
    expect(merged.analyzers?.java?.minCoverage).toBe(80);
    expect(merged.analyzers?.java?.reportPath).toBe("base.xml"); // inherited
  });

  it("should merge analyzers.react (override wins per key)", () => {
    const base: ProjectConfig = { analyzers: { react: { checkA11y: true, checkHooks: true } } };
    const override: ProjectConfig = { analyzers: { react: { checkHooks: false } } };
    const merged = mergeProjectConfigs(base, override);
    expect(merged.analyzers?.react?.checkA11y).toBe(true);
    expect(merged.analyzers?.react?.checkHooks).toBe(false);
  });

  it("should handle both configs having no quality section", () => {
    const merged = mergeProjectConfigs({ name: "a" }, { name: "b" });
    expect(merged.quality).toBeUndefined();
  });

  it("should handle both configs having no analyzers section", () => {
    const merged = mergeProjectConfigs({ name: "a" }, { name: "b" });
    expect(merged.analyzers).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// createDefaultProjectConfig
// ──────────────────────────────────────────────────────────────────────────────

describe("createDefaultProjectConfig", () => {
  it("should create a config with the given name", () => {
    const config = createDefaultProjectConfig("cool-app");
    expect(config.name).toBe("cool-app");
  });

  it("should set sensible quality defaults", () => {
    const config = createDefaultProjectConfig("cool-app");
    expect(config.quality?.minScore).toBe(85);
    expect(config.quality?.minCoverage).toBe(80);
    expect(config.quality?.maxIterations).toBe(10);
    expect(config.quality?.securityThreshold).toBe(100);
  });

  it("should include language when provided", () => {
    const config = createDefaultProjectConfig("cool-app", "java");
    expect(config.language).toBe("java");
  });

  it("should not include language when omitted", () => {
    const config = createDefaultProjectConfig("cool-app");
    expect(config.language).toBeUndefined();
  });

  it("should produce a config that passes schema validation", () => {
    const config = createDefaultProjectConfig("cool-app", "typescript");
    expect(() => ProjectConfigSchema.parse(config)).not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// validateProjectConfig
// ──────────────────────────────────────────────────────────────────────────────

describe("validateProjectConfig", () => {
  it("should return success for a valid config", () => {
    const result = validateProjectConfig({ name: "valid", quality: { minScore: 85 } });
    expect(result.success).toBe(true);
  });

  it("should return success for an empty object", () => {
    const result = validateProjectConfig({});
    expect(result.success).toBe(true);
  });

  it("should return failure for minScore out of range", () => {
    const result = validateProjectConfig({ quality: { minScore: 150 } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("should return failure for minCoverage < 0", () => {
    const result = validateProjectConfig({ quality: { minCoverage: -5 } });
    expect(result.success).toBe(false);
  });

  it("should return failure for maxIterations < 1", () => {
    const result = validateProjectConfig({ quality: { maxIterations: 0 } });
    expect(result.success).toBe(false);
  });

  it("should return failure for non-object input", () => {
    const result = validateProjectConfig("not an object");
    expect(result.success).toBe(false);
  });

  it("should return failure for null input", () => {
    const result = validateProjectConfig(null);
    expect(result.success).toBe(false);
  });
});
