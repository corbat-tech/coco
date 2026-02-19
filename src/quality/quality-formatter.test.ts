/**
 * Tests for Quality Formatter
 */

import { describe, it, expect } from "vitest";
import { QualityFormatter } from "./quality-formatter.js";
import type { QualityEvaluation, QualityDimensions } from "./types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function makeDimensions(override: Partial<QualityDimensions> = {}): QualityDimensions {
  return {
    correctness: 90,
    completeness: 85,
    robustness: 88,
    readability: 82,
    maintainability: 78,
    complexity: 75,
    duplication: 95,
    testCoverage: 80,
    testQuality: 70,
    security: 100,
    documentation: 60,
    style: 90,
    ...override,
  };
}

function makeEvaluation(opts: {
  overall?: number;
  dimensions?: Partial<QualityDimensions>;
  meetsMinimum?: boolean;
  meetsTarget?: boolean;
  issues?: QualityEvaluation["issues"];
  suggestions?: QualityEvaluation["suggestions"];
}): QualityEvaluation {
  return {
    scores: {
      overall: opts.overall ?? 85,
      dimensions: makeDimensions(opts.dimensions),
      evaluatedAt: new Date("2026-02-19T12:00:00Z"),
      evaluationDurationMs: 1000,
    },
    meetsMinimum: opts.meetsMinimum ?? true,
    meetsTarget: opts.meetsTarget ?? false,
    converged: false,
    issues: opts.issues ?? [],
    suggestions: opts.suggestions ?? [],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// formatSummary
// ──────────────────────────────────────────────────────────────────────────────

describe("QualityFormatter.formatSummary", () => {
  const fmt = new QualityFormatter();

  it("should show PASS when meetsMinimum is true", () => {
    const result = fmt.formatSummary(makeEvaluation({ overall: 87, meetsMinimum: true }));
    expect(result).toContain("PASS");
    expect(result).toContain("87");
  });

  it("should show FAIL when meetsMinimum is false", () => {
    const result = fmt.formatSummary(makeEvaluation({ overall: 72, meetsMinimum: false }));
    expect(result).toContain("FAIL");
    expect(result).toContain("72");
  });

  it("should include /100 suffix", () => {
    const result = fmt.formatSummary(makeEvaluation({ overall: 90 }));
    expect(result).toContain("/100");
  });

  it("should prefix with ✓ for passing evaluation", () => {
    const result = fmt.formatSummary(makeEvaluation({ meetsMinimum: true }));
    expect(result.startsWith("✓")).toBe(true);
  });

  it("should prefix with ✗ for failing evaluation", () => {
    const result = fmt.formatSummary(makeEvaluation({ meetsMinimum: false }));
    expect(result.startsWith("✗")).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// formatTable
// ──────────────────────────────────────────────────────────────────────────────

describe("QualityFormatter.formatTable", () => {
  const fmt = new QualityFormatter();

  it("should contain all 12 dimension names", () => {
    const result = fmt.formatTable(makeEvaluation({}));
    const dimensions = [
      "Correctness", "Completeness", "Robustness", "Readability",
      "Maintainability", "Complexity", "Duplication", "Test Coverage",
      "Test Quality", "Security", "Documentation", "Style",
    ];
    for (const dim of dimensions) {
      expect(result).toContain(dim);
    }
  });

  it("should contain the overall score", () => {
    const result = fmt.formatTable(makeEvaluation({ overall: 88 }));
    expect(result).toContain("88");
  });

  it("should contain the Overall row", () => {
    const result = fmt.formatTable(makeEvaluation({}));
    expect(result).toContain("Overall");
  });

  it("should use ✓ status icon for passing evaluation", () => {
    const result = fmt.formatTable(makeEvaluation({ meetsMinimum: true }));
    expect(result).toContain("✓");
  });

  it("should use ✗ status icon for failing evaluation", () => {
    const result = fmt.formatTable(makeEvaluation({ meetsMinimum: false }));
    expect(result).toContain("✗");
  });

  it("should use box-drawing characters", () => {
    const result = fmt.formatTable(makeEvaluation({}));
    expect(result).toContain("╭");
    expect(result).toContain("╰");
    expect(result).toContain("│");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// formatIssues
// ──────────────────────────────────────────────────────────────────────────────

describe("QualityFormatter.formatIssues", () => {
  const fmt = new QualityFormatter();

  it("should return 'No issues found.' when issues list is empty", () => {
    const result = fmt.formatIssues(makeEvaluation({ issues: [] }));
    expect(result).toBe("No issues found.");
  });

  it("should show issue count in header", () => {
    const issues: QualityEvaluation["issues"] = [
      { dimension: "security", severity: "critical", message: "SQL injection found" },
      { dimension: "correctness", severity: "major", message: "Tests failing" },
    ];
    const result = fmt.formatIssues(makeEvaluation({ issues }));
    expect(result).toContain("Issues (2)");
  });

  it("should include dimension name", () => {
    const issues: QualityEvaluation["issues"] = [
      { dimension: "security", severity: "critical", message: "Vulnerability detected" },
    ];
    const result = fmt.formatIssues(makeEvaluation({ issues }));
    expect(result).toContain("security");
  });

  it("should include file and line when provided", () => {
    const issues: QualityEvaluation["issues"] = [
      { dimension: "style", severity: "minor", message: "Line too long", file: "src/app.ts", line: 42 },
    ];
    const result = fmt.formatIssues(makeEvaluation({ issues }));
    expect(result).toContain("src/app.ts");
    expect(result).toContain("42");
  });

  it("should include suggestion when provided", () => {
    const issues: QualityEvaluation["issues"] = [
      {
        dimension: "testCoverage",
        severity: "major",
        message: "Coverage below threshold",
        suggestion: "Add tests for edge cases",
      },
    ];
    const result = fmt.formatIssues(makeEvaluation({ issues }));
    expect(result).toContain("Add tests for edge cases");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// formatSuggestions
// ──────────────────────────────────────────────────────────────────────────────

describe("QualityFormatter.formatSuggestions", () => {
  const fmt = new QualityFormatter();

  it("should return 'No suggestions.' when list is empty", () => {
    const result = fmt.formatSuggestions(makeEvaluation({ suggestions: [] }));
    expect(result).toBe("No suggestions.");
  });

  it("should list suggestions with estimated impact", () => {
    const suggestions: QualityEvaluation["suggestions"] = [
      { dimension: "testCoverage", priority: "high", description: "Add unit tests", estimatedImpact: 10 },
    ];
    const result = fmt.formatSuggestions(makeEvaluation({ suggestions }));
    expect(result).toContain("Add unit tests");
    expect(result).toContain("+10 pts");
  });

  it("should cap output at 5 suggestions", () => {
    const suggestions: QualityEvaluation["suggestions"] = Array.from({ length: 8 }, (_, i) => ({
      dimension: "style" as const,
      priority: "low" as const,
      description: `Suggestion ${i + 1}`,
      estimatedImpact: 1,
    }));
    const result = fmt.formatSuggestions(makeEvaluation({ suggestions }));
    // Should show "top 5", not all 8
    expect(result).toContain("top 5");
  });

  it("should sort high-priority suggestions first", () => {
    const suggestions: QualityEvaluation["suggestions"] = [
      { dimension: "style", priority: "low", description: "Low priority", estimatedImpact: 1 },
      { dimension: "security", priority: "high", description: "High priority", estimatedImpact: 5 },
    ];
    const result = fmt.formatSuggestions(makeEvaluation({ suggestions }));
    const highIdx = result.indexOf("High priority");
    const lowIdx = result.indexOf("Low priority");
    expect(highIdx).toBeLessThan(lowIdx);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// formatFull
// ──────────────────────────────────────────────────────────────────────────────

describe("QualityFormatter.formatFull", () => {
  const fmt = new QualityFormatter();

  it("should include the table section", () => {
    const result = fmt.formatFull(makeEvaluation({}));
    expect(result).toContain("Quality Report");
  });

  it("should include issues section when issues exist", () => {
    const issues: QualityEvaluation["issues"] = [
      { dimension: "security", severity: "critical", message: "Vulnerability" },
    ];
    const result = fmt.formatFull(makeEvaluation({ issues }));
    expect(result).toContain("Issues");
  });

  it("should include suggestions section when suggestions exist", () => {
    const suggestions: QualityEvaluation["suggestions"] = [
      { dimension: "testCoverage", priority: "high", description: "Write tests", estimatedImpact: 10 },
    ];
    const result = fmt.formatFull(makeEvaluation({ suggestions }));
    expect(result).toContain("Suggestions");
  });

  it("should not include issues section when issues list is empty", () => {
    const result = fmt.formatFull(makeEvaluation({ issues: [] }));
    expect(result).not.toContain("Issues (");
  });
});
