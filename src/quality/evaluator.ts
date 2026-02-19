/**
 * Unified Quality Evaluator - Integrates all real analyzers
 * All 12 quality dimensions are computed by real analysis — zero hardcoded values
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
import type { QualityScores, QualityDimensions, QualityEvaluation } from "./types.js";
import { DEFAULT_QUALITY_WEIGHTS } from "./types.js";
import { loadProjectConfig } from "../config/project-config.js";
import { resolvedWeights, resolvedThresholds } from "./quality-bridge.js";
import { readFile } from "node:fs/promises";
import { glob } from "glob";
import { type DimensionRegistry } from "./dimension-registry.js";
import { detectProjectLanguage } from "./language-detector.js";
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
    private registry?: DimensionRegistry,
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
   * Every dimension is computed by real static analysis — zero hardcoded values
   */
  async evaluate(files?: string[]): Promise<QualityEvaluation> {
    const startTime = performance.now();

    // Get target files
    const targetFiles = files ?? (await this.findSourceFiles());

    // Read file contents for security scanner
    // Use .catch(() => "") so unreadable files (missing symlinks, permission errors)
    // produce an empty string instead of crashing the entire evaluate() call.
    const fileContents = await Promise.all(
      targetFiles.map(async (file) => ({
        path: file,
        content: await readFile(file, "utf-8").catch(() => ""),
      })),
    );

    // Run all analyzers in parallel
    const [
      coverageResult,
      securityResult,
      complexityResult,
      duplicationResult,
      correctnessResult,
      completenessResult,
      robustnessResult,
      testQualityResult,
      documentationResult,
      styleResult,
      readabilityResult,
      maintainabilityResult,
    ] = await Promise.all([
      this.coverageAnalyzer.analyze().catch(() => null),
      this.securityScanner.scan(fileContents).catch(() => ({ score: 0, vulnerabilities: [] })),
      this.complexityAnalyzer.analyze(targetFiles).catch(() => ({ score: 0, files: [] })),
      this.duplicationAnalyzer.analyze(targetFiles).catch(() => ({ score: 0, percentage: 0 })),
      this.correctnessAnalyzer.analyze().catch(() => ({ score: 0 })),
      this.completenessAnalyzer.analyze(targetFiles).catch(() => ({ score: 0 })),
      this.robustnessAnalyzer.analyze(targetFiles).catch(() => ({ score: 0 })),
      this.testQualityAnalyzer.analyze().catch(() => ({ score: 0 })),
      this.documentationAnalyzer.analyze(targetFiles).catch(() => ({ score: 0 })),
      this.styleAnalyzer.analyze().catch(() => ({ score: 0 })),
      this.readabilityAnalyzer.analyze(targetFiles).catch(() => ({ score: 0 })),
      this.maintainabilityAnalyzer.analyze(targetFiles).catch(() => ({ score: 0 })),
    ]);

    // Calculate dimensions — ALL real, ZERO hardcoded
    const dimensions: QualityDimensions = {
      testCoverage: coverageResult?.lines.percentage ?? 0,
      security: securityResult.score,
      complexity: complexityResult.score,
      duplication: Math.max(0, 100 - duplicationResult.percentage),
      style: styleResult.score,
      readability: readabilityResult.score,
      maintainability: maintainabilityResult.score,
      correctness: correctnessResult.score,
      completeness: completenessResult.score,
      robustness: robustnessResult.score,
      testQuality: testQualityResult.score,
      documentation: documentationResult.score,
    };

    // Apply language-specific registry overrides (Java, React, etc.)
    // Registry analyzer scores take precedence over the generic baseline for detected language.
    // TODO: Skip baseline analyzers for dimensions covered by registry to avoid double execution.
    //       When registry.hasAnalyzers(language) is true, the 12 built-in analyzers above and
    //       the registry analyzers both run — the registry result overwrites the evaluator result
    //       (last-write-wins), making the first run wasted. Skipping the per-dimension calls for
    //       registry-covered languages would halve analysis time for TypeScript/Java/React projects.
    if (this.registry) {
      const { language } = detectProjectLanguage(targetFiles);
      const registryResults = await this.registry.analyze({
        projectPath: this.projectPath,
        files: targetFiles,
        language,
      });
      for (const { dimensionId, result } of registryResults) {
        if (dimensionId in dimensions) {
          (dimensions as unknown as Record<string, number>)[dimensionId] = result.score;
        }
      }
    }

    // Calculate overall weighted score using project config weights (or defaults)
    let projectConfig = null;
    try {
      projectConfig = await loadProjectConfig(this.projectPath);
    } catch {
      // Use defaults if config cannot be loaded (invalid JSON, permission error, etc.)
    }
    const weights = resolvedWeights(projectConfig);
    const overall = Object.entries(dimensions).reduce((sum, [key, value]) => {
      const weight = weights[key as keyof typeof DEFAULT_QUALITY_WEIGHTS] ?? 0;
      return sum + value * weight;
    }, 0);

    const scores: QualityScores = {
      overall: Math.round(overall),
      dimensions,
      evaluatedAt: new Date(),
      evaluationDurationMs: performance.now() - startTime,
    };

    // Generate issues and suggestions
    const issues = this.generateIssues(
      securityResult.vulnerabilities,
      complexityResult,
      duplicationResult,
      correctnessResult,
      styleResult,
      documentationResult,
    );
    const suggestions = this.generateSuggestions(dimensions);

    // Check thresholds using resolved project config thresholds (not hardcoded defaults)
    const thresholds = resolvedThresholds(projectConfig);

    const meetsMinimum =
      scores.overall >= thresholds.minimum.overall &&
      dimensions.testCoverage >= thresholds.minimum.testCoverage &&
      dimensions.security >= thresholds.minimum.security;

    // meetsTarget: UI signal — overall AND testCoverage both reach the target threshold.
    const meetsTarget =
      scores.overall >= thresholds.target.overall &&
      dimensions.testCoverage >= thresholds.target.testCoverage;

    // converged: convergence-loop signal — overall score is at or above the target threshold.
    // In an iterative context the loop additionally checks score delta stability between runs.
    const converged = scores.overall >= thresholds.target.overall;

    return {
      scores,
      meetsMinimum,
      meetsTarget,
      converged,
      issues,
      suggestions,
    };
  }

  /**
   * Generate quality issues from analyzer results
   */
  private generateIssues(
    securityVulns: Array<{
      severity: string;
      type: string;
      location: { file: string; line?: number };
      description: string;
    }>,
    complexityResult: {
      score: number;
      files: Array<{
        file: string;
        functions: Array<{ name: string; complexity: number; line: number }>;
      }>;
    },
    duplicationResult: { percentage: number; duplicateLines?: number; totalLines?: number },
    correctnessResult: { score: number; testsFailed?: number; buildSuccess?: boolean },
    styleResult: { score: number; errors?: number; warnings?: number },
    documentationResult: { score: number; jsdocCoverage?: number },
  ): Array<{
    dimension: keyof QualityDimensions;
    severity: "critical" | "major" | "minor";
    message: string;
    file?: string;
    line?: number;
    suggestion?: string;
  }> {
    const issues: Array<{
      dimension: keyof QualityDimensions;
      severity: "critical" | "major" | "minor";
      message: string;
      file?: string;
      line?: number;
      suggestion?: string;
    }> = [];

    // Security issues
    for (const vuln of securityVulns) {
      issues.push({
        dimension: "security",
        severity:
          vuln.severity === "critical" ? "critical" : vuln.severity === "high" ? "major" : "minor",
        message: `${vuln.type}: ${vuln.description}`,
        file: vuln.location.file,
        line: vuln.location.line,
      });
    }

    // Complexity issues
    for (const file of complexityResult.files) {
      for (const fn of file.functions) {
        if (fn.complexity > 10) {
          issues.push({
            dimension: "complexity",
            severity: "major",
            message: `Function '${fn.name}' has high complexity (${fn.complexity})`,
            file: file.file,
            line: fn.line,
            suggestion: "Refactor into smaller functions or reduce branching",
          });
        }
      }
    }

    // Duplication issues
    if (duplicationResult.percentage > 5) {
      issues.push({
        dimension: "duplication",
        severity: "minor",
        message: `${duplicationResult.percentage.toFixed(1)}% code duplication detected`,
        suggestion: "Extract common code into reusable functions or modules",
      });
    }

    // Correctness issues
    if (correctnessResult.testsFailed != null && correctnessResult.testsFailed > 0) {
      issues.push({
        dimension: "correctness",
        severity: "critical",
        message: `${correctnessResult.testsFailed} tests failing`,
        suggestion: "Fix failing tests to improve correctness score",
      });
    }
    if (correctnessResult.buildSuccess === false) {
      issues.push({
        dimension: "correctness",
        severity: "critical",
        message: "Build/type check failed",
        suggestion: "Fix type errors to pass build verification",
      });
    }

    // Style issues
    if (styleResult.errors != null && styleResult.errors > 0) {
      issues.push({
        dimension: "style",
        severity: "minor",
        message: `${styleResult.errors} linting errors found`,
        suggestion: "Run linter with --fix to auto-correct style issues",
      });
    }

    // Documentation issues
    if (documentationResult.jsdocCoverage !== undefined && documentationResult.jsdocCoverage < 50) {
      issues.push({
        dimension: "documentation",
        severity: "minor",
        message: `Low JSDoc coverage: ${documentationResult.jsdocCoverage?.toFixed(1) ?? 0}%`,
        suggestion: "Add JSDoc comments to exported functions and classes",
      });
    }

    return issues;
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
   * Find source files in project
   */
  private async findSourceFiles(): Promise<string[]> {
    return glob("**/*.{ts,js,tsx,jsx}", {
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
 * Create a quality evaluator pre-configured with language-specific analyzers.
 * Automatically registers Java and React analyzers in the DimensionRegistry.
 * Use this instead of createQualityEvaluator() for multi-language projects.
 * @note Currently runs baseline analyzers AND registry analyzers for each dimension.
 * Registry results take precedence. Performance optimization (skip baseline when registry covers all dims) is tracked as a TODO.
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
