/**
 * Tests for quality system types and utilities
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_QUALITY_WEIGHTS,
  DEFAULT_QUALITY_THRESHOLDS,
  type QualityScores,
  type QualityDimensions,
  type QualityThresholds,
  type ConvergenceReason,
} from "./types.js";

describe("DEFAULT_QUALITY_WEIGHTS", () => {
  it("should have all 12 dimensions", () => {
    const dimensions = Object.keys(DEFAULT_QUALITY_WEIGHTS);
    expect(dimensions).toHaveLength(12);
  });

  it("should sum to 1.0 (100%)", () => {
    const sum = Object.values(DEFAULT_QUALITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("should have correctness as highest weight", () => {
    expect(DEFAULT_QUALITY_WEIGHTS.correctness).toBe(0.15);
    expect(DEFAULT_QUALITY_WEIGHTS.correctness).toBeGreaterThan(DEFAULT_QUALITY_WEIGHTS.style);
  });

  it("should have all weights between 0 and 1", () => {
    for (const weight of Object.values(DEFAULT_QUALITY_WEIGHTS)) {
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it("should include expected dimensions", () => {
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("correctness");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("completeness");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("robustness");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("readability");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("maintainability");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("complexity");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("duplication");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("testCoverage");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("testQuality");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("security");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("documentation");
    expect(DEFAULT_QUALITY_WEIGHTS).toHaveProperty("style");
  });
});

describe("DEFAULT_QUALITY_THRESHOLDS", () => {
  it("should have minimum thresholds", () => {
    expect(DEFAULT_QUALITY_THRESHOLDS.minimum).toBeDefined();
    expect(DEFAULT_QUALITY_THRESHOLDS.minimum.overall).toBe(85);
    expect(DEFAULT_QUALITY_THRESHOLDS.minimum.testCoverage).toBe(80);
    expect(DEFAULT_QUALITY_THRESHOLDS.minimum.security).toBe(100);
  });

  it("should have target thresholds", () => {
    expect(DEFAULT_QUALITY_THRESHOLDS.target).toBeDefined();
    expect(DEFAULT_QUALITY_THRESHOLDS.target.overall).toBe(95);
    expect(DEFAULT_QUALITY_THRESHOLDS.target.testCoverage).toBe(90);
  });

  it("should have sensible convergence threshold", () => {
    expect(DEFAULT_QUALITY_THRESHOLDS.convergenceThreshold).toBe(2);
    expect(DEFAULT_QUALITY_THRESHOLDS.convergenceThreshold).toBeGreaterThan(0);
    expect(DEFAULT_QUALITY_THRESHOLDS.convergenceThreshold).toBeLessThan(10);
  });

  it("should have iteration limits", () => {
    expect(DEFAULT_QUALITY_THRESHOLDS.maxIterations).toBe(10);
    expect(DEFAULT_QUALITY_THRESHOLDS.minIterations).toBe(2);
    expect(DEFAULT_QUALITY_THRESHOLDS.maxIterations).toBeGreaterThan(
      DEFAULT_QUALITY_THRESHOLDS.minIterations
    );
  });

  it("should require 100% security (no vulnerabilities)", () => {
    expect(DEFAULT_QUALITY_THRESHOLDS.minimum.security).toBe(100);
  });

  it("target should be higher than minimum", () => {
    expect(DEFAULT_QUALITY_THRESHOLDS.target.overall).toBeGreaterThan(
      DEFAULT_QUALITY_THRESHOLDS.minimum.overall
    );
    expect(DEFAULT_QUALITY_THRESHOLDS.target.testCoverage).toBeGreaterThan(
      DEFAULT_QUALITY_THRESHOLDS.minimum.testCoverage
    );
  });
});

describe("QualityScores type", () => {
  it("should accept valid quality scores", () => {
    const scores: QualityScores = {
      overall: 87,
      dimensions: {
        correctness: 90,
        completeness: 85,
        robustness: 80,
        readability: 90,
        maintainability: 85,
        complexity: 88,
        duplication: 95,
        testCoverage: 82,
        testQuality: 80,
        security: 100,
        documentation: 75,
        style: 95,
      },
      evaluatedAt: new Date(),
      evaluationDurationMs: 1500,
    };

    // TypeScript compilation is the test - this should not error
    expect(scores.overall).toBe(87);
    expect(scores.dimensions.correctness).toBe(90);
  });
});

describe("Quality calculation helpers", () => {
  function calculateOverallScore(
    dimensions: QualityDimensions,
    weights: typeof DEFAULT_QUALITY_WEIGHTS
  ): number {
    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
      const dimensionKey = key as keyof QualityDimensions;
      score += dimensions[dimensionKey] * weight;
    }
    return Math.round(score * 100) / 100;
  }

  function checkConvergence(
    currentScore: number,
    previousScore: number,
    threshold: number
  ): boolean {
    return Math.abs(currentScore - previousScore) < threshold;
  }

  function determineConvergenceReason(
    score: number,
    previousScore: number,
    iteration: number,
    thresholds: QualityThresholds
  ): ConvergenceReason {
    if (score >= thresholds.target.overall) {
      return "target_reached";
    }
    if (iteration >= thresholds.maxIterations) {
      return "max_iterations";
    }
    if (
      score >= thresholds.minimum.overall &&
      iteration >= thresholds.minIterations &&
      checkConvergence(score, previousScore, thresholds.convergenceThreshold)
    ) {
      return "score_converged";
    }
    if (score < thresholds.minimum.overall && iteration >= thresholds.minIterations) {
      return "below_minimum";
    }
    return "not_converged";
  }

  it("should calculate weighted overall score", () => {
    const dimensions: QualityDimensions = {
      correctness: 100,
      completeness: 100,
      robustness: 100,
      readability: 100,
      maintainability: 100,
      complexity: 100,
      duplication: 100,
      testCoverage: 100,
      testQuality: 100,
      security: 100,
      documentation: 100,
      style: 100,
    };

    const overall = calculateOverallScore(dimensions, DEFAULT_QUALITY_WEIGHTS);
    expect(overall).toBe(100);
  });

  it("should calculate mixed scores correctly", () => {
    const dimensions: QualityDimensions = {
      correctness: 90,
      completeness: 80,
      robustness: 85,
      readability: 90,
      maintainability: 85,
      complexity: 80,
      duplication: 95,
      testCoverage: 85,
      testQuality: 80,
      security: 100,
      documentation: 70,
      style: 95,
    };

    const overall = calculateOverallScore(dimensions, DEFAULT_QUALITY_WEIGHTS);

    // Manual calculation:
    // 90*0.15 + 80*0.10 + 85*0.10 + 90*0.10 + 85*0.10 + 80*0.08 + 95*0.07 +
    // 85*0.10 + 80*0.05 + 100*0.08 + 70*0.04 + 95*0.03
    // = 13.5 + 8 + 8.5 + 9 + 8.5 + 6.4 + 6.65 + 8.5 + 4 + 8 + 2.8 + 2.85
    // = 86.7
    expect(overall).toBeCloseTo(86.7, 1);
  });

  it("should detect convergence correctly", () => {
    expect(checkConvergence(87, 85, 2)).toBe(false); // delta = 2, not < 2
    expect(checkConvergence(87, 86, 2)).toBe(true); // delta = 1 < 2
    expect(checkConvergence(90, 90, 2)).toBe(true); // delta = 0 < 2
    expect(checkConvergence(95, 90, 2)).toBe(false); // delta = 5, not < 2
  });

  it("should determine convergence reason: target_reached", () => {
    const reason = determineConvergenceReason(96, 94, 3, DEFAULT_QUALITY_THRESHOLDS);
    expect(reason).toBe("target_reached");
  });

  it("should determine convergence reason: max_iterations", () => {
    const reason = determineConvergenceReason(80, 79, 10, DEFAULT_QUALITY_THRESHOLDS);
    expect(reason).toBe("max_iterations");
  });

  it("should determine convergence reason: score_converged", () => {
    const reason = determineConvergenceReason(87, 86, 3, DEFAULT_QUALITY_THRESHOLDS);
    expect(reason).toBe("score_converged");
  });

  it("should determine convergence reason: below_minimum", () => {
    const reason = determineConvergenceReason(70, 69, 5, DEFAULT_QUALITY_THRESHOLDS);
    expect(reason).toBe("below_minimum");
  });

  it("should determine convergence reason: not_converged", () => {
    const reason = determineConvergenceReason(87, 80, 2, DEFAULT_QUALITY_THRESHOLDS);
    expect(reason).toBe("not_converged");
  });
});
