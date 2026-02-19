/**
 * Tests for GitHub Actions Quality Workflow Generator
 */

import { describe, it, expect } from "vitest";
import {
  generateQualityWorkflow,
  formatQualityPRComment,
} from "./github-quality-workflow.js";
import type { QualityEvaluation, QualityDimensions } from "../../quality/types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function makeDimensions(): QualityDimensions {
  return {
    correctness: 90, completeness: 85, robustness: 88,
    readability: 82, maintainability: 78, complexity: 75,
    duplication: 95, testCoverage: 80, testQuality: 70,
    security: 100, documentation: 60, style: 90,
  };
}

function makeEvaluation(opts: {
  overall?: number;
  meetsMinimum?: boolean;
  issues?: QualityEvaluation["issues"];
} = {}): QualityEvaluation {
  return {
    scores: {
      overall: opts.overall ?? 85,
      dimensions: makeDimensions(),
      evaluatedAt: new Date("2026-02-19T12:00:00.000Z"),
      evaluationDurationMs: 1000,
    },
    meetsMinimum: opts.meetsMinimum ?? true,
    meetsTarget: false,
    converged: false,
    issues: opts.issues ?? [],
    suggestions: [],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// generateQualityWorkflow
// ──────────────────────────────────────────────────────────────────────────────

describe("generateQualityWorkflow", () => {
  it("should include the workflow name", () => {
    const yaml = generateQualityWorkflow();
    expect(yaml).toContain("name: Quality Check");
  });

  it("should include push and pull_request triggers", () => {
    const yaml = generateQualityWorkflow();
    expect(yaml).toContain("push:");
    expect(yaml).toContain("pull_request:");
  });

  it("should include default branches (main, master)", () => {
    const yaml = generateQualityWorkflow();
    expect(yaml).toContain("main");
    expect(yaml).toContain("master");
  });

  it("should use custom branches when specified", () => {
    const yaml = generateQualityWorkflow({ branches: ["develop", "release"] });
    expect(yaml).toContain("develop");
    expect(yaml).toContain("release");
    expect(yaml).not.toContain("main");
  });

  it("should include Node.js version 22 by default", () => {
    const yaml = generateQualityWorkflow();
    expect(yaml).toContain('"22"');
  });

  it("should use custom nodeVersion", () => {
    const yaml = generateQualityWorkflow({ nodeVersion: "20" });
    expect(yaml).toContain('"20"');
  });

  it("should include pnpm setup step for pnpm package manager", () => {
    const yaml = generateQualityWorkflow({ packageManager: "pnpm" });
    expect(yaml).toContain("pnpm/action-setup");
  });

  it("should not include pnpm setup for npm package manager", () => {
    const yaml = generateQualityWorkflow({ packageManager: "npm" });
    expect(yaml).not.toContain("pnpm/action-setup");
  });

  it("should use npm ci for npm package manager", () => {
    const yaml = generateQualityWorkflow({ packageManager: "npm" });
    expect(yaml).toContain("npm ci");
  });

  it("should use yarn install for yarn package manager", () => {
    const yaml = generateQualityWorkflow({ packageManager: "yarn" });
    expect(yaml).toContain("yarn install --frozen-lockfile");
  });

  it("should include continue-on-error when failOnBelowMinimum is false", () => {
    const yaml = generateQualityWorkflow({ failOnBelowMinimum: false });
    expect(yaml).toContain("continue-on-error: true");
  });

  it("should not include continue-on-error by default", () => {
    const yaml = generateQualityWorkflow();
    expect(yaml).not.toContain("continue-on-error");
  });

  it("should include PR comment step when commentOnPR is true", () => {
    const yaml = generateQualityWorkflow({ commentOnPR: true });
    expect(yaml).toContain("Post quality report as PR comment");
  });

  it("should not include PR comment step when commentOnPR is false", () => {
    const yaml = generateQualityWorkflow({ commentOnPR: false });
    expect(yaml).not.toContain("Post quality report as PR comment");
  });

  it("should include artifact upload step", () => {
    const yaml = generateQualityWorkflow();
    expect(yaml).toContain("Upload quality report");
    expect(yaml).toContain("upload-artifact");
  });

  it("should include checkout step", () => {
    const yaml = generateQualityWorkflow();
    expect(yaml).toContain("actions/checkout");
  });

  it("should include pull-requests write permission for PR comments", () => {
    const yaml = generateQualityWorkflow({ commentOnPR: true });
    expect(yaml).toContain("pull-requests: write");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// formatQualityPRComment
// ──────────────────────────────────────────────────────────────────────────────

describe("formatQualityPRComment", () => {
  it("should include PASS badge for passing evaluation", () => {
    const comment = formatQualityPRComment(makeEvaluation({ meetsMinimum: true }));
    expect(comment).toContain("PASS");
  });

  it("should include FAIL badge for failing evaluation", () => {
    const comment = formatQualityPRComment(makeEvaluation({ meetsMinimum: false }));
    expect(comment).toContain("FAIL");
  });

  it("should include overall score", () => {
    const comment = formatQualityPRComment(makeEvaluation({ overall: 88 }));
    expect(comment).toContain("88/100");
  });

  it("should include evaluation date", () => {
    const comment = formatQualityPRComment(makeEvaluation());
    expect(comment).toContain("2026-02-19");
  });

  it("should include dimension breakdown by default", () => {
    const comment = formatQualityPRComment(makeEvaluation());
    expect(comment).toContain("Dimension breakdown");
    expect(comment).toContain("Correctness");
    expect(comment).toContain("Security");
  });

  it("should hide dimension breakdown when showDimensions is false", () => {
    const comment = formatQualityPRComment(makeEvaluation(), { showDimensions: false });
    expect(comment).not.toContain("Dimension breakdown");
  });

  it("should include issues section when issues are present", () => {
    const issues: QualityEvaluation["issues"] = [
      { dimension: "security", severity: "critical", message: "SQL injection detected" },
    ];
    const comment = formatQualityPRComment(makeEvaluation({ issues }));
    expect(comment).toContain("Issues");
    expect(comment).toContain("SQL injection detected");
  });

  it("should not include issues section when no issues", () => {
    const comment = formatQualityPRComment(makeEvaluation({ issues: [] }));
    expect(comment).not.toContain("<summary>🔍 Issues");
  });

  it("should cap issues at maxIssues", () => {
    const issues: QualityEvaluation["issues"] = Array.from({ length: 10 }, (_, i) => ({
      dimension: "style" as const,
      severity: "minor" as const,
      message: `Issue ${i + 1}`,
    }));
    const comment = formatQualityPRComment(makeEvaluation({ issues }), { maxIssues: 3 });
    expect(comment).toContain("and 7 more");
  });

  it("should include Corbat-Coco branding footer", () => {
    const comment = formatQualityPRComment(makeEvaluation());
    expect(comment).toContain("Corbat-Coco");
  });

  it("should use collapsible <details> blocks for optional sections", () => {
    const comment = formatQualityPRComment(makeEvaluation());
    expect(comment).toContain("<details>");
    expect(comment).toContain("</details>");
  });
});
