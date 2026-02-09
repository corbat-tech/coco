/**
 * Agent Coordinator
 * Coordinates multiple agents running in parallel with dependency management
 */

import type { AgentExecutor, AgentDefinition, AgentTask, AgentResult } from "./executor.js";

export interface CoordinationOptions {
  maxParallelAgents?: number;
  timeoutMs?: number;
}

export interface CoordinationResult {
  results: Map<string, AgentResult>;
  totalDuration: number;
  levelsExecuted: number;
  parallelismAchieved: number; // Average agents per level
}

/**
 * Agent Coordinator - Manages parallel agent execution with dependencies
 */
export class AgentCoordinator {
  private executor: AgentExecutor;
  private agentDefinitions: Map<string, AgentDefinition>;

  constructor(executor: AgentExecutor, agentDefinitions: Map<string, AgentDefinition>) {
    this.executor = executor;
    this.agentDefinitions = agentDefinitions;
  }

  /**
   * Coordinate execution of multiple agents
   */
  async coordinateAgents(
    tasks: AgentTask[],
    options?: CoordinationOptions,
  ): Promise<CoordinationResult> {
    const startTime = Date.now();
    const maxParallel = options?.maxParallelAgents ?? 5;

    // Build dependency graph
    const graph = this.buildDependencyGraph(tasks);

    // Topological sort to get execution levels
    const levels = this.topologicalSort(graph);

    const results = new Map<string, AgentResult>();
    let totalAgentsExecuted = 0;

    // Execute level by level (parallel within level, sequential across levels)
    for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
      const level = levels[levelIdx];

      console.log(
        `[Coordinator] Executing level ${levelIdx + 1}/${levels.length} with ${level?.length || 0} agents`,
      );

      // Split level into batches based on max parallel
      if (!level || level.length === 0) continue;
      const batches = this.createBatches(level, maxParallel);

      for (const batch of batches) {
        // Execute batch in parallel
        const batchResults = await Promise.all(
          batch.map(async (task) => {
            // Build context from dependency results
            const context = this.buildContext(task, results);

            // Get agent definition for this task
            const agentDef = this.getAgentForTask(task);

            // Execute agent
            const result = await this.executor.execute(agentDef, {
              ...task,
              context,
            });

            totalAgentsExecuted++;

            return { taskId: task.id, result };
          }),
        );

        // Store results
        for (const { taskId, result } of batchResults) {
          results.set(taskId, result);
        }
      }
    }

    const parallelismAchieved = totalAgentsExecuted / levels.length;

    return {
      results,
      totalDuration: Date.now() - startTime,
      levelsExecuted: levels.length,
      parallelismAchieved,
    };
  }

  /**
   * Build dependency graph from tasks
   */
  private buildDependencyGraph(tasks: AgentTask[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    for (const task of tasks) {
      if (!graph.has(task.id)) {
        graph.set(task.id, new Set());
      }

      if (task.dependencies) {
        for (const dep of task.dependencies) {
          graph.get(task.id)!.add(dep);
        }
      }
    }

    return graph;
  }

  /**
   * Topological sort to determine execution order
   * Returns tasks grouped by execution level (all tasks in a level can run in parallel)
   */
  private topologicalSort(graph: Map<string, Set<string>>): AgentTask[][] {
    const levels: AgentTask[][] = [];
    const completed = new Set<string>();
    const taskMap = new Map<string, AgentTask>();

    // Build reverse lookup
    for (const [taskId] of graph) {
      taskMap.set(taskId, { id: taskId, description: taskId }); // Would have real tasks
    }

    while (completed.size < graph.size) {
      const currentLevel: AgentTask[] = [];

      // Find all tasks whose dependencies are completed
      for (const [taskId, dependencies] of graph) {
        if (completed.has(taskId)) continue;

        const allDepsCompleted = Array.from(dependencies).every((dep) => completed.has(dep));

        if (allDepsCompleted) {
          const task = taskMap.get(taskId);
          if (task) {
            currentLevel.push(task);
          }
        }
      }

      if (currentLevel.length === 0) {
        // No progress made - circular dependency or error
        console.warn("[Coordinator] Circular dependency detected or invalid graph");
        break;
      }

      // Mark as completed
      for (const task of currentLevel) {
        completed.add(task.id);
      }

      levels.push(currentLevel);
    }

    return levels;
  }

  /**
   * Create batches from tasks based on max parallel
   */
  private createBatches(tasks: AgentTask[], maxParallel: number): AgentTask[][] {
    const batches: AgentTask[][] = [];

    for (let i = 0; i < tasks.length; i += maxParallel) {
      batches.push(tasks.slice(i, i + maxParallel));
    }

    return batches;
  }

  /**
   * Build context for a task from its dependencies' results
   */
  private buildContext(task: AgentTask, results: Map<string, AgentResult>): Record<string, any> {
    const context: Record<string, any> = { ...task.context };

    if (task.dependencies) {
      for (const depId of task.dependencies) {
        const depResult = results.get(depId);
        if (depResult) {
          context[`dependency_${depId}`] = {
            output: depResult.output,
            success: depResult.success,
          };
        }
      }
    }

    return context;
  }

  /**
   * Get agent definition for a task
   * (Would have more sophisticated logic to choose agent based on task type)
   */
  private getAgentForTask(task: AgentTask): AgentDefinition {
    // Simple heuristic: choose based on task description
    const desc = task.description.toLowerCase();

    if (desc.includes("research") || desc.includes("find") || desc.includes("analyze")) {
      return {
        ...(this.agentDefinitions.get("researcher") ?? this.getDefaultAgent()),
        maxTurns: 20,
      };
    }

    if (desc.includes("test") || desc.includes("coverage")) {
      return { ...(this.agentDefinitions.get("tester") ?? this.getDefaultAgent()), maxTurns: 15 };
    }

    if (desc.includes("review") || desc.includes("quality")) {
      return { ...(this.agentDefinitions.get("reviewer") ?? this.getDefaultAgent()), maxTurns: 10 };
    }

    if (desc.includes("optimize") || desc.includes("refactor")) {
      return {
        ...(this.agentDefinitions.get("optimizer") ?? this.getDefaultAgent()),
        maxTurns: 15,
      };
    }

    if (desc.includes("plan") || desc.includes("decompose")) {
      return { ...(this.agentDefinitions.get("planner") ?? this.getDefaultAgent()), maxTurns: 10 };
    }

    // Default to coder
    return { ...(this.agentDefinitions.get("coder") ?? this.getDefaultAgent()), maxTurns: 20 };
  }

  /**
   * Get default agent definition
   */
  private getDefaultAgent(): AgentDefinition {
    return {
      role: "coder",
      systemPrompt: "You are a coding agent. Complete the given task.",
      allowedTools: [],
      maxTurns: 20,
    };
  }
}

/**
 * Create an agent coordinator
 */
export function createAgentCoordinator(
  executor: AgentExecutor,
  agentDefinitions: Map<string, AgentDefinition>,
): AgentCoordinator {
  return new AgentCoordinator(executor, agentDefinitions);
}
