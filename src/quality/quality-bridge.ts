/**
 * Quality Bridge
 *
 * Connects the project-level `.coco.config.json` (ProjectConfig) to the
 * quality analysis system, translating user-facing config fields into the
 * internal QualityThresholds, QualityWeights, and ConvergenceAnalyzer options.
 *
 * Usage:
 *   const projectConfig = await loadProjectConfig(projectPath);
 *   const thresholds = resolvedThresholds(projectConfig);
 *   const weights    = resolvedWeights(projectConfig);
 *   const convOpts   = resolvedConvergenceOptions(projectConfig);
 */

import type { ProjectConfig } from "../config/project-config.js";
import {
  DEFAULT_QUALITY_WEIGHTS,
  DEFAULT_QUALITY_THRESHOLDS,
  type QualityThresholds,
  type QualityWeights,
} from "./types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/** Options accepted by ConvergenceAnalyzer constructor */
export interface ConvergenceOptions {
  minScore: number;
  targetScore: number;
  maxIterations: number;
  stableDeltaThreshold: number;
}

/** Sensible defaults mirroring DEFAULT_QUALITY_THRESHOLDS */
export const DEFAULT_CONVERGENCE_OPTIONS: ConvergenceOptions = {
  minScore: DEFAULT_QUALITY_THRESHOLDS.minimum.overall,
  targetScore: DEFAULT_QUALITY_THRESHOLDS.target.overall,
  maxIterations: DEFAULT_QUALITY_THRESHOLDS.maxIterations,
  stableDeltaThreshold: DEFAULT_QUALITY_THRESHOLDS.convergenceThreshold,
};

// ──────────────────────────────────────────────────────────────────────────────
// Threshold resolution
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extract partial `QualityThresholds` overrides from a `ProjectConfig`.
 * Only fields explicitly set in `config.quality` are included.
 * Returns an empty object when there is nothing to override.
 */
export function thresholdsFromProjectConfig(config: ProjectConfig): Partial<QualityThresholds> {
  const q = config.quality;
  if (!q) return {};

  const result: Partial<QualityThresholds> = {};

  const hasMinimum =
    q.minScore !== undefined || q.minCoverage !== undefined || q.securityThreshold !== undefined;

  if (hasMinimum) {
    result.minimum = {
      overall: q.minScore ?? DEFAULT_QUALITY_THRESHOLDS.minimum.overall,
      testCoverage: q.minCoverage ?? DEFAULT_QUALITY_THRESHOLDS.minimum.testCoverage,
      security: q.securityThreshold ?? DEFAULT_QUALITY_THRESHOLDS.minimum.security,
    };
  }

  if (q.maxIterations !== undefined) {
    result.maxIterations = q.maxIterations;
    result.convergenceThreshold = DEFAULT_QUALITY_THRESHOLDS.convergenceThreshold;
  }

  return result;
}

/**
 * Merge partial threshold overrides onto a base set of thresholds.
 * `overrides.minimum` / `overrides.target` are shallow-merged into the base.
 */
export function mergeThresholds(
  base: QualityThresholds,
  overrides: Partial<QualityThresholds>,
): QualityThresholds {
  return {
    ...base,
    ...overrides,
    minimum: overrides.minimum ? { ...base.minimum, ...overrides.minimum } : base.minimum,
    target: overrides.target ? { ...base.target, ...overrides.target } : base.target,
  };
}

/**
 * Return the fully-resolved `QualityThresholds` for a project.
 * Starts from `DEFAULT_QUALITY_THRESHOLDS` and applies any overrides from
 * `projectConfig`. If `projectConfig` is `null`, returns the defaults.
 */
export function resolvedThresholds(projectConfig: ProjectConfig | null): QualityThresholds {
  if (!projectConfig) return DEFAULT_QUALITY_THRESHOLDS;
  return mergeThresholds(DEFAULT_QUALITY_THRESHOLDS, thresholdsFromProjectConfig(projectConfig));
}

// ──────────────────────────────────────────────────────────────────────────────
// Weight resolution
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build `QualityWeights` from a `ProjectConfig`.
 *
 * Only the dimensions listed in `config.quality.weights` are overridden;
 * all others keep their default proportional share.
 * The resulting weights are normalised so they sum to exactly 1.0.
 *
 * If the config specifies no weight overrides, `DEFAULT_QUALITY_WEIGHTS` is
 * returned as-is (no allocation needed).
 */
export function weightsFromProjectConfig(config: ProjectConfig): QualityWeights {
  const overrides = config.quality?.weights;
  if (!overrides || Object.keys(overrides).length === 0) {
    return DEFAULT_QUALITY_WEIGHTS;
  }

  const merged: QualityWeights = { ...DEFAULT_QUALITY_WEIGHTS, ...overrides };

  // Normalise so weights sum to 1.0
  const total = Object.values(merged).reduce((s, v) => s + v, 0);
  if (total === 0) return DEFAULT_QUALITY_WEIGHTS;

  return Object.fromEntries(
    Object.entries(merged).map(([k, v]) => [k, v / total]),
  ) as unknown as QualityWeights;
}

/**
 * Return the fully-resolved `QualityWeights` for a project.
 * Falls back to `DEFAULT_QUALITY_WEIGHTS` if `projectConfig` is `null`.
 */
export function resolvedWeights(projectConfig: ProjectConfig | null): QualityWeights {
  if (!projectConfig) return DEFAULT_QUALITY_WEIGHTS;
  return weightsFromProjectConfig(projectConfig);
}

// ──────────────────────────────────────────────────────────────────────────────
// Convergence options
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build `ConvergenceOptions` from a `ProjectConfig`.
 * Uses `minScore`, `maxIterations` from `config.quality` when available.
 */
export function convergenceOptionsFromProjectConfig(config: ProjectConfig): ConvergenceOptions {
  const q = config.quality;
  return {
    minScore: q?.minScore ?? DEFAULT_CONVERGENCE_OPTIONS.minScore,
    targetScore: DEFAULT_CONVERGENCE_OPTIONS.targetScore,
    maxIterations: q?.maxIterations ?? DEFAULT_CONVERGENCE_OPTIONS.maxIterations,
    stableDeltaThreshold: DEFAULT_CONVERGENCE_OPTIONS.stableDeltaThreshold,
  };
}

/**
 * Return the fully-resolved `ConvergenceOptions` for a project.
 * Falls back to `DEFAULT_CONVERGENCE_OPTIONS` if `projectConfig` is `null`.
 */
export function resolvedConvergenceOptions(
  projectConfig: ProjectConfig | null,
): ConvergenceOptions {
  if (!projectConfig) return DEFAULT_CONVERGENCE_OPTIONS;
  return convergenceOptionsFromProjectConfig(projectConfig);
}
