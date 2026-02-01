/**
 * COMPLETE Phase Executor
 *
 * Orchestrates task execution with quality iteration
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  PhaseExecutor,
  PhaseContext,
  PhaseResult,
  PhaseCheckpoint,
  PhaseArtifact,
} from "../types.js";
import type {
  CompleteConfig,
  CompleteProgress,
  SprintExecutionResult,
  TaskExecutionResult,
  TestExecutionResult,
  GeneratedFile,
} from "./types.js";
import { DEFAULT_COMPLETE_CONFIG } from "./types.js";
import type { Task, Sprint, Backlog } from "../../types/task.js";
import { TaskIterator, createTaskIterator } from "./iterator.js";
import { PhaseError } from "../../utils/errors.js";
import { createLLMAdapter } from "./llm-adapter.js";

/**
 * COMPLETE phase executor
 */
export class CompleteExecutor implements PhaseExecutor {
  readonly name = "complete";
  readonly description = "Execute tasks with quality iteration";

  private config: CompleteConfig;
  private iterator: TaskIterator | null = null;
  private currentSprint: Sprint | null = null;
  private backlog: Backlog | null = null;

  constructor(config: Partial<CompleteConfig> = {}) {
    this.config = { ...DEFAULT_COMPLETE_CONFIG, ...config };
  }

  /**
   * Check if the phase can start
   */
  canStart(_context: PhaseContext): boolean {
    return true;
  }

  /**
   * Execute the COMPLETE phase
   */
  async execute(context: PhaseContext): Promise<PhaseResult> {
    const startTime = new Date();
    const artifacts: PhaseArtifact[] = [];

    try {
      this.backlog = await this.loadBacklog(context.projectPath);
      this.currentSprint = this.backlog.currentSprint || await this.loadCurrentSprint(context.projectPath);

      if (!this.currentSprint) {
        throw new PhaseError("No sprint to execute", { phase: "complete" });
      }

      const llm = createLLMAdapter(context);
      this.iterator = createTaskIterator(llm, this.config.quality);

      const result = await this.executeSprint(context, this.currentSprint, this.backlog);

      const resultsPath = await this.saveSprintResults(context.projectPath, result);
      artifacts.push({
        type: "documentation",
        path: resultsPath,
        description: "Sprint execution results",
      });

      for (const taskResult of result.taskResults) {
        if (taskResult.success && taskResult.versions.length > 0) {
          const lastVersion = taskResult.versions[taskResult.versions.length - 1];
          if (lastVersion) {
            for (const change of lastVersion.changes.filesCreated) {
              artifacts.push({
                type: "code",
                path: change,
                description: `Created for task ${taskResult.taskId}`,
              });
            }
          }
        }
      }

      const endTime = new Date();

      return {
        phase: "complete",
        success: result.success,
        artifacts,
        metrics: {
          startTime,
          endTime,
          durationMs: endTime.getTime() - startTime.getTime(),
          llmCalls: result.totalIterations * 2,
          tokensUsed: 0,
        },
      };
    } catch (error) {
      return {
        phase: "complete",
        success: false,
        artifacts,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if the phase can complete
   */
  canComplete(_context: PhaseContext): boolean {
    return true;
  }

  /**
   * Create a checkpoint
   */
  async checkpoint(_context: PhaseContext): Promise<PhaseCheckpoint> {
    return {
      phase: "complete",
      timestamp: new Date(),
      state: {
        artifacts: [],
        progress: 0,
        checkpoint: null,
      },
      resumePoint: this.currentSprint?.id || "start",
    };
  }

  /**
   * Restore from checkpoint
   */
  async restore(_checkpoint: PhaseCheckpoint, _context: PhaseContext): Promise<void> {
    // Load state from checkpoint
  }

  /**
   * Execute a sprint
   */
  private async executeSprint(
    context: PhaseContext,
    sprint: Sprint,
    backlog: Backlog
  ): Promise<SprintExecutionResult> {
    const startTime = Date.now();
    const taskResults: TaskExecutionResult[] = [];
    const sprintTasks = this.getSprintTasks(sprint, backlog);

    this.reportProgress({
      phase: "executing",
      sprintId: sprint.id,
      tasksCompleted: 0,
      tasksTotal: sprintTasks.length,
      message: `Starting ${sprint.name}`,
    });

    for (let i = 0; i < sprintTasks.length; i++) {
      const task = sprintTasks[i];
      if (!task) continue;

      this.reportProgress({
        phase: "executing",
        sprintId: sprint.id,
        taskId: task.id,
        taskTitle: task.title,
        tasksCompleted: i,
        tasksTotal: sprintTasks.length,
        message: `Executing task: ${task.title}`,
      });

      const result = await this.executeTask(context, task, sprint);
      taskResults.push(result);

      this.reportProgress({
        phase: result.success ? "complete" : "iterating",
        sprintId: sprint.id,
        taskId: task.id,
        taskTitle: task.title,
        iteration: result.iterations,
        currentScore: result.finalScore,
        tasksCompleted: i + 1,
        tasksTotal: sprintTasks.length,
        message: result.success
          ? `Task completed: ${task.title} (score: ${result.finalScore})`
          : `Task failed: ${task.title}`,
      });
    }

    const duration = Date.now() - startTime;
    const completedTasks = taskResults.filter((r) => r.success).length;
    const avgQuality =
      taskResults.reduce((sum, r) => sum + r.finalScore, 0) / taskResults.length || 0;
    const totalIterations = taskResults.reduce((sum, r) => sum + r.iterations, 0);

    return {
      sprintId: sprint.id,
      success: completedTasks === sprintTasks.length,
      tasksCompleted: completedTasks,
      tasksTotal: sprintTasks.length,
      averageQuality: avgQuality,
      totalIterations,
      taskResults,
      duration,
    };
  }

  /**
   * Execute a single task
   */
  private async executeTask(
    context: PhaseContext,
    task: Task,
    sprint: Sprint
  ): Promise<TaskExecutionResult> {
    if (!this.iterator) {
      throw new PhaseError("Iterator not initialized", { phase: "complete" });
    }

    const taskContext = {
      task,
      projectPath: context.projectPath,
      sprint,
      previousVersions: [],
      qualityConfig: this.config.quality,
    };

    const runTests = async (): Promise<TestExecutionResult> => {
      return this.runTests(context, task);
    };

    const saveFiles = async (files: GeneratedFile[]): Promise<void> => {
      for (const file of files) {
        const filePath = path.join(context.projectPath, file.path);
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        if (file.action === "delete") {
          await fs.unlink(filePath).catch(() => {});
        } else {
          await fs.writeFile(filePath, file.content, "utf-8");
        }
      }
    };

    const onProgress = (iteration: number, score: number) => {
      this.reportProgress({
        phase: "iterating",
        sprintId: sprint.id,
        taskId: task.id,
        taskTitle: task.title,
        iteration,
        currentScore: score,
        tasksCompleted: 0,
        tasksTotal: 1,
        message: `Iteration ${iteration}: score ${score}`,
      });
    };

    return this.iterator.execute(taskContext, runTests, saveFiles, onProgress);
  }

  /**
   * Run tests for a task
   */
  private async runTests(context: PhaseContext, _task: Task): Promise<TestExecutionResult> {
    try {
      if (context.tools.test) {
        const result = await context.tools.test.run();
        const coverage = await context.tools.test.coverage();

        return {
          passed: result.passed,
          failed: result.failed,
          skipped: result.skipped,
          coverage: {
            lines: coverage.lines,
            branches: coverage.branches,
            functions: coverage.functions,
            statements: coverage.statements,
          },
          failures: result.failures.map((f) => ({
            name: f.name,
            file: "",
            message: f.message,
            stack: f.stack,
          })),
          duration: result.duration,
        };
      }
    } catch {
      // Fall through to default
    }

    return {
      passed: 0,
      failed: 0,
      skipped: 0,
      coverage: { lines: 0, branches: 0, functions: 0, statements: 0 },
      failures: [],
      duration: 0,
    };
  }

  /**
   * Get tasks for a sprint
   */
  private getSprintTasks(sprint: Sprint, backlog: Backlog): Task[] {
    const sprintStories = backlog.stories.filter((s) => sprint.stories.includes(s.id));
    const storyIds = sprintStories.map((s) => s.id);
    return backlog.tasks.filter((t) => storyIds.includes(t.storyId));
  }

  /**
   * Report progress
   */
  private reportProgress(progress: CompleteProgress): void {
    if (this.config.onProgress) {
      this.config.onProgress(progress);
    }
  }

  /**
   * Load backlog
   */
  private async loadBacklog(projectPath: string): Promise<Backlog> {
    try {
      const backlogPath = path.join(projectPath, ".coco", "planning", "backlog.json");
      const content = await fs.readFile(backlogPath, "utf-8");
      const data = JSON.parse(content) as { backlog: Backlog };
      return data.backlog;
    } catch {
      return { epics: [], stories: [], tasks: [], currentSprint: null, completedSprints: [] };
    }
  }

  /**
   * Load current sprint
   */
  private async loadCurrentSprint(projectPath: string): Promise<Sprint | null> {
    try {
      const sprintsDir = path.join(projectPath, ".coco", "planning", "sprints");
      const files = await fs.readdir(sprintsDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      if (jsonFiles.length === 0) return null;

      const sprintPath = path.join(sprintsDir, jsonFiles[0] || "");
      const content = await fs.readFile(sprintPath, "utf-8");
      const sprint = JSON.parse(content) as Sprint;
      sprint.startDate = new Date(sprint.startDate);

      return sprint;
    } catch {
      return null;
    }
  }

  /**
   * Save sprint results
   */
  private async saveSprintResults(
    projectPath: string,
    result: SprintExecutionResult
  ): Promise<string> {
    const resultsDir = path.join(projectPath, ".coco", "results");
    await fs.mkdir(resultsDir, { recursive: true });

    const resultsPath = path.join(resultsDir, `${result.sprintId}-results.json`);
    await fs.writeFile(resultsPath, JSON.stringify(result, null, 2), "utf-8");

    const mdPath = path.join(resultsDir, `${result.sprintId}-results.md`);
    await fs.writeFile(mdPath, this.generateResultsMarkdown(result), "utf-8");

    return resultsPath;
  }

  /**
   * Generate results markdown
   */
  private generateResultsMarkdown(result: SprintExecutionResult): string {
    const sections: string[] = [];

    sections.push(`# Sprint Results: ${result.sprintId}`);
    sections.push("");
    sections.push("## Summary");
    sections.push("");
    sections.push(`- **Status:** ${result.success ? "✅ Success" : "❌ Failed"}`);
    sections.push(`- **Tasks Completed:** ${result.tasksCompleted}/${result.tasksTotal}`);
    sections.push(`- **Average Quality:** ${result.averageQuality.toFixed(1)}/100`);
    sections.push(`- **Total Iterations:** ${result.totalIterations}`);
    sections.push(`- **Duration:** ${(result.duration / 1000 / 60).toFixed(1)} minutes`);
    sections.push("");
    sections.push("## Task Results");
    sections.push("");
    sections.push("| Task | Status | Score | Iterations | Converged |");
    sections.push("|------|--------|-------|------------|-----------|");

    for (const task of result.taskResults) {
      const status = task.success ? "✅" : "❌";
      const converged = task.converged ? "Yes" : "No";
      sections.push(`| ${task.taskId} | ${status} | ${task.finalScore} | ${task.iterations} | ${converged} |`);
    }

    sections.push("");
    sections.push("---");
    sections.push("");
    sections.push("*Generated by Corbat-Coco*");

    return sections.join("\n");
  }
}

/**
 * Create a COMPLETE phase executor
 */
export function createCompleteExecutor(config?: Partial<CompleteConfig>): CompleteExecutor {
  return new CompleteExecutor(config);
}
