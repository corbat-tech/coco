/**
 * Integration tests — Quality Analysis Pipeline
 *
 * Tests the full quality pipeline using real fixture projects:
 *   .coco.config.json → ProjectConfig → Java/React analyzers → report export
 *
 * These tests run against static fixture files (no LLM calls).
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  loadProjectConfig,
  validateProjectConfig,
} from "../../src/config/project-config.js";
import {
  resolvedThresholds,
  resolvedWeights,
  resolvedConvergenceOptions,
} from "../../src/quality/quality-bridge.js";
import {
  JavaComplexityAnalyzer,
  JavaSecurityAnalyzer,
  JavaDocumentationAnalyzer,
  registerJavaAnalyzers,
} from "../../src/quality/analyzers/java/index.js";
import {
  ReactComponentAnalyzer,
  ReactA11yAnalyzer,
  ReactHookAnalyzer,
  registerReactAnalyzers,
} from "../../src/quality/analyzers/react/index.js";
import { DimensionRegistry } from "../../src/quality/dimension-registry.js";
import { QualityReportExporter } from "../../src/quality/report-exporter.js";
import { QualityFormatter } from "../../src/quality/quality-formatter.js";
import { detectProjectLanguage } from "../../src/quality/language-detector.js";

// ──────────────────────────────────────────────────────────────────────────────
// Fixture paths
// ──────────────────────────────────────────────────────────────────────────────

const FIXTURES_DIR = join(fileURLToPath(new URL(import.meta.url)), "../../fixtures");
const JAVA_PROJECT = join(FIXTURES_DIR, "java-project");
const REACT_PROJECT = join(FIXTURES_DIR, "react-project");

// ──────────────────────────────────────────────────────────────────────────────
// Project config loading
// ──────────────────────────────────────────────────────────────────────────────

describe("ProjectConfig loading from fixtures", () => {
  it("should load java-project .coco.config.json", async () => {
    const config = await loadProjectConfig(JAVA_PROJECT);
    expect(config).not.toBeNull();
    expect(config?.name).toBe("java-fixture-project");
    expect(config?.language).toBe("java");
  });

  it("should load react-project .coco.config.json", async () => {
    const config = await loadProjectConfig(REACT_PROJECT);
    expect(config).not.toBeNull();
    expect(config?.name).toBe("react-fixture-project");
    expect(config?.language).toBe("react-typescript");
  });

  it("java project config should pass schema validation", async () => {
    const raw = JSON.parse(
      await readFile(join(JAVA_PROJECT, ".coco.config.json"), "utf-8"),
    ) as unknown;
    const result = validateProjectConfig(raw);
    expect(result.success).toBe(true);
  });

  it("react project config should pass schema validation", async () => {
    const raw = JSON.parse(
      await readFile(join(REACT_PROJECT, ".coco.config.json"), "utf-8"),
    ) as unknown;
    const result = validateProjectConfig(raw);
    expect(result.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Quality bridge — resolved thresholds from fixture configs
// ──────────────────────────────────────────────────────────────────────────────

describe("Quality bridge with fixture configs", () => {
  it("should resolve java-project minScore to 70", async () => {
    const config = await loadProjectConfig(JAVA_PROJECT);
    const thresholds = resolvedThresholds(config);
    expect(thresholds.minimum.overall).toBe(70);
  });

  it("should resolve java-project maxIterations to 5", async () => {
    const config = await loadProjectConfig(JAVA_PROJECT);
    const thresholds = resolvedThresholds(config);
    expect(thresholds.maxIterations).toBe(5);
  });

  it("should resolve convergence options from java-project config", async () => {
    const config = await loadProjectConfig(JAVA_PROJECT);
    const opts = resolvedConvergenceOptions(config);
    expect(opts.minScore).toBe(70);
    expect(opts.maxIterations).toBe(5);
  });

  it("should return default weights when no weight overrides in config", async () => {
    const config = await loadProjectConfig(JAVA_PROJECT);
    const weights = resolvedWeights(config);
    // Should sum to 1.0
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Language detection on fixture projects
// ──────────────────────────────────────────────────────────────────────────────

describe("Language detection on fixture projects", () => {
  it("should detect java files in java-project", () => {
    const javaFiles = [
      join(JAVA_PROJECT, "src/main/java/com/example/UserService.java"),
      join(JAVA_PROJECT, "src/main/java/com/example/VulnerableService.java"),
    ];
    const result = detectProjectLanguage(javaFiles);
    expect(result.language).toBe("java");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should detect react-typescript files in react-project", () => {
    const reactFiles = [
      join(REACT_PROJECT, "src/UserCard.tsx"),
      join(REACT_PROJECT, "src/BadComponent.tsx"),
    ];
    const result = detectProjectLanguage(reactFiles);
    expect(result.language).toBe("react-typescript");
    expect(result.confidence).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Java analyzer pipeline with fixture files
// ──────────────────────────────────────────────────────────────────────────────

describe("Java analyzer pipeline with fixture files", () => {
  const userServicePath = join(
    JAVA_PROJECT,
    "src/main/java/com/example/UserService.java",
  );
  const vulnerablePath = join(
    JAVA_PROJECT,
    "src/main/java/com/example/VulnerableService.java",
  );

  it("should detect security vulnerabilities in VulnerableService.java", async () => {
    const analyzer = new JavaSecurityAnalyzer(JAVA_PROJECT);
    const content = await readFile(vulnerablePath, "utf-8");
    const result = await analyzer.analyzeContent([{ path: vulnerablePath, content }]);
    expect(result.vulnerabilities.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
  });

  it("should return perfect security score for UserService.java", async () => {
    const analyzer = new JavaSecurityAnalyzer(JAVA_PROJECT);
    const content = await readFile(userServicePath, "utf-8");
    const result = await analyzer.analyzeContent([{ path: userServicePath, content }]);
    expect(result.vulnerabilities).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it("should detect good documentation in UserService.java", async () => {
    const analyzer = new JavaDocumentationAnalyzer(JAVA_PROJECT);
    const content = await readFile(userServicePath, "utf-8");
    const result = await analyzer.analyzeContent([{ path: userServicePath, content }]);
    expect(result.javadocCoverage).toBeGreaterThan(0.5);
    expect(result.score).toBeGreaterThan(70);
  });

  it("should return non-trivial complexity for VulnerableService.java", async () => {
    const analyzer = new JavaComplexityAnalyzer(JAVA_PROJECT);
    const content = await readFile(vulnerablePath, "utf-8");
    const result = await analyzer.analyzeContent([{ path: vulnerablePath, content }]);
    expect(result.totalMethods).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// React analyzer pipeline with fixture files
// ──────────────────────────────────────────────────────────────────────────────

describe("React analyzer pipeline with fixture files", () => {
  const userCardPath = join(REACT_PROJECT, "src/UserCard.tsx");
  const badComponentPath = join(REACT_PROJECT, "src/BadComponent.tsx");

  it("should score UserCard.tsx highly for component quality", async () => {
    const analyzer = new ReactComponentAnalyzer(REACT_PROJECT);
    const content = await readFile(userCardPath, "utf-8");
    const result = analyzer.analyzeContent([{ path: userCardPath, content }]);
    expect(result.score).toBeGreaterThan(70);
  });

  it("should detect missing key in BadComponent.tsx", async () => {
    const analyzer = new ReactComponentAnalyzer(REACT_PROJECT);
    const content = await readFile(badComponentPath, "utf-8");
    const result = analyzer.analyzeContent([{ path: badComponentPath, content }]);
    const keyIssue = result.issues.find((i) => i.rule.toLowerCase().includes("key"));
    expect(keyIssue).toBeDefined();
  });

  it("should detect a11y violations in BadComponent.tsx", async () => {
    const analyzer = new ReactA11yAnalyzer(REACT_PROJECT);
    const content = await readFile(badComponentPath, "utf-8");
    const result = analyzer.analyzeContent([{ path: badComponentPath, content }]);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(80);
  });

  it("should score UserCard.tsx well for a11y", async () => {
    const analyzer = new ReactA11yAnalyzer(REACT_PROJECT);
    const content = await readFile(userCardPath, "utf-8");
    const result = analyzer.analyzeContent([{ path: userCardPath, content }]);
    expect(result.score).toBeGreaterThan(70);
  });

  it("should find no hook violations in UserCard.tsx", async () => {
    const analyzer = new ReactHookAnalyzer(REACT_PROJECT);
    const content = await readFile(userCardPath, "utf-8");
    const result = analyzer.analyzeContent([{ path: userCardPath, content }]);
    // UserCard uses hooks correctly
    expect(result.score).toBeGreaterThan(70);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DimensionRegistry integration
// ──────────────────────────────────────────────────────────────────────────────

describe("DimensionRegistry integration", () => {
  it("should register java analyzers and have java language support", () => {
    const registry = new DimensionRegistry();
    registerJavaAnalyzers(registry, JAVA_PROJECT);
    expect(registry.hasAnalyzers("java")).toBe(true);
    expect(registry.hasAnalyzers("typescript")).toBe(false);
  });

  it("should register react analyzers and have react-typescript support", () => {
    const registry = new DimensionRegistry();
    registerReactAnalyzers(registry, REACT_PROJECT);
    expect(registry.hasAnalyzers("react-typescript")).toBe(true);
    expect(registry.hasAnalyzers("java")).toBe(false);
  });

  it("should list all registered languages", () => {
    const registry = new DimensionRegistry();
    registerJavaAnalyzers(registry, JAVA_PROJECT);
    registerReactAnalyzers(registry, REACT_PROJECT);
    const langs = registry.getSupportedLanguages();
    expect(langs).toContain("java");
    expect(langs).toContain("react-typescript");
    expect(langs).toContain("react-javascript");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Report exporter + formatter integration
// ──────────────────────────────────────────────────────────────────────────────

describe("Report exporter and formatter integration", () => {
  function makeMinimalEvaluation() {
    return {
      scores: {
        overall: 82,
        dimensions: {
          correctness: 90, completeness: 85, robustness: 80,
          readability: 78, maintainability: 75, complexity: 70,
          duplication: 92, testCoverage: 75, testQuality: 68,
          security: 100, documentation: 65, style: 88,
        },
        evaluatedAt: new Date("2026-02-19T12:00:00.000Z"),
        evaluationDurationMs: 500,
      },
      meetsMinimum: false,
      meetsTarget: false,
      converged: false,
      issues: [
        { dimension: "testCoverage" as const, severity: "major" as const, message: "Coverage below 80%" },
      ],
      suggestions: [
        { dimension: "testCoverage" as const, priority: "high" as const, description: "Add unit tests", estimatedImpact: 5 },
      ],
    };
  }

  it("formatter.formatSummary should reflect meetsMinimum correctly", () => {
    const evaluation = makeMinimalEvaluation();
    const formatter = new QualityFormatter();
    const summary = formatter.formatSummary(evaluation);
    expect(summary).toContain("FAIL");
    expect(summary).toContain("82");
  });

  it("formatter.formatFull should include all sections", () => {
    const evaluation = makeMinimalEvaluation();
    const formatter = new QualityFormatter();
    const full = formatter.formatFull(evaluation);
    expect(full).toContain("Quality Report");
    expect(full).toContain("testCoverage");
    expect(full).toContain("Add unit tests");
  });

  it("exporter.toJson should produce valid parseable JSON", () => {
    const evaluation = makeMinimalEvaluation();
    const exporter = new QualityReportExporter();
    const json = exporter.toJson(evaluation);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("exporter.toMarkdown should include FAIL and issues", () => {
    const evaluation = makeMinimalEvaluation();
    const exporter = new QualityReportExporter();
    const md = exporter.toMarkdown(evaluation);
    expect(md).toContain("FAIL");
    expect(md).toContain("Coverage below 80%");
  });

  it("exporter.toHtml should produce a valid HTML document", () => {
    const evaluation = makeMinimalEvaluation();
    const exporter = new QualityReportExporter();
    const html = exporter.toHtml(evaluation);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("82/100");
  });
});
