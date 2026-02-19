/**
 * Project-level configuration — `.coco.config.json`
 *
 * A lightweight config file meant to be committed to version control alongside
 * the project. It lets teams declare quality thresholds, language hints, and
 * analyzer options without touching the internal `.coco/config.json`.
 *
 * Resolution order (highest wins):
 *   CLI flags > .coco/config.json > .coco.config.json > built-in defaults
 *
 * Supports config inheritance via the `extend` field:
 *   { "extend": "../base/.coco.config.json", "quality": { "minScore": 90 } }
 */

import { z } from "zod";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** Filename at project root */
export const PROJECT_CONFIG_FILENAME = ".coco.config.json";

// ──────────────────────────────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Per-dimension weight overrides. Partial — only supply what you want to change.
 * Note: coco normalises weights at runtime so they don't need to sum to 1.
 */
const QualityWeightsOverrideSchema = z
  .object({
    correctness: z.number().min(0).max(1),
    completeness: z.number().min(0).max(1),
    robustness: z.number().min(0).max(1),
    readability: z.number().min(0).max(1),
    maintainability: z.number().min(0).max(1),
    complexity: z.number().min(0).max(1),
    duplication: z.number().min(0).max(1),
    testCoverage: z.number().min(0).max(1),
    testQuality: z.number().min(0).max(1),
    security: z.number().min(0).max(1),
    documentation: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
  })
  .partial();

/** Quality threshold and analysis overrides for this project */
const ProjectQualityOverridesSchema = z.object({
  /** Minimum overall score (0–100). Default: 85 */
  minScore: z.number().min(0).max(100).optional(),
  /** Minimum test-coverage percentage (0–100). Default: 80 */
  minCoverage: z.number().min(0).max(100).optional(),
  /** Maximum convergence iterations. Default: 10 */
  maxIterations: z.number().min(1).max(50).optional(),
  /** Required security score (0–100). Default: 100 */
  securityThreshold: z.number().min(0).max(100).optional(),
  /** Per-dimension weight overrides */
  weights: QualityWeightsOverrideSchema.optional(),
  /** Stored but not yet enforced by analyzers — reserved for a future release. */
  ignoreRules: z.array(z.string()).optional(),
  /** Stored but not yet enforced by analyzers — reserved for a future release. */
  ignoreFiles: z.array(z.string()).optional(),
});

/** Language-specific analyzer settings */
const ProjectAnalyzersConfigSchema = z.object({
  /** Restrict analysis to these language IDs (default: auto-detect) */
  enabledLanguages: z.array(z.string()).optional(),

  /** Java-specific options */
  java: z
    .object({
      /** Minimum line coverage expected from JaCoCo report */
      minCoverage: z.number().min(0).max(100).optional(),
      /** Custom path to jacoco.xml relative to project root */
      reportPath: z.string().optional(),
    })
    .optional(),

  /** React-specific options */
  react: z
    .object({
      /** Run accessibility (a11y) checks. Default: true */
      checkA11y: z.boolean().optional(),
      /** Enforce React Rules of Hooks. Default: true */
      checkHooks: z.boolean().optional(),
      /** Run component-quality checks. Default: true */
      checkComponents: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Full schema for `.coco.config.json`.
 * All fields are optional — only set what you need to override.
 */
export const ProjectConfigSchema = z.object({
  /** Human-readable project name */
  name: z.string().optional(),
  /** SemVer string for the config schema itself */
  version: z.string().optional(),
  /** Short project description */
  description: z.string().optional(),
  /**
   * Primary project language ID.
   * Used when auto-detection is ambiguous.
   * @example "typescript" | "java" | "react-typescript"
   */
  language: z.string().optional(),
  /** Quality threshold and weight overrides */
  quality: ProjectQualityOverridesSchema.optional(),
  /** Analyzer-specific settings */
  analyzers: ProjectAnalyzersConfigSchema.optional(),
  /**
   * Path to a base config to inherit from (relative to this file).
   * Merged shallowly; this file wins on conflicts.
   * @note extend is resolved only one level deep — chaining (A extends B extends C) is not supported.
   * @example "../shared/.coco.config.json"
   */
  extend: z.string().optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ProjectQualityOverrides = z.infer<typeof ProjectQualityOverridesSchema>;
export type ProjectAnalyzersConfig = z.infer<typeof ProjectAnalyzersConfigSchema>;
export type QualityWeightsOverride = z.infer<typeof QualityWeightsOverrideSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Path helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns the absolute path to `.coco.config.json` for the given project root.
 */
export function getProjectConfigPath(projectPath: string): string {
  return join(resolve(projectPath), PROJECT_CONFIG_FILENAME);
}

/**
 * Returns `true` if `.coco.config.json` exists at the given project root.
 */
export async function projectConfigExists(projectPath: string): Promise<boolean> {
  try {
    await access(getProjectConfigPath(projectPath));
    return true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Load / Save
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Load and validate `.coco.config.json` from the given project root.
 *
 * - Returns `null` when the file does not exist.
 * - Throws on JSON parse errors or schema validation failures.
 * - If the config has an `extend` field, the base config is loaded and merged
 *   (this config's values take precedence).
 */
export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig | null> {
  const configPath = getProjectConfigPath(projectPath);

  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const parsed = JSON.parse(raw) as unknown;
  const result = ProjectConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid ${PROJECT_CONFIG_FILENAME} at ${configPath}: ${result.error.message}`);
  }

  let config = result.data;

  // Resolve `extend` inheritance
  if (config.extend) {
    const basePath = resolve(dirname(configPath), config.extend);
    let baseRaw: string;
    try {
      baseRaw = await readFile(basePath, "utf-8");
    } catch (err) {
      throw new Error(
        `Cannot extend "${config.extend}" — file not found at ${basePath}: ${String(err)}`,
      );
    }

    const baseResult = ProjectConfigSchema.safeParse(JSON.parse(baseRaw) as unknown);
    if (!baseResult.success) {
      throw new Error(
        `Invalid base config at "${config.extend}" (resolved to ${basePath}): ${baseResult.error.message}`,
      );
    }
    config = mergeProjectConfigs(baseResult.data, config);
  }

  return config;
}

/**
 * Validate and write a `ProjectConfig` as `.coco.config.json` at the given
 * project root. The file is created if it does not exist.
 */
export async function saveProjectConfig(config: ProjectConfig, projectPath: string): Promise<void> {
  const validated = ProjectConfigSchema.parse(config);
  const configPath = getProjectConfigPath(projectPath);
  await writeFile(configPath, JSON.stringify(validated, null, 2) + "\n", "utf-8");
}

// ──────────────────────────────────────────────────────────────────────────────
// Merge / Defaults / Validate
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Deep-merge two `ProjectConfig` objects.
 * `override` wins on scalar conflicts; arrays are concatenated; objects are
 * spread (override wins per key).
 */
export function mergeProjectConfigs(base: ProjectConfig, override: ProjectConfig): ProjectConfig {
  const hasQuality = base.quality !== undefined || override.quality !== undefined;
  const hasAnalyzers = base.analyzers !== undefined || override.analyzers !== undefined;

  return {
    ...base,
    ...override,

    quality: hasQuality
      ? {
          ...base.quality,
          ...override.quality,
          weights:
            base.quality?.weights !== undefined || override.quality?.weights !== undefined
              ? { ...base.quality?.weights, ...override.quality?.weights }
              : undefined,
          ignoreRules: [
            ...(base.quality?.ignoreRules ?? []),
            ...(override.quality?.ignoreRules ?? []),
          ],
          ignoreFiles: [
            ...(base.quality?.ignoreFiles ?? []),
            ...(override.quality?.ignoreFiles ?? []),
          ],
        }
      : undefined,

    analyzers: hasAnalyzers
      ? {
          ...base.analyzers,
          ...override.analyzers,
          java:
            base.analyzers?.java !== undefined || override.analyzers?.java !== undefined
              ? { ...base.analyzers?.java, ...override.analyzers?.java }
              : undefined,
          react:
            base.analyzers?.react !== undefined || override.analyzers?.react !== undefined
              ? { ...base.analyzers?.react, ...override.analyzers?.react }
              : undefined,
        }
      : undefined,
  };
}

/**
 * Build a sensible default `ProjectConfig` for a new project.
 */
export function createDefaultProjectConfig(name: string, language?: string): ProjectConfig {
  return {
    name,
    version: "1.0.0",
    ...(language !== undefined ? { language } : {}),
    quality: {
      minScore: 85,
      minCoverage: 80,
      maxIterations: 10,
      securityThreshold: 100,
    },
  };
}

/**
 * Validate an unknown value against `ProjectConfigSchema`.
 * Returns a discriminated union — no exceptions are thrown.
 */
export function validateProjectConfig(
  config: unknown,
): { success: true; data: ProjectConfig } | { success: false; error: string } {
  const result = ProjectConfigSchema.safeParse(config);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error.message };
}
