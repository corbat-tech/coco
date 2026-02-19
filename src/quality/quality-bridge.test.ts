/**
 * Tests for Quality Bridge
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONVERGENCE_OPTIONS,
  thresholdsFromProjectConfig,
  mergeThresholds,
  resolvedThresholds,
  weightsFromProjectConfig,
  resolvedWeights,
  convergenceOptionsFromProjectConfig,
  resolvedConvergenceOptions,
} from "./quality-bridge.js";
import { DEFAULT_QUALITY_THRESHOLDS, DEFAULT_QUALITY_WEIGHTS } from "./types.js";
import type { ProjectConfig } from "../config/project-config.js";

// ──────────────────────────────────────────────────────────────────────────────
// thresholdsFromProjectConfig
// ──────────────────────────────────────────────────────────────────────────────

describe("thresholdsFromProjectConfig", () => {
  it("should return empty object for config with no quality section", () => {
    const result = thresholdsFromProjectConfig({ name: "test" });
    expect(result).toEqual({});
  });

  it("should return empty object for config with empty quality section", () => {
    const result = thresholdsFromProjectConfig({ quality: {} });
    expect(result).toEqual({});
  });

  it("should override minimum.overall when minScore is set", () => {
    const result = thresholdsFromProjectConfig({ quality: { minScore: 90 } });
    expect(result.minimum?.overall).toBe(90);
  });

  it("should override minimum.testCoverage when minCoverage is set", () => {
    const result = thresholdsFromProjectConfig({ quality: { minCoverage: 85 } });
    expect(result.minimum?.testCoverage).toBe(85);
  });

  it("should override minimum.security when securityThreshold is set", () => {
    const result = thresholdsFromProjectConfig({ quality: { securityThreshold: 95 } });
    expect(result.minimum?.security).toBe(95);
  });

  it("should use defaults for unspecified minimum fields when any minimum field is set", () => {
    const result = thresholdsFromProjectConfig({ quality: { minScore: 90 } });
    // testCoverage and security should fall back to defaults
    expect(result.minimum?.testCoverage).toBe(DEFAULT_QUALITY_THRESHOLDS.minimum.testCoverage);
    expect(result.minimum?.security).toBe(DEFAULT_QUALITY_THRESHOLDS.minimum.security);
  });

  it("should override maxIterations when set", () => {
    const result = thresholdsFromProjectConfig({ quality: { maxIterations: 5 } });
    expect(result.maxIterations).toBe(5);
  });

  it("should not include minimum when only maxIterations is set", () => {
    const result = thresholdsFromProjectConfig({ quality: { maxIterations: 5 } });
    expect(result.minimum).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// mergeThresholds
// ──────────────────────────────────────────────────────────────────────────────

describe("mergeThresholds", () => {
  it("should return base when overrides is empty", () => {
    const result = mergeThresholds(DEFAULT_QUALITY_THRESHOLDS, {});
    expect(result).toEqual(DEFAULT_QUALITY_THRESHOLDS);
  });

  it("should override minimum fields while preserving others", () => {
    const result = mergeThresholds(DEFAULT_QUALITY_THRESHOLDS, {
      minimum: { overall: 90, testCoverage: 85, security: 100 },
    });
    expect(result.minimum.overall).toBe(90);
    expect(result.minimum.testCoverage).toBe(85);
    expect(result.maxIterations).toBe(DEFAULT_QUALITY_THRESHOLDS.maxIterations);
  });

  it("should override maxIterations without touching minimum", () => {
    const result = mergeThresholds(DEFAULT_QUALITY_THRESHOLDS, { maxIterations: 3 });
    expect(result.maxIterations).toBe(3);
    expect(result.minimum).toEqual(DEFAULT_QUALITY_THRESHOLDS.minimum);
  });

  it("should merge target overrides", () => {
    const result = mergeThresholds(DEFAULT_QUALITY_THRESHOLDS, {
      target: { overall: 98, testCoverage: 95 },
    });
    expect(result.target.overall).toBe(98);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// resolvedThresholds
// ──────────────────────────────────────────────────────────────────────────────

describe("resolvedThresholds", () => {
  it("should return defaults when projectConfig is null", () => {
    const result = resolvedThresholds(null);
    expect(result).toEqual(DEFAULT_QUALITY_THRESHOLDS);
  });

  it("should apply overrides from projectConfig", () => {
    const config: ProjectConfig = { quality: { minScore: 92, maxIterations: 7 } };
    const result = resolvedThresholds(config);
    expect(result.minimum.overall).toBe(92);
    expect(result.maxIterations).toBe(7);
  });

  it("should preserve unoverridden defaults", () => {
    const config: ProjectConfig = { quality: { minScore: 90 } };
    const result = resolvedThresholds(config);
    expect(result.minimum.security).toBe(DEFAULT_QUALITY_THRESHOLDS.minimum.security);
    expect(result.target).toEqual(DEFAULT_QUALITY_THRESHOLDS.target);
    expect(result.minIterations).toBe(DEFAULT_QUALITY_THRESHOLDS.minIterations);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// weightsFromProjectConfig
// ──────────────────────────────────────────────────────────────────────────────

describe("weightsFromProjectConfig", () => {
  it("should return default weights when no weight overrides", () => {
    const result = weightsFromProjectConfig({ name: "test" });
    expect(result).toEqual(DEFAULT_QUALITY_WEIGHTS);
  });

  it("should return default weights when quality.weights is empty", () => {
    const result = weightsFromProjectConfig({ quality: { weights: {} } });
    expect(result).toEqual(DEFAULT_QUALITY_WEIGHTS);
  });

  it("should override specified dimension weight", () => {
    const result = weightsFromProjectConfig({
      quality: { weights: { security: 0.5 } },
    });
    // security weight should be higher than the default 0.08
    expect(result.security).toBeGreaterThan(DEFAULT_QUALITY_WEIGHTS.security);
  });

  it("should normalise weights to sum to 1.0", () => {
    const result = weightsFromProjectConfig({
      quality: { weights: { correctness: 0.5, security: 0.5 } },
    });
    const total = Object.values(result).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it("should not change relative proportions of unoverridden dimensions", () => {
    const result = weightsFromProjectConfig({
      quality: { weights: { correctness: 0.3 } },
    });
    // completeness and robustness have equal default weights, so their ratio should stay 1
    const ratio = result.completeness / result.robustness;
    expect(ratio).toBeCloseTo(1.0, 5);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// resolvedWeights
// ──────────────────────────────────────────────────────────────────────────────

describe("resolvedWeights", () => {
  it("should return defaults when projectConfig is null", () => {
    const result = resolvedWeights(null);
    expect(result).toEqual(DEFAULT_QUALITY_WEIGHTS);
  });

  it("should apply weight overrides from projectConfig", () => {
    const config: ProjectConfig = { quality: { weights: { security: 0.3 } } };
    const result = resolvedWeights(config);
    expect(result.security).toBeGreaterThan(DEFAULT_QUALITY_WEIGHTS.security);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// convergenceOptionsFromProjectConfig
// ──────────────────────────────────────────────────────────────────────────────

describe("convergenceOptionsFromProjectConfig", () => {
  it("should use defaults when quality section is absent", () => {
    const result = convergenceOptionsFromProjectConfig({ name: "test" });
    expect(result.minScore).toBe(DEFAULT_CONVERGENCE_OPTIONS.minScore);
    expect(result.maxIterations).toBe(DEFAULT_CONVERGENCE_OPTIONS.maxIterations);
    expect(result.targetScore).toBe(DEFAULT_CONVERGENCE_OPTIONS.targetScore);
  });

  it("should override minScore from config", () => {
    const result = convergenceOptionsFromProjectConfig({ quality: { minScore: 92 } });
    expect(result.minScore).toBe(92);
  });

  it("should override maxIterations from config", () => {
    const result = convergenceOptionsFromProjectConfig({ quality: { maxIterations: 6 } });
    expect(result.maxIterations).toBe(6);
  });

  it("should preserve targetScore regardless of minScore override", () => {
    const result = convergenceOptionsFromProjectConfig({ quality: { minScore: 90 } });
    expect(result.targetScore).toBe(DEFAULT_CONVERGENCE_OPTIONS.targetScore);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// resolvedConvergenceOptions
// ──────────────────────────────────────────────────────────────────────────────

describe("resolvedConvergenceOptions", () => {
  it("should return defaults when projectConfig is null", () => {
    const result = resolvedConvergenceOptions(null);
    expect(result).toEqual(DEFAULT_CONVERGENCE_OPTIONS);
  });

  it("should apply overrides from projectConfig", () => {
    const config: ProjectConfig = { quality: { minScore: 88, maxIterations: 4 } };
    const result = resolvedConvergenceOptions(config);
    expect(result.minScore).toBe(88);
    expect(result.maxIterations).toBe(4);
  });
});
