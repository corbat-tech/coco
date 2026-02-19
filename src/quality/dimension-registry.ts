/**
 * Dimension Registry — Plugin Architecture for Quality Analyzers
 *
 * Enables language-specific quality analysis by registering analyzer plugins
 * for each language. The registry automatically selects the correct analyzers
 * based on the detected project language.
 *
 * Usage:
 *   const registry = createDefaultRegistry("/my/project");
 *   const results = await registry.analyze({ projectPath, files, language: "typescript" });
 */

import { readFile } from "node:fs/promises";
import type { LanguageId } from "./language-detector.js";
import type { QualityDimensions, QualityIssue } from "./types.js";
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

/**
 * Input passed to each analyzer
 */
export interface AnalyzerInput {
  /** Absolute path to the project root */
  projectPath: string;
  /** Source files to analyze */
  files: string[];
  /** Detected language of the project */
  language: LanguageId;
}

/**
 * Result from a single dimension analyzer
 */
export interface AnalyzerResult {
  /** Quality score 0-100 for this dimension */
  score: number;
  /** Issues found during analysis */
  issues: QualityIssue[];
  /** Optional human-readable detail string */
  details?: string;
}

/**
 * Combined result: dimension → analyzer result
 */
export interface DimensionAnalysisResult {
  dimensionId: string;
  result: AnalyzerResult;
}

/**
 * A pluggable quality dimension analyzer
 */
export interface DimensionAnalyzer {
  /**
   * The quality dimension this analyzer measures.
   * Must correspond to a key in QualityDimensions.
   */
  dimensionId: keyof QualityDimensions | string;

  /**
   * Language this analyzer supports.
   * Use "all" to register a universal analyzer that runs for any language.
   */
  language: LanguageId | "all";

  /**
   * Run the analysis and return a score + issues
   */
  analyze(input: AnalyzerInput): Promise<AnalyzerResult>;
}

/**
 * Registry that stores and retrieves quality dimension analyzers by language.
 * Supports language-specific analyzers and universal ("all") analyzers.
 */
export class DimensionRegistry {
  private analyzers: DimensionAnalyzer[] = [];

  /**
   * Register a dimension analyzer plugin.
   * If an analyzer for the same (language, dimensionId) pair already exists,
   * it is replaced — preventing order-dependent duplicate accumulation.
   */
  register(analyzer: DimensionAnalyzer): void {
    const existing = this.analyzers.findIndex(
      (a) => a.language === analyzer.language && a.dimensionId === analyzer.dimensionId,
    );
    if (existing !== -1) {
      this.analyzers[existing] = analyzer; // replace, don't accumulate
    } else {
      this.analyzers.push(analyzer);
    }
  }

  /**
   * Get all analyzers applicable for a given language.
   * Includes both language-specific analyzers and "all" analyzers.
   *
   * @param language - Target language
   * @param dimensionId - Optional filter for a specific dimension
   */
  getAnalyzers(language: LanguageId, dimensionId?: string): DimensionAnalyzer[] {
    return this.analyzers.filter(
      (a) =>
        (a.language === language || a.language === "all") &&
        (dimensionId === undefined || a.dimensionId === dimensionId),
    );
  }

  /**
   * Check if any analyzers are registered for a given language
   * (includes "all" analyzers)
   */
  hasAnalyzers(language: LanguageId): boolean {
    return this.analyzers.some((a) => a.language === language || a.language === "all");
  }

  /**
   * Get all languages that have registered analyzers
   * (excludes the "all" pseudo-language)
   */
  getSupportedLanguages(): LanguageId[] {
    const languages = new Set<LanguageId>();
    for (const a of this.analyzers) {
      if (a.language !== "all") {
        languages.add(a.language as LanguageId);
      }
    }
    return Array.from(languages);
  }

  /**
   * Run all matching analyzers for the given input and return combined results.
   * Analyzers run in parallel for performance.
   */
  async analyze(input: AnalyzerInput): Promise<DimensionAnalysisResult[]> {
    const matching = this.getAnalyzers(input.language);
    if (!matching.length) return [];

    const settled = await Promise.allSettled(
      matching.map((analyzer) =>
        analyzer.analyze(input).then((result) => ({ dimensionId: analyzer.dimensionId, result })),
      ),
    );

    return settled
      .filter((s): s is PromiseFulfilledResult<DimensionAnalysisResult> => {
        if (s.status === "rejected") {
          // Log but do not abort — partial results are better than none
          process.stderr.write(`[DimensionRegistry] Analyzer failed: ${String(s.reason)}\n`);
        }
        return s.status === "fulfilled";
      })
      .map((s) => s.value);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Default registry factory
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Wraps existing TS/JS quality analyzers as DimensionAnalyzer plugins.
 * This bridges the existing QualityEvaluator analyzers into the registry.
 */
function wrapAnalyzer(
  dimensionId: keyof QualityDimensions,
  language: LanguageId | "all",
  analyzerFn: (input: AnalyzerInput) => Promise<{ score: number; issues?: QualityIssue[] }>,
): DimensionAnalyzer {
  return {
    dimensionId,
    language,
    async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
      const raw = await analyzerFn(input);
      return {
        score: raw.score,
        issues: raw.issues ?? [],
      };
    },
  };
}

/**
 * Create the default registry pre-populated with all TypeScript/JavaScript
 * quality analyzers (wraps existing QualityEvaluator analyzers).
 *
 * Java and React analyzers are available via registerJavaAnalyzers / registerReactAnalyzers.
 */
export function createDefaultRegistry(projectPath: string): DimensionRegistry {
  const registry = new DimensionRegistry();

  // Instantiate the existing analyzers
  const coverageAnalyzer = new CoverageAnalyzer(projectPath);
  const securityScanner = new CompositeSecurityScanner(projectPath, false);
  const complexityAnalyzer = new ComplexityAnalyzer(projectPath);
  const duplicationAnalyzer = new DuplicationAnalyzer(projectPath);
  const correctnessAnalyzer = new CorrectnessAnalyzer(projectPath);
  const completenessAnalyzer = new CompletenessAnalyzer(projectPath);
  const robustnessAnalyzer = new RobustnessAnalyzer(projectPath);
  const testQualityAnalyzer = new TestQualityAnalyzer(projectPath);
  const documentationAnalyzer = new DocumentationAnalyzer(projectPath);
  const styleAnalyzer = new StyleAnalyzer(projectPath);
  const readabilityAnalyzer = new ReadabilityAnalyzer(projectPath);
  const maintainabilityAnalyzer = new MaintainabilityAnalyzer(projectPath);

  // Languages for the baseline TS/JS analyzers — all 12 dimensions
  const baseLangs: Array<LanguageId | "all"> = ["typescript", "javascript"];

  // React variants get 9 baseline dimensions.
  // correctness, robustness, and style are intentionally excluded here:
  // registerReactAnalyzers() provides React-specific implementations for those 3.
  const reactLangs: Array<LanguageId | "all"> = ["react-typescript", "react-javascript"];

  for (const lang of baseLangs) {
    registry.register(
      wrapAnalyzer("correctness", lang, async () => {
        const r = await correctnessAnalyzer.analyze();
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("completeness", lang, async (input) => {
        const r = await completenessAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("robustness", lang, async (input) => {
        const r = await robustnessAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("readability", lang, async (input) => {
        const r = await readabilityAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("maintainability", lang, async (input) => {
        const r = await maintainabilityAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("complexity", lang, async (input) => {
        const r = await complexityAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("duplication", lang, async (input) => {
        const r = await duplicationAnalyzer.analyze(input.files);
        // DuplicationResult has `percentage` (not `score`); convert: lower % → higher score
        return { score: Math.max(0, 100 - r.percentage) };
      }),
    );

    registry.register(
      wrapAnalyzer("testCoverage", lang, async () => {
        const r = await coverageAnalyzer.analyze();
        // CoverageMetrics has lines.percentage; null means no coverage data
        return { score: r?.lines.percentage ?? 0 };
      }),
    );

    registry.register(
      wrapAnalyzer("testQuality", lang, async () => {
        const r = await testQualityAnalyzer.analyze();
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("security", lang, async (input) => {
        const fileContents = await Promise.all(
          input.files.map(async (f) => ({
            path: f,
            content: await readFile(f, "utf-8").catch(() => ""),
          })),
        );
        const r = await securityScanner.scan(fileContents);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("documentation", lang, async (input) => {
        const r = await documentationAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("style", lang, async () => {
        const r = await styleAnalyzer.analyze();
        return { score: r.score };
      }),
    );
  }

  for (const lang of reactLangs) {
    // Skip correctness, robustness, style — registerReactAnalyzers() owns those for React
    registry.register(
      wrapAnalyzer("completeness", lang, async (input) => {
        const r = await completenessAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("readability", lang, async (input) => {
        const r = await readabilityAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("maintainability", lang, async (input) => {
        const r = await maintainabilityAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("complexity", lang, async (input) => {
        const r = await complexityAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("duplication", lang, async (input) => {
        const r = await duplicationAnalyzer.analyze(input.files);
        // DuplicationResult has `percentage` (not `score`); convert: lower % → higher score
        return { score: Math.max(0, 100 - r.percentage) };
      }),
    );

    registry.register(
      wrapAnalyzer("testCoverage", lang, async () => {
        const r = await coverageAnalyzer.analyze();
        // CoverageMetrics has lines.percentage; null means no coverage data
        return { score: r?.lines.percentage ?? 0 };
      }),
    );

    registry.register(
      wrapAnalyzer("testQuality", lang, async () => {
        const r = await testQualityAnalyzer.analyze();
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("security", lang, async (input) => {
        const fileContents = await Promise.all(
          input.files.map(async (f) => ({
            path: f,
            content: await readFile(f, "utf-8").catch(() => ""),
          })),
        );
        const r = await securityScanner.scan(fileContents);
        return { score: r.score };
      }),
    );

    registry.register(
      wrapAnalyzer("documentation", lang, async (input) => {
        const r = await documentationAnalyzer.analyze(input.files);
        return { score: r.score };
      }),
    );
  }

  return registry;
}
