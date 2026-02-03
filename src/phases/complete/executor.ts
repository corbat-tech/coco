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
import { createLLMAdapter, type TrackingLLMProvider } from "./llm-adapter.js";

/**
 * COMPLETE phase executor
 */
/**
 * Checkpoint state for COMPLETE phase
 */
interface CompleteCheckpointState {
  sprintId: string;
  currentTaskIndex: number;
  completedTaskIds: string[];
  taskResults: TaskExecutionResult[];
  startTime: number;
}

export class CompleteExecutor implements PhaseExecutor {
  readonly name = "complete";
  readonly description = "Execute tasks with quality iteration";

  private config: CompleteConfig;
  private iterator: TaskIterator | null = null;
  private currentSprint: Sprint | null = null;
  private backlog: Backlog | null = null;
  private llmAdapter: TrackingLLMProvider | null = null;

  // Checkpoint state
  private checkpointState: CompleteCheckpointState | null = null;
  private completedTaskIds: Set<string> = new Set();

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

      this.llmAdapter = createLLMAdapter(context);
      this.iterator = createTaskIterator(this.llmAdapter, this.config.quality);

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

      // Get token usage from the LLM adapter
      const tokenUsage = this.llmAdapter.getTokenUsage();

      return {
        phase: "complete",
        success: result.success,
        artifacts,
        metrics: {
          startTime,
          endTime,
          durationMs: endTime.getTime() - startTime.getTime(),
          llmCalls: tokenUsage.callCount,
          tokensUsed: tokenUsage.totalTokens,
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
  async checkpoint(context: PhaseContext): Promise<PhaseCheckpoint> {
    // Save checkpoint state to disk
    if (this.checkpointState && this.currentSprint) {
      const checkpointPath = path.join(
        context.projectPath,
        ".coco",
        "checkpoints",
        `complete-${this.currentSprint.id}.json`
      );
      await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
      await fs.writeFile(
        checkpointPath,
        JSON.stringify(this.checkpointState, null, 2),
        "utf-8"
      );
    }

    return {
      phase: "complete",
      timestamp: new Date(),
      state: {
        artifacts: [],
        progress: this.calculateProgress(),
        checkpoint: null,
      },
      resumePoint: this.currentSprint?.id || "start",
    };
  }

  /**
   * Restore from checkpoint
   */
  async restore(checkpoint: PhaseCheckpoint, context: PhaseContext): Promise<void> {
    const sprintId = checkpoint.resumePoint;
    if (sprintId === "start") return;

    try {
      const checkpointPath = path.join(
        context.projectPath,
        ".coco",
        "checkpoints",
        `complete-${sprintId}.json`
      );
      const content = await fs.readFile(checkpointPath, "utf-8");
      this.checkpointState = JSON.parse(content) as CompleteCheckpointState;
      this.completedTaskIds = new Set(this.checkpointState.completedTaskIds);
    } catch {
      // No checkpoint to restore, start fresh
      this.checkpointState = null;
      this.completedTaskIds = new Set();
    }
  }

  /**
   * Calculate current progress (0-100)
   */
  private calculateProgress(): number {
    if (!this.checkpointState) return 0;
    const total = this.checkpointState.completedTaskIds.length + 1;
    return Math.round((this.checkpointState.currentTaskIndex / total) * 100);
  }

  /**
   * Execute a sprint with dependency checking, checkpointing, and parallel execution
   */
  private async executeSprint(
    context: PhaseContext,
    sprint: Sprint,
    backlog: Backlog
  ): Promise<SprintExecutionResult> {
    const sprintTasks = this.getSprintTasks(sprint, backlog);

    // Restore from checkpoint if available
    let taskResults: TaskExecutionResult[] = [];
    let startTime = Date.now();

    if (this.checkpointState && this.checkpointState.sprintId === sprint.id) {
      taskResults = this.checkpointState.taskResults;
      startTime = this.checkpointState.startTime;
      this.completedTaskIds = new Set(this.checkpointState.completedTaskIds);
      this.reportProgress({
        phase: "executing",
        sprintId: sprint.id,
        tasksCompleted: taskResults.length,
        tasksTotal: sprintTasks.length,
        message: `Resuming ${sprint.name} with ${taskResults.length} tasks completed`,
      });
    } else {
      // Initialize new checkpoint state
      this.checkpointState = {
        sprintId: sprint.id,
        currentTaskIndex: 0,
        completedTaskIds: [],
        taskResults: [],
        startTime,
      };
      this.completedTaskIds = new Set();
      this.reportProgress({
        phase: "executing",
        sprintId: sprint.id,
        tasksCompleted: 0,
        tasksTotal: sprintTasks.length,
        message: `Starting ${sprint.name}`,
      });
    }

    // Get remaining tasks (not yet executed)
    const executedTaskIds = new Set(taskResults.map(r => r.taskId));
    const remainingTasks = sprintTasks.filter(t => !executedTaskIds.has(t.id));

    // Execute tasks in parallel batches based on dependencies
    if (this.config.parallelExecution && remainingTasks.length > 0) {
      taskResults = await this.executeTasksParallel(
        context, sprint, remainingTasks, taskResults, startTime
      );
    } else {
      // Sequential execution
      taskResults = await this.executeTasksSequential(
        context, sprint, remainingTasks, taskResults, startTime
      );
    }

    const duration = Date.now() - startTime;
    const completedTasks = taskResults.filter((r) => r.success).length;
    const avgQuality =
      taskResults.reduce((sum, r) => sum + r.finalScore, 0) / taskResults.length || 0;
    const totalIterations = taskResults.reduce((sum, r) => sum + r.iterations, 0);

    // Clear checkpoint on completion
    this.checkpointState = null;

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
   * Execute tasks sequentially (original behavior)
   */
  private async executeTasksSequential(
    context: PhaseContext,
    sprint: Sprint,
    tasks: Task[],
    previousResults: TaskExecutionResult[],
    startTime: number
  ): Promise<TaskExecutionResult[]> {
    const taskResults = [...previousResults];
    const totalTasks = tasks.length + previousResults.length;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (!task) continue;

      const completedCount = taskResults.length;

      // Check dependencies are satisfied
      if (!this.areDependenciesSatisfied(task, this.completedTaskIds)) {
        this.reportProgress({
          phase: "blocked",
          sprintId: sprint.id,
          taskId: task.id,
          taskTitle: task.title,
          tasksCompleted: completedCount,
          tasksTotal: totalTasks,
          message: `Task blocked: ${task.title} (dependencies not met)`,
        });

        const blockedResult: TaskExecutionResult = {
          taskId: task.id,
          success: false,
          versions: [],
          finalScore: 0,
          converged: false,
          iterations: 0,
          error: `Dependencies not satisfied: ${task.dependencies.join(", ")}`,
        };
        taskResults.push(blockedResult);
        continue;
      }

      this.reportProgress({
        phase: "executing",
        sprintId: sprint.id,
        taskId: task.id,
        taskTitle: task.title,
        tasksCompleted: completedCount,
        tasksTotal: totalTasks,
        message: `Executing task: ${task.title}`,
      });

      const result = await this.executeTask(context, task, sprint);
      taskResults.push(result);

      if (result.success) {
        this.completedTaskIds.add(task.id);
      }

      // Update and save checkpoint
      this.checkpointState = {
        sprintId: sprint.id,
        currentTaskIndex: completedCount + 1,
        completedTaskIds: Array.from(this.completedTaskIds),
        taskResults,
        startTime,
      };
      await this.checkpoint(context);

      this.reportProgress({
        phase: result.success ? "complete" : "iterating",
        sprintId: sprint.id,
        taskId: task.id,
        taskTitle: task.title,
        iteration: result.iterations,
        currentScore: result.finalScore,
        tasksCompleted: completedCount + 1,
        tasksTotal: totalTasks,
        message: result.success
          ? `Task completed: ${task.title} (score: ${result.finalScore})`
          : `Task failed: ${task.title}`,
      });
    }

    return taskResults;
  }

  /**
   * Execute tasks in parallel batches based on dependencies
   */
  private async executeTasksParallel(
    context: PhaseContext,
    sprint: Sprint,
    tasks: Task[],
    previousResults: TaskExecutionResult[],
    startTime: number
  ): Promise<TaskExecutionResult[]> {
    const taskResults = [...previousResults];
    const totalTasks = tasks.length + previousResults.length;
    const remainingTasks = new Set(tasks.map(t => t.id));

    while (remainingTasks.size > 0) {
      // Find tasks that can be executed (dependencies satisfied)
      const readyTasks = tasks.filter(t =>
        remainingTasks.has(t.id) &&
        this.areDependenciesSatisfied(t, this.completedTaskIds)
      );

      if (readyTasks.length === 0) {
        // No tasks can run - remaining tasks have unmet dependencies
        for (const taskId of remainingTasks) {
          const task = tasks.find(t => t.id === taskId);
          if (task) {
            const blockedResult: TaskExecutionResult = {
              taskId: task.id,
              success: false,
              versions: [],
              finalScore: 0,
              converged: false,
              iterations: 0,
              error: `Dependencies not satisfied: ${task.dependencies.join(", ")}`,
            };
            taskResults.push(blockedResult);
          }
        }
        break;
      }

      // Limit parallel execution
      const batchSize = Math.min(readyTasks.length, this.config.maxParallelTasks);
      const batch = readyTasks.slice(0, batchSize);

      this.reportProgress({
        phase: "executing",
        sprintId: sprint.id,
        tasksCompleted: taskResults.length,
        tasksTotal: totalTasks,
        message: `Executing ${batch.length} tasks in parallel`,
      });

      // Execute batch in parallel
      const batchPromises = batch.map(task =>
        this.executeTask(context, task, sprint).then(result => ({
          task,
          result,
        }))
      );

      const batchResults = await Promise.all(batchPromises);

      // Process results
      for (const { task, result } of batchResults) {
        taskResults.push(result);
        remainingTasks.delete(task.id);

        if (result.success) {
          this.completedTaskIds.add(task.id);
        }

        this.reportProgress({
          phase: result.success ? "complete" : "iterating",
          sprintId: sprint.id,
          taskId: task.id,
          taskTitle: task.title,
          iteration: result.iterations,
          currentScore: result.finalScore,
          tasksCompleted: taskResults.length,
          tasksTotal: totalTasks,
          message: result.success
            ? `Task completed: ${task.title} (score: ${result.finalScore})`
            : `Task failed: ${task.title}`,
        });
      }

      // Update checkpoint after each batch
      this.checkpointState = {
        sprintId: sprint.id,
        currentTaskIndex: taskResults.length,
        completedTaskIds: Array.from(this.completedTaskIds),
        taskResults,
        startTime,
      };
      await this.checkpoint(context);
    }

    return taskResults;
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
   * Get tasks for a sprint, ordered by dependencies (topological sort)
   */
  private getSprintTasks(sprint: Sprint, backlog: Backlog): Task[] {
    const sprintStories = backlog.stories.filter((s) => sprint.stories.includes(s.id));
    const storyIds = sprintStories.map((s) => s.id);
    const tasks = backlog.tasks.filter((t) => storyIds.includes(t.storyId));

    // Topological sort based on dependencies
    return this.topologicalSort(tasks);
  }

  /**
   * Topological sort tasks by dependencies
   */
  private topologicalSort(tasks: Task[]): Task[] {
    const taskMap = new Map<string, Task>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // Initialize
    for (const task of tasks) {
      taskMap.set(task.id, task);
      inDegree.set(task.id, 0);
      adjacency.set(task.id, []);
    }

    // Build graph
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (taskMap.has(depId)) {
          adjacency.get(depId)!.push(task.id);
          inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted: Task[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const task = taskMap.get(id);
      if (task) sorted.push(task);

      for (const neighbor of adjacency.get(id) || []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    // If there's a cycle, return unsorted tasks
    if (sorted.length !== tasks.length) {
      console.warn("Dependency cycle detected, falling back to original order");
      return tasks;
    }

    return sorted;
  }

  /**
   * Check if task dependencies are satisfied
   */
  private areDependenciesSatisfied(task: Task, completedTaskIds: Set<string>): boolean {
    return task.dependencies.every((depId) => completedTaskIds.has(depId));
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
