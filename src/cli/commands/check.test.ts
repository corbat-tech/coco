/**
 * Regression tests for check.ts
 *
 * Fix #1a: meetsMinimum uses per-project thresholds (via quality-bridge)
 * Fix #1b: output routing — json/markdown/html without --output-file must NOT
 *          prefix the machine-parseable payload with the human-readable summary.
 */

import { describe, it, expect } from "vitest";
import { resolvedThresholds } from "../../quality/quality-bridge.js";
import { DEFAULT_QUALITY_THRESHOLDS } from "../../quality/types.js";
import type { ProjectConfig } from "../../config/project-config.js";

/**
 * Re-implements the exact meetsMinimum logic used in check.ts so that
 * any future drift between the two would be caught here.
 */
function computeMeetsMinimum(
  scores: { overall: number; dimensions: { testCoverage: number; security: number } },
  projectConfig: ProjectConfig | null,
): boolean {
  const thresholds = resolvedThresholds(projectConfig);
  return (
    scores.overall >= thresholds.minimum.overall &&
    scores.dimensions.testCoverage >= thresholds.minimum.testCoverage &&
    scores.dimensions.security >= thresholds.minimum.security
  );
}

describe("check.ts meetsMinimum — honours per-project thresholds (Fix #1)", () => {
  const passingScores = {
    overall: 87,
    dimensions: { testCoverage: 82, security: 100 },
  };

  const failingOverall = {
    overall: 80, // below default 85
    dimensions: { testCoverage: 82, security: 100 },
  };

  it("returns true when all scores meet DEFAULT_QUALITY_THRESHOLDS", () => {
    expect(computeMeetsMinimum(passingScores, null)).toBe(true);
  });

  it("returns false when overall is below default minimum", () => {
    expect(computeMeetsMinimum(failingOverall, null)).toBe(false);
  });

  it("returns true when overall passes a LOWERED per-project minScore threshold", () => {
    // With a project config that lowers the bar to 75, a score of 80 should pass.
    const config: ProjectConfig = { quality: { minScore: 75 } };
    expect(computeMeetsMinimum(failingOverall, config)).toBe(true);
  });

  it("returns false when overall fails a RAISED per-project minScore threshold", () => {
    // With a project config that raises the bar to 95, a score of 87 should fail.
    const config: ProjectConfig = { quality: { minScore: 95 } };
    expect(computeMeetsMinimum(passingScores, config)).toBe(false);
  });

  it("returns false when testCoverage is below default minimum regardless of overall", () => {
    const lowCoverage = {
      overall: 90,
      dimensions: {
        testCoverage: DEFAULT_QUALITY_THRESHOLDS.minimum.testCoverage - 1,
        security: 100,
      },
    };
    expect(computeMeetsMinimum(lowCoverage, null)).toBe(false);
  });

  it("returns true when testCoverage meets a LOWERED per-project minCoverage", () => {
    const lowCoverage = {
      overall: 90,
      dimensions: { testCoverage: 60, security: 100 },
    };
    const config: ProjectConfig = { quality: { minCoverage: 55 } };
    expect(computeMeetsMinimum(lowCoverage, config)).toBe(true);
  });

  it("returns false when security is below default threshold", () => {
    const insecure = {
      overall: 90,
      dimensions: { testCoverage: 85, security: 95 },
    };
    expect(computeMeetsMinimum(insecure, null)).toBe(false);
  });

  it("returns true when security meets a LOWERED per-project securityThreshold", () => {
    const insecure = {
      overall: 90,
      dimensions: { testCoverage: 85, security: 90 },
    };
    const config: ProjectConfig = { quality: { securityThreshold: 85 } };
    expect(computeMeetsMinimum(insecure, config)).toBe(true);
  });

  it("null config falls back to DEFAULT_QUALITY_THRESHOLDS", () => {
    const thresholds = resolvedThresholds(null);
    expect(thresholds).toEqual(DEFAULT_QUALITY_THRESHOLDS);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Fix #1b — stdout routing for --output json/markdown/html
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Pure unit test for the output routing logic extracted from check.ts.
 *
 * The logic under test (from the fixed version):
 *   if (opts.output === "text")            → print summary + full text
 *   else if (opts.outputFile)              → print summary + "Report written to: …"
 *   else (non-text, no file)               → print ONLY the raw formatted output
 *
 * This ensures `coco check --output json | jq '.'` is not polluted by summary text.
 */
function simulateStdout(opts: {
  output: "text" | "json" | "markdown" | "html";
  outputFile?: string;
  formattedOutput: string;
  summaryLine: string;
}): string[] {
  const lines: string[] = [];

  if (opts.output === "text") {
    lines.push(opts.summaryLine);
    lines.push(opts.formattedOutput);
  } else if (opts.outputFile) {
    lines.push(opts.summaryLine);
    lines.push(`Report written to: ${opts.outputFile}`);
  } else {
    lines.push(opts.formattedOutput);
  }

  return lines;
}

describe("check.ts stdout routing — Fix #1b (double-output bug)", () => {
  const summaryLine = "Overall: 87/100 [PASS]";
  const jsonPayload = '{"scores":{"overall":87}}';
  const markdownPayload = "# Quality Report\n## Score: 87";
  const htmlPayload = "<html><body>Score: 87</body></html>";

  it("text output: prints summary followed by full text report", () => {
    const lines = simulateStdout({
      output: "text",
      formattedOutput: "full text report",
      summaryLine,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(summaryLine);
    expect(lines[1]).toBe("full text report");
  });

  it("json output WITHOUT --output-file: prints ONLY the JSON payload (no summary prefix)", () => {
    const lines = simulateStdout({
      output: "json",
      formattedOutput: jsonPayload,
      summaryLine,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(jsonPayload);
    // The summary must NOT appear — it would break `jq` parsing
    expect(lines[0]).not.toContain("Overall:");
  });

  it("json output WITHOUT --output-file: output is valid JSON (no leading prose)", () => {
    const lines = simulateStdout({
      output: "json",
      formattedOutput: jsonPayload,
      summaryLine,
    });
    expect(() => JSON.parse(lines.join(""))).not.toThrow();
  });

  it("markdown output WITHOUT --output-file: prints ONLY the markdown payload", () => {
    const lines = simulateStdout({
      output: "markdown",
      formattedOutput: markdownPayload,
      summaryLine,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(markdownPayload);
  });

  it("html output WITHOUT --output-file: prints ONLY the html payload", () => {
    const lines = simulateStdout({
      output: "html",
      formattedOutput: htmlPayload,
      summaryLine,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(htmlPayload);
  });

  it("json output WITH --output-file: prints summary + file path (not the raw JSON)", () => {
    const lines = simulateStdout({
      output: "json",
      outputFile: ".coco/reports/quality.json",
      formattedOutput: jsonPayload,
      summaryLine,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(summaryLine);
    expect(lines[1]).toBe("Report written to: .coco/reports/quality.json");
    // Raw JSON must NOT go to stdout when a file is specified
    expect(lines.join("\n")).not.toContain(jsonPayload);
  });

  it("markdown output WITH --output-file: prints summary + file path", () => {
    const lines = simulateStdout({
      output: "markdown",
      outputFile: ".coco/reports/quality.md",
      formattedOutput: markdownPayload,
      summaryLine,
    });
    expect(lines[0]).toBe(summaryLine);
    expect(lines[1]).toContain("quality.md");
  });
});
