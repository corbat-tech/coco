/**
 * Tests for Quality Report Exporter
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { QualityReportExporter } from "./report-exporter.js";
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
  meetsMinimum?: boolean;
  issues?: QualityEvaluation["issues"];
  suggestions?: QualityEvaluation["suggestions"];
} = {}): QualityEvaluation {
  return {
    scores: {
      overall: opts.overall ?? 85,
      dimensions: makeDimensions(),
      evaluatedAt: new Date("2026-02-19T12:00:00.000Z"),
      evaluationDurationMs: 1234,
    },
    meetsMinimum: opts.meetsMinimum ?? true,
    meetsTarget: false,
    converged: false,
    issues: opts.issues ?? [],
    suggestions: opts.suggestions ?? [],
  };
}

let tmpDir: string;
beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), "coco-report-")); });
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

// ──────────────────────────────────────────────────────────────────────────────
// toJson
// ──────────────────────────────────────────────────────────────────────────────

describe("QualityReportExporter.toJson", () => {
  const exporter = new QualityReportExporter();

  it("should produce valid JSON", () => {
    const json = exporter.toJson(makeEvaluation());
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("should include overall score in JSON", () => {
    const json = exporter.toJson(makeEvaluation({ overall: 87 }));
    const parsed = JSON.parse(json) as { scores: { overall: number } };
    expect(parsed.scores.overall).toBe(87);
  });

  it("should include meetsMinimum field", () => {
    const json = exporter.toJson(makeEvaluation({ meetsMinimum: false }));
    const parsed = JSON.parse(json) as { meetsMinimum: boolean };
    expect(parsed.meetsMinimum).toBe(false);
  });

  it("should be pretty-printed (contain newlines and indentation)", () => {
    const json = exporter.toJson(makeEvaluation());
    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// toMarkdown
// ──────────────────────────────────────────────────────────────────────────────

describe("QualityReportExporter.toMarkdown", () => {
  const exporter = new QualityReportExporter();

  it("should contain a Markdown h1 heading", () => {
    const md = exporter.toMarkdown(makeEvaluation());
    expect(md).toContain("# Quality Report");
  });

  it("should include overall score", () => {
    const md = exporter.toMarkdown(makeEvaluation({ overall: 88 }));
    expect(md).toContain("88/100");
  });

  it("should contain PASS for passing evaluation", () => {
    const md = exporter.toMarkdown(makeEvaluation({ meetsMinimum: true }));
    expect(md).toContain("PASS");
  });

  it("should contain FAIL for failing evaluation", () => {
    const md = exporter.toMarkdown(makeEvaluation({ meetsMinimum: false }));
    expect(md).toContain("FAIL");
  });

  it("should include a Markdown table with dimension names", () => {
    const md = exporter.toMarkdown(makeEvaluation());
    expect(md).toContain("| Dimension |");
    expect(md).toContain("Correctness");
    expect(md).toContain("Security");
  });

  it("should include issues section when issues are present", () => {
    const issues: QualityEvaluation["issues"] = [
      { dimension: "security", severity: "critical", message: "SQL injection" },
    ];
    const md = exporter.toMarkdown(makeEvaluation({ issues }));
    expect(md).toContain("## Issues");
    expect(md).toContain("SQL injection");
  });

  it("should include suggestion with impact", () => {
    const suggestions: QualityEvaluation["suggestions"] = [
      { dimension: "testCoverage", priority: "high", description: "Write tests", estimatedImpact: 10 },
    ];
    const md = exporter.toMarkdown(makeEvaluation({ suggestions }));
    expect(md).toContain("## Suggestions");
    expect(md).toContain("Write tests");
    expect(md).toContain("+10 pts");
  });

  it("should end with Corbat-Coco footer", () => {
    const md = exporter.toMarkdown(makeEvaluation());
    expect(md).toContain("Corbat-Coco");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// toHtml
// ──────────────────────────────────────────────────────────────────────────────

describe("QualityReportExporter.toHtml", () => {
  const exporter = new QualityReportExporter();

  it("should start with <!DOCTYPE html>", () => {
    const html = exporter.toHtml(makeEvaluation());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("should include overall score", () => {
    const html = exporter.toHtml(makeEvaluation({ overall: 91 }));
    expect(html).toContain("91/100");
  });

  it("should include PASS for passing evaluation", () => {
    const html = exporter.toHtml(makeEvaluation({ meetsMinimum: true }));
    expect(html).toContain("PASS");
  });

  it("should include FAIL for failing evaluation", () => {
    const html = exporter.toHtml(makeEvaluation({ meetsMinimum: false }));
    expect(html).toContain("FAIL");
  });

  it("should include all dimension names in the table", () => {
    const html = exporter.toHtml(makeEvaluation());
    expect(html).toContain("Correctness");
    expect(html).toContain("Security");
    expect(html).toContain("Test Coverage");
  });

  it("should HTML-escape special characters in issue messages", () => {
    const issues: QualityEvaluation["issues"] = [
      { dimension: "security", severity: "critical", message: "SQL: SELECT * WHERE id=<input>" },
    ];
    const html = exporter.toHtml(makeEvaluation({ issues }));
    expect(html).toContain("&lt;input&gt;");
    expect(html).not.toContain("<input>");
  });

  it("should include closing </html> tag", () => {
    const html = exporter.toHtml(makeEvaluation());
    expect(html).toContain("</html>");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// saveReport
// ──────────────────────────────────────────────────────────────────────────────

describe("QualityReportExporter.saveReport", () => {
  const exporter = new QualityReportExporter();

  it("should write a markdown file and return its path", async () => {
    const path = await exporter.saveReport(makeEvaluation(), tmpDir, "markdown");
    expect(path).toMatch(/\.md$/);
    const content = await readFile(path, "utf-8");
    expect(content).toContain("Quality Report");
  });

  it("should write a JSON file when format is json", async () => {
    const path = await exporter.saveReport(makeEvaluation(), tmpDir, "json");
    expect(path).toMatch(/\.json$/);
    const content = await readFile(path, "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it("should write an HTML file when format is html", async () => {
    const path = await exporter.saveReport(makeEvaluation(), tmpDir, "html");
    expect(path).toMatch(/\.html$/);
    const content = await readFile(path, "utf-8");
    expect(content).toContain("<!DOCTYPE html>");
  });

  it("should create the .coco/reports directory if it does not exist", async () => {
    const path = await exporter.saveReport(makeEvaluation(), tmpDir, "json");
    expect(path).toContain(".coco");
    expect(path).toContain("reports");
  });

  it("should use markdown as the default format", async () => {
    const path = await exporter.saveReport(makeEvaluation(), tmpDir);
    expect(path).toMatch(/\.md$/);
  });
});
