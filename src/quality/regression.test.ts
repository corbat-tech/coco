/**
 * Tests for regression detection
 */

import { describe, it, expect } from "vitest";
import {
  detectRegression,
  isRegressionAcceptable,
  formatRegression,
  QualityTrend,
} from "./regression.js";
import type { QualityScores, QualityDimensions } from "./types.js";

// Helper to create mock quality scores
function createScores(
  overall: number,
  dimensionOverrides: Partial<QualityDimensions> = {},
): QualityScores {
  const base = overall;
  return {
    overall,
    dimensions: {
      correctness: dimensionOverrides.correctness ?? base,
      completeness: dimensionOverrides.completeness ?? base,
      robustness: dimensionOverrides.robustness ?? base,
      readability: dimensionOverrides.readability ?? base,
      maintainability: dimensionOverrides.maintainability ?? base,
      complexity: dimensionOverrides.complexity ?? base,
      duplication: dimensionOverrides.duplication ?? base,
      testCoverage: dimensionOverrides.testCoverage ?? base,
      testQuality: dimensionOverrides.testQuality ?? base,
      security: dimensionOverrides.security ?? 100,
      documentation: dimensionOverrides.documentation ?? base,
      style: dimensionOverrides.style ?? base,
    },
    evaluatedAt: new Date(),
    evaluationDurationMs: 100,
  };
}

describe("detectRegression", () => {
  it("should detect dimension regression", () => {
    const previous = createScores(90, { correctness: 95 });
    const current = createScores(85, { correctness: 80 });

    const result = detectRegression(previous, current);

    expect(result.hasRegression).toBe(true);
    expect(result.regressions.some((r) => r.dimension === "correctness")).toBe(true);
  });

  it("should detect overall score regression", () => {
    const previous = createScores(90);
    const current = createScores(85);

    const result = detectRegression(previous, current);

    expect(result.overallRegressed).toBe(true);
    expect(result.overallDelta).toBe(-5);
  });

  it("should not report regression for improvements", () => {
    const previous = createScores(80);
    const current = createScores(90);

    const result = detectRegression(previous, current);

    expect(result.hasRegression).toBe(false);
    expect(result.overallDelta).toBe(10);
  });

  it("should not report regression for small changes within threshold", () => {
    const previous = createScores(90);
    const current = createScores(89);

    const result = detectRegression(previous, current, { minDelta: 5 });

    expect(result.hasRegression).toBe(false);
  });

  it("should respect custom threshold", () => {
    const previous = createScores(90);
    const current = createScores(87);

    const resultDefault = detectRegression(previous, current);
    const resultHighThreshold = detectRegression(previous, current, { minDelta: 10 });

    expect(resultDefault.hasRegression).toBe(true);
    expect(resultHighThreshold.hasRegression).toBe(false);
  });

  it("should handle same scores", () => {
    const scores = createScores(90);

    const result = detectRegression(scores, scores);

    expect(result.hasRegression).toBe(false);
    expect(result.overallDelta).toBe(0);
  });

  it("should detect multiple dimension regressions", () => {
    const previous = createScores(90, {
      correctness: 95,
      robustness: 90,
      testCoverage: 85,
    });
    const current = createScores(80, {
      correctness: 80,
      robustness: 75,
      testCoverage: 70,
    });

    const result = detectRegression(previous, current);

    expect(result.hasRegression).toBe(true);
    expect(result.regressions.length).toBeGreaterThanOrEqual(3);
  });

  it("should include severity levels", () => {
    const previous = createScores(90);
    const current = createScores(75);

    const result = detectRegression(previous, current);

    expect(result.regressions.length).toBeGreaterThan(0);
    expect(result.regressions[0]?.severity).toBeDefined();
    expect(["minor", "moderate", "severe"]).toContain(result.regressions[0]?.severity);
  });

  it("should ignore specified dimensions", () => {
    const previous = createScores(90, { security: 100 });
    const current = createScores(90, { security: 80 });

    const result = detectRegression(previous, current, { ignoreDimensions: ["security"] });

    expect(result.regressions.some((r) => r.dimension === "security")).toBe(false);
  });

  it("should generate a summary", () => {
    const previous = createScores(90);
    const current = createScores(80);

    const result = detectRegression(previous, current);

    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

describe("isRegressionAcceptable", () => {
  it("should accept minor regressions with default severity", () => {
    const result = {
      hasRegression: true,
      regressions: [
        {
          dimension: "correctness" as const,
          previousScore: 90,
          currentScore: 88,
          delta: -2,
          percentChange: -2.2,
          severity: "minor" as const,
        },
      ],
      overallDelta: -2,
      overallRegressed: false,
      worstSeverity: "minor" as const,
      summary: "Minor regression",
    };

    expect(isRegressionAcceptable(result, "minor")).toBe(true);
  });

  it("should reject severe regressions", () => {
    const result = {
      hasRegression: true,
      regressions: [
        {
          dimension: "correctness" as const,
          previousScore: 90,
          currentScore: 70,
          delta: -20,
          percentChange: -22,
          severity: "severe" as const,
        },
      ],
      overallDelta: -20,
      overallRegressed: true,
      worstSeverity: "severe" as const,
      summary: "Severe regression",
    };

    expect(isRegressionAcceptable(result, "minor")).toBe(false);
  });

  it("should reject moderate regressions when max is minor", () => {
    const result = {
      hasRegression: true,
      regressions: [
        {
          dimension: "correctness" as const,
          previousScore: 90,
          currentScore: 82,
          delta: -8,
          percentChange: -8.8,
          severity: "moderate" as const,
        },
      ],
      overallDelta: -8,
      overallRegressed: true,
      worstSeverity: "moderate" as const,
      summary: "Moderate regression",
    };

    expect(isRegressionAcceptable(result, "minor")).toBe(false);
  });

  it("should accept moderate regressions when allowed", () => {
    const result = {
      hasRegression: true,
      regressions: [
        {
          dimension: "correctness" as const,
          previousScore: 90,
          currentScore: 82,
          delta: -8,
          percentChange: -8.8,
          severity: "moderate" as const,
        },
      ],
      overallDelta: -8,
      overallRegressed: true,
      worstSeverity: "moderate" as const,
      summary: "Moderate regression",
    };

    expect(isRegressionAcceptable(result, "moderate")).toBe(true);
  });

  it("should accept no regression", () => {
    const result = {
      hasRegression: false,
      regressions: [],
      overallDelta: 5,
      overallRegressed: false,
      worstSeverity: null,
      summary: "No regression",
    };

    expect(isRegressionAcceptable(result)).toBe(true);
  });

  it("should reject when too many regressions", () => {
    const result = {
      hasRegression: true,
      regressions: [
        {
          dimension: "correctness" as const,
          previousScore: 90,
          currentScore: 88,
          delta: -2,
          percentChange: -2.2,
          severity: "minor" as const,
        },
        {
          dimension: "robustness" as const,
          previousScore: 90,
          currentScore: 88,
          delta: -2,
          percentChange: -2.2,
          severity: "minor" as const,
        },
        {
          dimension: "readability" as const,
          previousScore: 90,
          currentScore: 88,
          delta: -2,
          percentChange: -2.2,
          severity: "minor" as const,
        },
      ],
      overallDelta: -2,
      overallRegressed: false,
      worstSeverity: "minor" as const,
      summary: "Minor regressions",
    };

    expect(isRegressionAcceptable(result, "minor", 2)).toBe(false);
  });
});

describe("formatRegression", () => {
  it("should format no regression message", () => {
    const result = {
      hasRegression: false,
      regressions: [],
      overallDelta: 5,
      overallRegressed: false,
      worstSeverity: null,
      summary: "No regression",
    };

    const formatted = formatRegression(result);

    expect(formatted).toContain("No regression");
  });

  it("should format regression report", () => {
    const result = {
      hasRegression: true,
      regressions: [
        {
          dimension: "correctness" as const,
          previousScore: 90,
          currentScore: 80,
          delta: -10,
          percentChange: -11.1,
          severity: "moderate" as const,
        },
      ],
      overallDelta: -10,
      overallRegressed: true,
      worstSeverity: "moderate" as const,
      summary: "Moderate regression",
    };

    const formatted = formatRegression(result);

    expect(formatted).toContain("correctness");
    expect(formatted).toContain("90");
    expect(formatted).toContain("80");
  });

  it("should include severity indicators", () => {
    const result = {
      hasRegression: true,
      regressions: [
        {
          dimension: "correctness" as const,
          previousScore: 90,
          currentScore: 70,
          delta: -20,
          percentChange: -22,
          severity: "severe" as const,
        },
      ],
      overallDelta: -20,
      overallRegressed: true,
      worstSeverity: "severe" as const,
      summary: "Severe regression",
    };

    const formatted = formatRegression(result);

    expect(formatted).toContain("🔴"); // Severe indicator
  });

  it("should support colorized output", () => {
    const result = {
      hasRegression: true,
      regressions: [
        {
          dimension: "correctness" as const,
          previousScore: 90,
          currentScore: 80,
          delta: -10,
          percentChange: -11,
          severity: "moderate" as const,
        },
      ],
      overallDelta: -10,
      overallRegressed: true,
      worstSeverity: "moderate" as const,
      summary: "Regression",
    };

    const formatted = formatRegression(result, true);

    expect(formatted).toContain("\x1b[");
  });
});

describe("QualityTrend", () => {
  it("should track quality scores over time", () => {
    const trend = new QualityTrend();

    trend.add(createScores(80));
    trend.add(createScores(85));
    trend.add(createScores(90));

    expect(trend.getRecent(3)).toHaveLength(3);
  });

  it("should detect declining trend", () => {
    const trend = new QualityTrend();

    trend.add(createScores(90));
    trend.add(createScores(85));
    trend.add(createScores(80));

    expect(trend.isTrendingDown(3)).toBe(true);
  });

  it("should not detect declining trend for improving scores", () => {
    const trend = new QualityTrend();

    trend.add(createScores(80));
    trend.add(createScores(85));
    trend.add(createScores(90));

    expect(trend.isTrendingDown(3)).toBe(false);
  });

  it("should calculate average score", () => {
    const trend = new QualityTrend();

    trend.add(createScores(80));
    trend.add(createScores(90));
    trend.add(createScores(100));

    expect(trend.getAverageScore(3)).toBe(90);
  });

  it("should detect plateau", () => {
    const trend = new QualityTrend();

    trend.add(createScores(85));
    trend.add(createScores(85));
    trend.add(createScores(85));

    expect(trend.isPlateaued(3, 1)).toBe(true);
  });

  it("should not detect plateau for changing scores", () => {
    const trend = new QualityTrend();

    trend.add(createScores(80));
    trend.add(createScores(85));
    trend.add(createScores(90));

    expect(trend.isPlateaued(3, 1)).toBe(false);
  });

  it("should respect max history length", () => {
    const trend = new QualityTrend(3);

    trend.add(createScores(70));
    trend.add(createScores(80));
    trend.add(createScores(90));
    trend.add(createScores(100));

    const recent = trend.getRecent(10);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.overall).toBe(80); // 70 was dropped
  });

  it("should clear history", () => {
    const trend = new QualityTrend();

    trend.add(createScores(90));
    trend.clear();

    expect(trend.getRecent(10)).toHaveLength(0);
  });

  it("should handle single score", () => {
    const trend = new QualityTrend();

    trend.add(createScores(90));

    expect(trend.isTrendingDown(3)).toBe(false);
    expect(trend.getAverageScore(3)).toBe(90);
  });
});
