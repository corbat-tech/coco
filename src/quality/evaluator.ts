/**
 * Unified Quality Evaluator - Integrates all real analyzers
 * Combines analyzer results; a failed measurement cannot be reported as a valid score.
 */

import { CoverageAnalyzer } from "./analyzers/coverage.js";
import { CompositeSecurityScanner } from "./analyzers/security.js";
import { ComplexityAnalyzer, DuplicationAnalyzer } from "./analyzers/complexity.js";
import { CorrectnessAnalyzer } from "./analyzers/correctness.js";
import { CompletenessAnalyzer } from "./analyzers/completeness.js";
import { RobustnessAnalyzer } from "./analyzers/robustness.js";
import { TestQualityAnalyzer } from "./analyzers/test-quality.js";
import { DocumentationAnalyzer } from "./analyzers/documentation.js";
import { StyleAnalyzer } from "./analyzers/style.js";
import { ReadabilityAnalyzer } from "./analyzers/readability.js";
import { MaintainabilityAnalyzer } from "./analyzers/maintainability.js";
import type {
  QualityScores,
  QualityDimensions,
  QualityEvaluation,
  QualityMeasurement,
} from "./types.js";
import { loadProjectConfig } from "../config/project-config.js";
import { resolvedWeights, resolvedThresholds } from "./quality-bridge.js";
import { createQualitySnapshot } from "./snapshot.js";
import { parse } from "@typescript-eslint/typescript-estree";
import { resolve, relative, isAbsolute } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { glob } from "glob";
import { type DimensionRegistry } from "./dimension-registry.js";
import { registerJavaAnalyzers } from "./analyzers/java/index.js";
import { registerReactAnalyzers } from "./analyzers/react/index.js";
import { createDefaultRegistry } from "./dimension-registry.js";

/**
 * Unified Quality Evaluator
 * Combines all 12 analyzers for real quality measurement
 */
export class QualityEvaluator {
  private coverageAnalyzer: CoverageAnalyzer;
  private securityScanner: CompositeSecurityScanner;
  private complexityAnalyzer: ComplexityAnalyzer;
  private duplicationAnalyzer: DuplicationAnalyzer;
  private correctnessAnalyzer: CorrectnessAnalyzer;
  private completenessAnalyzer: CompletenessAnalyzer;
  private robustnessAnalyzer: RobustnessAnalyzer;
  private testQualityAnalyzer: TestQualityAnalyzer;
  private documentationAnalyzer: DocumentationAnalyzer;
  private styleAnalyzer: StyleAnalyzer;
  private readabilityAnalyzer: ReadabilityAnalyzer;
  private maintainabilityAnalyzer: MaintainabilityAnalyzer;

  constructor(
    private projectPath: string,
    useSnyk: boolean = false,
    _registry?: DimensionRegistry,
  ) {
    this.coverageAnalyzer = new CoverageAnalyzer(projectPath);
    this.securityScanner = new CompositeSecurityScanner(projectPath, useSnyk);
    this.complexityAnalyzer = new ComplexityAnalyzer(projectPath);
    this.duplicationAnalyzer = new DuplicationAnalyzer(projectPath);
    this.correctnessAnalyzer = new CorrectnessAnalyzer(projectPath);
    this.completenessAnalyzer = new CompletenessAnalyzer(projectPath);
    this.robustnessAnalyzer = new RobustnessAnalyzer(projectPath);
    this.testQualityAnalyzer = new TestQualityAnalyzer(projectPath);
    this.documentationAnalyzer = new DocumentationAnalyzer(projectPath);
    this.styleAnalyzer = new StyleAnalyzer(projectPath);
    this.readabilityAnalyzer = new ReadabilityAnalyzer(projectPath);
    this.maintainabilityAnalyzer = new MaintainabilityAnalyzer(projectPath);
  }

  /**
   * Evaluate quality across all 12 dimensions
   * Rejects incomplete evaluation instead of silently replacing failed measurements.
   */
  async evaluate(files?: string[]): Promise<QualityEvaluation> {
    const startTime = performance.now();
    const snapshot = await createQualitySnapshot(this.projectPath);
    const root = await realpath(this.projectPath);
    const targetFiles = await Promise.all(
      (files ?? (await this.findSourceFiles())).map(async (file) =>
        realpath(resolve(this.projectPath, file)).catch(() => {
          throw new Error("Quality evaluation incomplete: source read failed");
        }),
      ),
    );
    if (
      targetFiles.some((file) => {
        const path = relative(root, file);
        return (
          path === ".." || path.startsWith("../") || path.startsWith("..\\") || isAbsolute(path)
        );
      })
    )
      throw new Error("Quality evaluation incomplete: source outside project");
    if (targetFiles.some((file) => !(relative(root, file).replaceAll("\\", "/") in snapshot.files)))
      throw new Error(
        "Quality evaluation incomplete: selected source is outside snapshot coverage",
      );
    const fileContents = await Promise.all(
      targetFiles.map(async (path) => ({
        path,
        content: await readFile(path, "utf8").catch(() => {
          throw new Error("Quality evaluation incomplete: source read failed");
        }),
      })),
    );
    let parseFailure = false;
    for (const file of fileContents) {
      try {
        parse(file.content, { jsx: /\.[jt]sx$/.test(file.path) });
      } catch {
        parseFailure = true;
      }
    }
    const projectConfig = await loadProjectConfig(this.projectPath);
    const weights = resolvedWeights(projectConfig);
    const thresholds = resolvedThresholds(projectConfig);
    const dimensions = Object.fromEntries(
      Object.keys(weights).map((key) => [key, 0]),
    ) as unknown as QualityDimensions;
    const measurements = {} as Record<keyof QualityDimensions, QualityMeasurement>;
    const issues: QualityEvaluation["issues"] = [];
    const supported =
      targetFiles.length > 0 && targetFiles.every((file) => /\.[cm]?[jt]sx?$/.test(file));
    const measure = async <T>(
      dimension: keyof QualityDimensions,
      run: () => Promise<T>,
      score: (result: T) => number | null,
      reason: string,
      missingState: "unavailable" | "not_applicable" = "unavailable",
    ): Promise<void> => {
      const measurement: QualityMeasurement = {
        state: "unavailable",
        score: null,
        reason,
        evidence: [],
        effectiveWeight: 0,
      };
      measurements[dimension] = measurement;
      if (!supported) {
        measurement.reason =
          "No supported JavaScript/TypeScript source files; language-specific certification unavailable";
        return;
      }
      try {
        if (
          parseFailure &&
          !["testCoverage", "correctness", "style", "security"].includes(dimension)
        )
          throw new Error("Source parsing failed; static measurement incomplete");
        const result = await run();
        const value = score(result);
        measurement.evidence = [JSON.stringify(result)];
        if (value === null) {
          measurement.state = missingState;
          return;
        }
        if (!Number.isFinite(value) || value < 0 || value > 100)
          throw new Error("Invalid analyzer score");
        measurement.state = "measured";
        measurement.score = value;
        measurement.evidence = [JSON.stringify(result)];
        dimensions[dimension] = value;
      } catch {
        measurement.state = "error";
        measurement.reason = `${dimension} analysis failed; no measurement available`;
      }
    };
    // Baseline heuristics are explicitly scoped; registry overrides are not certification evidence.
    // Run command-backed checks sequentially to avoid concurrent test/report writers.
    await measure(
      "testCoverage",
      () => this.coverageAnalyzer.analyzeFresh(),
      (r) => (r.lines.total > 0 ? r.lines.percentage : null),
      "Fresh line coverage; unavailable when no instrumented lines were measured",
    );
    await measure(
      "correctness",
      () => this.correctnessAnalyzer.analyze(true),
      (r) => {
        if (r.testsFailed > 0 || (!r.buildSuccess && r.buildAvailable !== false))
          issues.push({ dimension: "correctness", severity: "critical", message: r.details });
        return r.testsTotal > 0 && r.buildAvailable !== false ? r.score : null;
      },
      "Executed tests and TypeScript verification; unavailable without parsed tests or tsconfig.json",
    );
    await measure(
      "style",
      () => this.styleAnalyzer.analyze(),
      (r) => (r.linterUsed ? r.score : null),
      "Configured linter output; unavailable without a configured linter",
    );
    await Promise.all([
      measure(
        "security",
        () => this.securityScanner.scan(fileContents),
        (r) => {
          for (const vuln of r.vulnerabilities)
            issues.push({
              dimension: "security",
              severity: vuln.severity === "critical" ? "critical" : "major",
              message: `${vuln.type}: ${vuln.description}`,
              file: vuln.location.file,
              line: vuln.location.line,
            });
          return r.score;
        },
        "Pattern scan of selected source; not a guarantee of absence of vulnerabilities or dependency audit unless Snyk requested",
      ),
      measure(
        "complexity",
        () => this.complexityAnalyzer.analyze(targetFiles),
        (r) => (r.totalFunctions === 0 ? null : r.score),
        "Static cyclomatic complexity; not applicable when parsed source has no functions",
        "not_applicable",
      ),
      measure(
        "duplication",
        () => this.duplicationAnalyzer.analyze(targetFiles),
        (r) => {
          if (r.percentage > 5)
            issues.push({
              dimension: "duplication",
              severity: "minor",
              message: `${r.percentage.toFixed(1)}% code duplication detected`,
            });
          return Math.max(0, 100 - r.percentage);
        },
        "Static duplicated-line heuristic",
      ),
      measure(
        "completeness",
        () => this.completenessAnalyzer.analyze(targetFiles),
        (r) => r.score,
        "Static structural completeness heuristic; does not verify user requirements",
      ),
      measure(
        "robustness",
        () => this.robustnessAnalyzer.analyze(targetFiles),
        (r) => r.score,
        "Static defensive-code heuristic; does not prove runtime robustness",
      ),
      measure(
        "testQuality",
        async () => {
          const testFiles = await glob("**/*.{test,spec}.{ts,tsx,js,jsx}", {
            cwd: this.projectPath,
            absolute: true,
            ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
          });
          for (const file of testFiles)
            parse(await readFile(file, "utf8"), { jsx: /\.[jt]sx$/.test(file) });
          return this.testQualityAnalyzer.analyze(testFiles);
        },
        (r) => (r.totalTests > 0 ? r.score : null),
        "Static assertion-quality heuristic; unavailable without tests",
      ),
      measure(
        "documentation",
        () => this.documentationAnalyzer.analyze(targetFiles),
        (r) => r.score,
        "Documentation presence and coverage heuristic",
      ),
      measure(
        "readability",
        () => this.readabilityAnalyzer.analyze(targetFiles),
        (r) => r.score,
        "Static readability heuristic",
      ),
      measure(
        "maintainability",
        () => this.maintainabilityAnalyzer.analyze(targetFiles),
        (r) => r.score,
        "Static maintainability heuristic",
      ),
    ]);
    const after = await createQualitySnapshot(this.projectPath);
    const snapshotValid = after.hash === snapshot.hash;
    const complete = Object.values(measurements).every(
      (m) => m.state === "measured" || m.state === "not_applicable",
    );
    const measuredWeight = Object.entries(measurements).reduce(
      (sum, [key, m]) =>
        sum + (m.state === "measured" ? weights[key as keyof QualityDimensions] : 0),
      0,
    );
    let overall = 0;
    for (const [key, m] of Object.entries(measurements)) {
      m.effectiveWeight =
        m.state === "measured" && measuredWeight > 0
          ? weights[key as keyof QualityDimensions] / measuredWeight
          : 0;
      overall += (m.score ?? 0) * m.effectiveWeight;
    }
    // An incomplete report has a useful partial score but cannot authorize acceptance.
    const scores: QualityScores = {
      overall: Math.round(overall),
      dimensions,
      evaluatedAt: new Date(),
      evaluationDurationMs: performance.now() - startTime,
    };
    const meetsMinimum =
      complete &&
      snapshotValid &&
      scores.overall >= Math.max(85, thresholds.minimum.overall) &&
      dimensions.testCoverage >= Math.max(80, thresholds.minimum.testCoverage) &&
      dimensions.security >= 100 &&
      !issues.some((issue) => issue.severity === "critical");
    const meetsTarget =
      meetsMinimum &&
      scores.overall >= thresholds.target.overall &&
      dimensions.testCoverage >= thresholds.target.testCoverage;
    const converged = false;
    return {
      scores,
      measurements,
      snapshot,
      snapshotValid,
      complete,
      passed: meetsMinimum,
      meetsMinimum,
      meetsTarget,
      converged,
      issues,
      suggestions: this.generateSuggestions(dimensions).filter(
        (item) => measurements[item.dimension].state === "measured",
      ),
    };
  }

  /**
   * Generate suggestions for improving quality
   */
  private generateSuggestions(dimensions: QualityDimensions): Array<{
    dimension: keyof QualityDimensions;
    priority: "high" | "medium" | "low";
    description: string;
    estimatedImpact: number;
  }> {
    const suggestions: Array<{
      dimension: keyof QualityDimensions;
      priority: "high" | "medium" | "low";
      description: string;
      estimatedImpact: number;
    }> = [];

    if (dimensions.testCoverage < 80) {
      suggestions.push({
        dimension: "testCoverage",
        priority: "high",
        description: "Increase test coverage to at least 80%",
        estimatedImpact: 80 - dimensions.testCoverage,
      });
    }

    if (dimensions.security < 100) {
      suggestions.push({
        dimension: "security",
        priority: "high",
        description: "Fix security vulnerabilities",
        estimatedImpact: 100 - dimensions.security,
      });
    }

    if (dimensions.correctness < 85) {
      suggestions.push({
        dimension: "correctness",
        priority: "high",
        description: "Fix failing tests and build errors",
        estimatedImpact: 85 - dimensions.correctness,
      });
    }

    if (dimensions.complexity < 80) {
      suggestions.push({
        dimension: "complexity",
        priority: "medium",
        description: "Reduce cyclomatic complexity of complex functions",
        estimatedImpact: Math.min(10, 80 - dimensions.complexity),
      });
    }

    if (dimensions.documentation < 60) {
      suggestions.push({
        dimension: "documentation",
        priority: "medium",
        description: "Add JSDoc comments to exported declarations",
        estimatedImpact: Math.min(15, 60 - dimensions.documentation),
      });
    }

    if (dimensions.testQuality < 70) {
      suggestions.push({
        dimension: "testQuality",
        priority: "medium",
        description: "Replace trivial assertions with meaningful behavioral tests",
        estimatedImpact: Math.min(10, 70 - dimensions.testQuality),
      });
    }

    if (dimensions.duplication < 95) {
      suggestions.push({
        dimension: "duplication",
        priority: "low",
        description: "Reduce code duplication through refactoring",
        estimatedImpact: Math.min(5, 95 - dimensions.duplication),
      });
    }

    return suggestions;
  }

  /**
   * Find source files in project, adapting to the detected language stack.
   */
  private async findSourceFiles(): Promise<string[]> {
    const { access } = await import("node:fs/promises");
    const { join } = await import("node:path");

    // Detect JVM project
    let isJava = false;
    try {
      await access(join(this.projectPath, "pom.xml"));
      isJava = true;
    } catch {
      for (const f of ["build.gradle", "build.gradle.kts"]) {
        try {
          await access(join(this.projectPath, f));
          isJava = true;
          break;
        } catch {
          // not Gradle
        }
      }
    }

    if (isJava) {
      return glob("src/main/java/**/*.java", {
        cwd: this.projectPath,
        absolute: true,
      });
    }

    return glob("**/*.{ts,js,tsx,jsx,mts,cts,mjs,cjs}", {
      cwd: this.projectPath,
      absolute: true,
      ignore: ["**/node_modules/**", "**/*.test.*", "**/*.spec.*", "**/dist/**", "**/build/**"],
    });
  }
}

/**
 * Create quality evaluator instance
 * @deprecated Use {@link createQualityEvaluatorWithRegistry} for language-aware analysis (Java, React).
 * Still appropriate for TypeScript-only projects that do not need the registry overhead.
 */
export function createQualityEvaluator(projectPath: string, useSnyk?: boolean): QualityEvaluator {
  return new QualityEvaluator(projectPath, useSnyk);
}

/**
 * Compatibility factory retaining language registry construction for existing callers.
 * Certification currently uses only the evidence-backed JavaScript/TypeScript baseline.
 * Registry heuristics do not override certified measurements; unsupported languages
 * receive explicit unavailable states until their evidence adapters are verified.
 */
export function createQualityEvaluatorWithRegistry(
  projectPath: string,
  useSnyk?: boolean,
): QualityEvaluator {
  const registry = createDefaultRegistry(projectPath);
  registerJavaAnalyzers(registry, projectPath);
  registerReactAnalyzers(registry, projectPath);
  return new QualityEvaluator(projectPath, useSnyk ?? false, registry);
}
