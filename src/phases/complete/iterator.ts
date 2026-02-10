/**
 * Task Iterator for the COMPLETE phase
 *
 * Manages the quality convergence loop for tasks
 */

import type {
  TaskExecutionResult,
  TaskExecutionContext,
  ConvergenceCheck,
  CodeReviewResult,
  ReviewIssue,
  TestExecutionResult,
  GeneratedFile,
  QualityConfig,
} from "./types.js";
import type { TaskVersion, TaskChanges, TaskImprovement, IssueCategory } from "../../types/task.js";
import type { QualityDimensions } from "../../quality/types.js";
import { DEFAULT_QUALITY_WEIGHTS } from "../../quality/types.js";
import { QualityEvaluator } from "../../quality/evaluator.js";
import { CodeGenerator } from "./generator.js";
import { CodeReviewer } from "./reviewer.js";
import type { LLMProvider } from "../../providers/types.js";
import { join } from "node:path";

/**
 * Task Iterator
 *
 * Manages the generate-review-iterate cycle
 */
export class TaskIterator {
  private generator: CodeGenerator;
  private reviewer: CodeReviewer;
  private config: QualityConfig;
  private qualityEvaluator: QualityEvaluator | null = null;

  constructor(llm: LLMProvider, config: QualityConfig, projectPath?: string) {
    this.generator = new CodeGenerator(llm);
    this.reviewer = new CodeReviewer(llm, config);
    this.config = config;
    if (projectPath) {
      this.qualityEvaluator = new QualityEvaluator(projectPath);
    }
  }

  /**
   * Execute a task with quality iteration
   */
  async execute(
    context: TaskExecutionContext,
    runTests: () => Promise<TestExecutionResult>,
    saveFiles: (files: GeneratedFile[]) => Promise<void>,
    onProgress?: (iteration: number, score: number) => void,
  ): Promise<TaskExecutionResult> {
    const versions: TaskVersion[] = [];
    let iteration = 0;
    let lastReview: CodeReviewResult | null = null;
    let currentFiles: GeneratedFile[] = [];
    const scoreHistory: number[] = [];

    try {
      // Generate initial code
      const initial = await this.generator.generate({
        task: context.task,
        context: this.buildContext(context),
        iteration: 0,
      });

      currentFiles = initial.files;
      await saveFiles(currentFiles);

      // Iteration loop
      while (iteration < this.config.maxIterations) {
        iteration++;

        // Run tests
        const testResults = await runTests();

        // Review code
        const review = await this.reviewer.review(
          context.task.title,
          context.task.description,
          currentFiles.map((f) => ({ path: f.path, content: f.content })),
          testResults,
        );

        // Enhance LLM review with real analyzer measurements
        if (this.qualityEvaluator) {
          try {
            const filePaths = currentFiles
              .filter((f) => f.action !== "delete")
              .map((f) => join(context.projectPath, f.path));
            const realScores = await this.qualityEvaluator.evaluate(filePaths);

            // Override all dimensions with real measurements
            const dims = review.scores.dimensions;
            const real = realScores.scores.dimensions;
            dims.testCoverage = real.testCoverage;
            dims.security = real.security;
            dims.complexity = real.complexity;
            dims.duplication = real.duplication;
            dims.style = real.style;
            dims.readability = real.readability;
            dims.maintainability = real.maintainability;
            dims.correctness = real.correctness;
            dims.completeness = real.completeness;
            dims.robustness = real.robustness;
            dims.testQuality = real.testQuality;
            dims.documentation = real.documentation;

            // Recalculate overall with real weights
            review.scores.overall = Math.round(
              Object.entries(dims).reduce((sum, [key, value]) => {
                const weight =
                  DEFAULT_QUALITY_WEIGHTS[key as keyof typeof DEFAULT_QUALITY_WEIGHTS] ?? 0;
                return sum + value * weight;
              }, 0),
            );

            // Merge issues from real analyzers
            for (const issue of realScores.issues) {
              review.issues.push({
                severity: issue.severity,
                category: issue.dimension,
                message: issue.message,
                file: issue.file,
                line: issue.line,
                suggestion: issue.suggestion,
              });
            }
          } catch {
            // If real evaluation fails, continue with LLM-only scores
          }
        }

        // Capture previous review issues before updating lastReview
        const previousIssues = lastReview ? lastReview.issues : [];

        lastReview = review;
        scoreHistory.push(review.scores.overall);

        // Report progress
        if (onProgress) {
          onProgress(iteration, review.scores.overall);
        }

        // Create version snapshot with improvement tracking
        const version = this.createVersion(
          iteration,
          currentFiles,
          review,
          testResults,
          previousIssues,
        );
        versions.push(version);

        // Check if we should stop
        const convergence = this.checkConvergence(scoreHistory, review, iteration);

        if (convergence.converged) {
          return {
            taskId: context.task.id,
            success: true,
            versions,
            finalScore: review.scores.overall,
            converged: true,
            iterations: iteration,
          };
        }

        // Check if we passed quality threshold
        if (this.reviewer.checkPassed(review.scores)) {
          return {
            taskId: context.task.id,
            success: true,
            versions,
            finalScore: review.scores.overall,
            converged: true,
            iterations: iteration,
          };
        }

        // Improve code for next iteration
        const improved = await this.generator.improve(
          this.filesToString(currentFiles),
          review.issues.map((i) => ({
            severity: i.severity,
            message: i.message,
            suggestion: i.suggestion,
          })),
          review.suggestions.map((s) => ({
            description: s.description,
            priority: s.priority,
          })),
          {
            task: context.task,
            context: this.buildContext(context),
            previousCode: this.filesToString(currentFiles),
            feedback: this.buildFeedback(review),
            iteration,
          },
        );

        currentFiles = improved.files;
        await saveFiles(currentFiles);
      }

      // Max iterations reached
      return {
        taskId: context.task.id,
        success: lastReview ? this.reviewer.checkPassed(lastReview.scores) : false,
        versions,
        finalScore: lastReview?.scores.overall || 0,
        converged: false,
        iterations: iteration,
        error: "Max iterations reached without convergence",
      };
    } catch (error) {
      return {
        taskId: context.task.id,
        success: false,
        versions,
        finalScore: 0,
        converged: false,
        iterations: iteration,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if quality has converged
   */
  checkConvergence(
    scoreHistory: number[],
    review: CodeReviewResult,
    iteration: number,
  ): ConvergenceCheck {
    // Not enough iterations
    if (iteration < this.config.minConvergenceIterations) {
      return {
        converged: false,
        reason: "Minimum iterations not reached",
        scoreHistory,
        improvement: 0,
      };
    }

    // Check if above minimum score
    if (review.scores.overall < this.config.minScore) {
      return {
        converged: false,
        reason: `Score ${review.scores.overall} below minimum ${this.config.minScore}`,
        scoreHistory,
        improvement: this.calculateImprovement(scoreHistory),
      };
    }

    // Check if no critical issues
    const criticalIssues = this.reviewer.getCriticalIssues(review.issues);
    if (criticalIssues.length > 0) {
      return {
        converged: false,
        reason: `${criticalIssues.length} critical issues remain`,
        scoreHistory,
        improvement: this.calculateImprovement(scoreHistory),
      };
    }

    // Check if score has stabilized
    const improvement = this.calculateImprovement(scoreHistory);
    if (Math.abs(improvement) < this.config.convergenceThreshold) {
      return {
        converged: true,
        reason: "Score has stabilized",
        scoreHistory,
        improvement,
      };
    }

    // If improvement is negative, something is wrong
    if (improvement < -5) {
      return {
        converged: false,
        reason: "Score is decreasing",
        scoreHistory,
        improvement,
      };
    }

    return {
      converged: false,
      reason: "Still improving",
      scoreHistory,
      improvement,
    };
  }

  /**
   * Calculate improvement from score history
   */
  private calculateImprovement(scoreHistory: number[]): number {
    if (scoreHistory.length < 2) return 0;

    const recent = scoreHistory.slice(-3);
    if (recent.length < 2) return 0;

    const current = recent[recent.length - 1] || 0;
    const previous = recent[recent.length - 2] || 0;

    return current - previous;
  }

  /**
   * Build context string for code generation
   */
  private buildContext(context: TaskExecutionContext): string {
    const parts: string[] = [];

    parts.push(`Project: ${context.projectPath}`);
    parts.push(`Sprint: ${context.sprint.name}`);
    parts.push(`Sprint Goal: ${context.sprint.goal}`);

    if (context.previousVersions.length > 0) {
      parts.push(`Previous Iterations: ${context.previousVersions.length}`);
    }

    return parts.join("\n");
  }

  /**
   * Build feedback string from review
   */
  private buildFeedback(review: CodeReviewResult): string {
    const parts: string[] = [];

    parts.push(`Overall Score: ${review.scores.overall}/100`);

    if (review.issues.length > 0) {
      parts.push(`\nIssues (${review.issues.length}):`);
      for (const issue of review.issues.slice(0, 5)) {
        parts.push(`- [${issue.severity}] ${issue.message}`);
      }
    }

    if (review.suggestions.length > 0) {
      parts.push(`\nSuggestions (${review.suggestions.length}):`);
      for (const suggestion of review.suggestions.slice(0, 3)) {
        parts.push(`- [${suggestion.priority}] ${suggestion.description}`);
      }
    }

    return parts.join("\n");
  }

  /**
   * Convert files array to string
   */
  private filesToString(files: GeneratedFile[]): string {
    return files.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");
  }

  /**
   * Map QualityDimensions key to IssueCategory
   */
  private mapToIssueCategory(key: keyof QualityDimensions): IssueCategory {
    const mapping: Record<keyof QualityDimensions, IssueCategory> = {
      correctness: "correctness",
      completeness: "completeness",
      robustness: "robustness",
      readability: "readability",
      maintainability: "maintainability",
      complexity: "maintainability", // Map complexity to maintainability
      duplication: "maintainability", // Map duplication to maintainability
      testCoverage: "testing",
      testQuality: "testing",
      security: "security",
      documentation: "documentation",
      style: "style",
    };
    return mapping[key];
  }

  /**
   * Detect improvements by comparing current and previous review issues.
   * An improvement is an issue from the previous review that no longer appears
   * in the current review (resolved).
   */
  private detectImprovements(
    currentIssues: ReviewIssue[],
    previousIssues: ReviewIssue[],
  ): TaskImprovement[] {
    if (previousIssues.length === 0) return [];

    const currentIssueKeys = new Set(currentIssues.map((i) => `${i.category}::${i.message}`));

    const improvements: TaskImprovement[] = [];
    for (const prev of previousIssues) {
      const key = `${prev.category}::${prev.message}`;
      if (!currentIssueKeys.has(key)) {
        const impactLevel =
          prev.severity === "critical" || prev.severity === "major"
            ? ("high" as const)
            : prev.severity === "minor"
              ? ("medium" as const)
              : ("low" as const);
        improvements.push({
          category: this.mapToIssueCategory(prev.category),
          description: `Resolved: ${prev.message}`,
          impact: impactLevel,
          scoreImpact:
            prev.severity === "critical"
              ? 10
              : prev.severity === "major"
                ? 5
                : prev.severity === "minor"
                  ? 2
                  : 1,
        });
      }
    }

    return improvements;
  }

  /**
   * Create a version snapshot
   */
  private createVersion(
    iteration: number,
    files: GeneratedFile[],
    review: CodeReviewResult,
    testResults: TestExecutionResult,
    previousIssues: ReviewIssue[],
  ): TaskVersion {
    const changes: TaskChanges = {
      filesCreated: files.filter((f) => f.action === "create").map((f) => f.path),
      filesModified: files.filter((f) => f.action === "modify").map((f) => f.path),
      filesDeleted: files.filter((f) => f.action === "delete").map((f) => f.path),
    };

    // Calculate confidence from review scores, convergence progress, and critical issues
    const criticalIssues = review.issues.filter(
      (i) => i.severity === "critical" || i.severity === "major",
    );
    const scoreComponent = Math.round((review.scores.overall / 100) * 50);
    const convergenceComponent = iteration >= this.config.minConvergenceIterations ? 25 : 0;
    const issueComponent = criticalIssues.length === 0 ? 25 : 0;
    const confidence = Math.min(100, scoreComponent + convergenceComponent + issueComponent);

    // Track resolved issues by comparing current and previous review issues
    const improvementsApplied = this.detectImprovements(review.issues, previousIssues);

    return {
      version: iteration,
      timestamp: new Date(),
      changes,
      diffs: files.map((f) => ({
        file: f.path,
        diff: f.content, // Full content for now
        additions: f.content.split("\n").length,
        deletions: 0,
      })),
      scores: review.scores,
      testResults: {
        passed: testResults.passed,
        failed: testResults.failed,
        skipped: testResults.skipped,
        coverage: {
          lines: testResults.coverage.lines,
          branches: testResults.coverage.branches,
          functions: testResults.coverage.functions,
        },
        failures: testResults.failures.map((f) => ({
          name: f.name,
          file: f.file,
          message: f.message,
          stack: f.stack,
        })),
      },
      analysis: {
        issuesFound: review.issues.map((i) => ({
          category: this.mapToIssueCategory(i.category),
          severity: i.severity,
          message: i.message,
          file: i.file,
          line: i.line,
          suggestion: i.suggestion,
        })),
        improvementsApplied,
        reasoning: review.suggestions
          .map((s) => s.description)
          .slice(0, 3)
          .join("; "),
        confidence,
      },
    };
  }
}

/**
 * Create a task iterator
 */
export function createTaskIterator(
  llm: LLMProvider,
  config: QualityConfig,
  projectPath?: string,
): TaskIterator {
  return new TaskIterator(llm, config, projectPath);
}
