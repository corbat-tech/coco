/**
 * Code Reviewer for the COMPLETE phase
 *
 * Reviews generated code and calculates quality scores
 */

import type {
  CodeReviewResult,
  ReviewIssue,
  ReviewSuggestion,
  TestExecutionResult,
  QualityConfig,
} from "./types.js";
import type { QualityScores, QualityDimensions } from "../../quality/types.js";
import type { LLMProvider } from "../../providers/types.js";
import {
  CODE_REVIEW_SYSTEM_PROMPT,
  REVIEW_CODE_PROMPT,
  ANALYZE_FAILURES_PROMPT,
  fillPrompt,
} from "./prompts.js";
// PhaseError not currently used but kept for future error handling

/**
 * Code Reviewer
 */
export class CodeReviewer {
  private llm: LLMProvider;
  private config: QualityConfig;

  constructor(llm: LLMProvider, config: QualityConfig) {
    this.llm = llm;
    this.config = config;
  }

  /**
   * Review code and generate quality scores
   */
  async review(
    taskTitle: string,
    taskDescription: string,
    files: Array<{ path: string; content: string }>,
    testResults: TestExecutionResult
  ): Promise<CodeReviewResult> {
    const filesToReview = files
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
      .join("\n\n");

    const prompt = fillPrompt(REVIEW_CODE_PROMPT, {
      taskTitle,
      taskDescription,
      filesToReview,
      testResults: JSON.stringify(testResults),
    });

    const response = await this.llm.chat([
      { role: "system", content: CODE_REVIEW_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    return this.parseReviewResponse(response.content, testResults);
  }

  /**
   * Analyze test failures and suggest fixes
   */
  async analyzeFailures(
    failures: Array<{ name: string; message: string; stack?: string }>,
    sourceCode: string
  ): Promise<Array<{
    testName: string;
    rootCause: string;
    suggestedFix: string;
    confidence: number;
  }>> {
    const prompt = fillPrompt(ANALYZE_FAILURES_PROMPT, {
      failures: JSON.stringify(failures),
      sourceCode,
    });

    const response = await this.llm.chat([
      { role: "system", content: CODE_REVIEW_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    try {
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        analyses?: Array<{
          testName?: string;
          rootCause?: string;
          suggestedFix?: string;
          confidence?: number;
        }>;
      };

      return (parsed.analyses || []).map((a) => ({
        testName: a.testName || "",
        rootCause: a.rootCause || "",
        suggestedFix: a.suggestedFix || "",
        confidence: a.confidence || 50,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Check if review passes quality thresholds
   */
  checkPassed(scores: QualityScores): boolean {
    return (
      scores.overall >= this.config.minScore &&
      scores.dimensions.testCoverage >= this.config.minCoverage
    );
  }

  /**
   * Get critical issues from review
   */
  getCriticalIssues(issues: ReviewIssue[]): ReviewIssue[] {
    return issues.filter((i) => i.severity === "critical");
  }

  /**
   * Get high-priority suggestions
   */
  getHighPrioritySuggestions(suggestions: ReviewSuggestion[]): ReviewSuggestion[] {
    return suggestions.filter((s) => s.priority === "high");
  }

  /**
   * Parse review response from LLM
   */
  private parseReviewResponse(
    content: string,
    testResults: TestExecutionResult
  ): CodeReviewResult {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        passed?: boolean;
        scores?: Partial<QualityDimensions>;
        issues?: Array<{
          severity?: string;
          category?: string;
          message?: string;
          file?: string;
          line?: number;
          suggestion?: string;
        }>;
        suggestions?: Array<{
          type?: string;
          description?: string;
          priority?: string;
          impact?: number;
        }>;
      };

      const dimensions = this.normalizeDimensions(parsed.scores || {});
      const overall = this.calculateOverallScore(dimensions);

      const scores: QualityScores = {
        overall,
        dimensions,
        evaluatedAt: new Date(),
        evaluationDurationMs: 0,
      };

      const issues = (parsed.issues || []).map((i) => this.normalizeIssue(i));
      const suggestions = (parsed.suggestions || []).map((s) =>
        this.normalizeSuggestion(s)
      );

      // Override testCoverage with actual coverage
      if (testResults.coverage) {
        dimensions.testCoverage = testResults.coverage.lines;
      }

      const passed = this.checkPassed(scores);

      return {
        passed,
        scores,
        issues,
        suggestions,
        testResults,
      };
    } catch {
      // Return a default failed review if parsing fails
      return this.createDefaultReview(testResults);
    }
  }

  /**
   * Normalize dimension scores
   */
  private normalizeDimensions(
    data: Partial<QualityDimensions>
  ): QualityDimensions {
    return {
      correctness: this.normalizeScore(data.correctness),
      completeness: this.normalizeScore(data.completeness),
      robustness: this.normalizeScore(data.robustness),
      readability: this.normalizeScore(data.readability),
      maintainability: this.normalizeScore(data.maintainability),
      complexity: this.normalizeScore(data.complexity),
      duplication: this.normalizeScore(data.duplication),
      testCoverage: this.normalizeScore(data.testCoverage),
      testQuality: this.normalizeScore(data.testQuality),
      security: this.normalizeScore(data.security),
      documentation: this.normalizeScore(data.documentation),
      style: this.normalizeScore(data.style),
    };
  }

  /**
   * Normalize a single score
   */
  private normalizeScore(value?: number): number {
    if (value === undefined || value === null) return 50;
    return Math.max(0, Math.min(100, value));
  }

  /**
   * Calculate overall score from dimensions
   */
  private calculateOverallScore(dimensions: QualityDimensions): number {
    const weights: QualityDimensions = {
      correctness: 0.15,
      completeness: 0.10,
      robustness: 0.10,
      readability: 0.10,
      maintainability: 0.10,
      complexity: 0.08,
      duplication: 0.07,
      testCoverage: 0.10,
      testQuality: 0.05,
      security: 0.08,
      documentation: 0.04,
      style: 0.03,
    };

    let total = 0;
    for (const key of Object.keys(weights) as (keyof QualityDimensions)[]) {
      total += dimensions[key] * weights[key];
    }

    return Math.round(total);
  }

  /**
   * Normalize an issue
   */
  private normalizeIssue(data: {
    severity?: string;
    category?: string;
    message?: string;
    file?: string;
    line?: number;
    suggestion?: string;
  }): ReviewIssue {
    return {
      severity: this.normalizeSeverity(data.severity),
      category: this.normalizeCategory(data.category),
      message: data.message || "",
      file: data.file,
      line: data.line,
      suggestion: data.suggestion,
    };
  }

  /**
   * Normalize a suggestion
   */
  private normalizeSuggestion(data: {
    type?: string;
    description?: string;
    priority?: string;
    impact?: number;
  }): ReviewSuggestion {
    return {
      type: this.normalizeSuggestionType(data.type),
      description: data.description || "",
      priority: this.normalizePriority(data.priority),
      impact: data.impact || 5,
    };
  }

  /**
   * Normalize severity
   */
  private normalizeSeverity(
    value?: string
  ): "critical" | "major" | "minor" | "info" {
    const normalized = value?.toLowerCase();
    if (normalized === "critical") return "critical";
    if (normalized === "major") return "major";
    if (normalized === "minor") return "minor";
    return "info";
  }

  /**
   * Normalize category
   */
  private normalizeCategory(value?: string): keyof QualityDimensions {
    const normalized = value?.toLowerCase();
    const valid: (keyof QualityDimensions)[] = [
      "correctness",
      "completeness",
      "robustness",
      "readability",
      "maintainability",
      "complexity",
      "duplication",
      "testCoverage",
      "testQuality",
      "security",
      "documentation",
      "style",
    ];

    for (const v of valid) {
      if (normalized === v.toLowerCase()) return v;
    }

    return "correctness";
  }

  /**
   * Normalize suggestion type
   */
  private normalizeSuggestionType(
    value?: string
  ): "improvement" | "refactor" | "test" | "documentation" {
    const normalized = value?.toLowerCase();
    if (normalized === "improvement") return "improvement";
    if (normalized === "refactor") return "refactor";
    if (normalized === "test") return "test";
    if (normalized === "documentation") return "documentation";
    return "improvement";
  }

  /**
   * Normalize priority
   */
  private normalizePriority(value?: string): "high" | "medium" | "low" {
    const normalized = value?.toLowerCase();
    if (normalized === "high") return "high";
    if (normalized === "low") return "low";
    return "medium";
  }

  /**
   * Create a default failed review
   */
  private createDefaultReview(testResults: TestExecutionResult): CodeReviewResult {
    return {
      passed: false,
      scores: {
        overall: 0,
        dimensions: {
          correctness: 0,
          completeness: 0,
          robustness: 0,
          readability: 0,
          maintainability: 0,
          complexity: 0,
          duplication: 0,
          testCoverage: testResults.coverage?.lines || 0,
          testQuality: 0,
          security: 0,
          documentation: 0,
          style: 0,
        },
        evaluatedAt: new Date(),
        evaluationDurationMs: 0,
      },
      issues: [
        {
          severity: "critical",
          category: "correctness",
          message: "Failed to review code",
        },
      ],
      suggestions: [],
      testResults,
    };
  }
}

/**
 * Create a code reviewer
 */
export function createCodeReviewer(
  llm: LLMProvider,
  config: QualityConfig
): CodeReviewer {
  return new CodeReviewer(llm, config);
}
