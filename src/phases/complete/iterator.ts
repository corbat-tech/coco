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
  TestExecutionResult,
  GeneratedFile,
  QualityConfig,
} from "./types.js";
import type { TaskVersion, TaskChanges, IssueCategory } from "../../types/task.js";
import type { QualityDimensions } from "../../quality/types.js";
import { CodeGenerator } from "./generator.js";
import { CodeReviewer } from "./reviewer.js";
import type { LLMProvider } from "../../providers/types.js";

/**
 * Task Iterator
 *
 * Manages the generate-review-iterate cycle
 */
export class TaskIterator {
  private generator: CodeGenerator;
  private reviewer: CodeReviewer;
  private config: QualityConfig;

  constructor(llm: LLMProvider, config: QualityConfig) {
    this.generator = new CodeGenerator(llm);
    this.reviewer = new CodeReviewer(llm, config);
    this.config = config;
  }

  /**
   * Execute a task with quality iteration
   */
  async execute(
    context: TaskExecutionContext,
    runTests: () => Promise<TestExecutionResult>,
    saveFiles: (files: GeneratedFile[]) => Promise<void>,
    onProgress?: (iteration: number, score: number) => void
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
          testResults
        );

        lastReview = review;
        scoreHistory.push(review.scores.overall);

        // Report progress
        if (onProgress) {
          onProgress(iteration, review.scores.overall);
        }

        // Create version snapshot
        const version = this.createVersion(
          iteration,
          currentFiles,
          review,
          testResults
        );
        versions.push(version);

        // Check if we should stop
        const convergence = this.checkConvergence(
          scoreHistory,
          review,
          iteration
        );

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
          }
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
    iteration: number
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
    return files
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
      .join("\n\n");
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
   * Create a version snapshot
   */
  private createVersion(
    iteration: number,
    files: GeneratedFile[],
    review: CodeReviewResult,
    testResults: TestExecutionResult
  ): TaskVersion {
    const changes: TaskChanges = {
      filesCreated: files.filter((f) => f.action === "create").map((f) => f.path),
      filesModified: files.filter((f) => f.action === "modify").map((f) => f.path),
      filesDeleted: files.filter((f) => f.action === "delete").map((f) => f.path),
    };

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
        improvementsApplied: [],
        reasoning: review.suggestions
          .map((s) => s.description)
          .slice(0, 3)
          .join("; "),
        confidence: 70, // Would calculate based on review
      },
    };
  }
}

/**
 * Create a task iterator
 */
export function createTaskIterator(
  llm: LLMProvider,
  config: QualityConfig
): TaskIterator {
  return new TaskIterator(llm, config);
}
