/**
 * Agent Coordinator
 * Coordinates multiple agents running in parallel with dependency management
 */

import type { AgentExecutor, AgentDefinition, AgentTask, AgentResult } from "./executor.js";
import { createResourceAwareSemaphore } from "../utils/resource-semaphore.js";
import { getMaxSafeAgents } from "../utils/resource-monitor.js";
import { getLogger } from "../utils/logger.js";

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
 * Weighted keyword patterns for agent role classification.
 * Each role has primary keywords (weight 3) and secondary keywords (weight 1).
 * The role with the highest total score is selected. Default: "coder".
 */
const ROLE_PATTERNS: Record<string, Array<{ keywords: string[]; weight: number }>> = {
  researcher: [
    {
      keywords: [
        "research",
        "find",
        "analyze",
        "explore",
        "investigate",
        "discover",
        "understand",
        "examine",
      ],
      weight: 3,
    },
    {
      keywords: [
        "pattern",
        "example",
        "reference",
        "dependency",
        "structure",
        "architecture",
        "how",
        "why",
      ],
      weight: 1,
    },
  ],
  tester: [
    {
      keywords: [
        "test",
        "coverage",
        "spec",
        "assertion",
        "mock",
        "unit test",
        "e2e",
        "integration test",
      ],
      weight: 3,
    },
    { keywords: ["validate", "verify", "check", "expect", "should"], weight: 1 },
  ],
  reviewer: [
    { keywords: ["review", "quality", "audit", "inspect", "lint", "code review"], weight: 3 },
    { keywords: ["issue", "problem", "vulnerability", "smell", "concern", "feedback"], weight: 1 },
  ],
  optimizer: [
    {
      keywords: ["optimize", "refactor", "performance", "simplify", "reduce", "improve efficiency"],
      weight: 3,
    },
    { keywords: ["clean", "improve", "deduplicate", "consolidate", "streamline"], weight: 1 },
  ],
  planner: [
    { keywords: ["plan", "decompose", "design", "architect", "breakdown", "roadmap"], weight: 3 },
    { keywords: ["strategy", "organize", "prioritize", "estimate", "scope", "divide"], weight: 1 },
  ],
};

/**
 * Score a task description against a role's keyword patterns.
 * Returns the total weighted score.
 */
function scoreTaskForRole(
  description: string,
  patterns: Array<{ keywords: string[]; weight: number }>,
): number {
  const desc = description.toLowerCase();
  let score = 0;
  for (const pattern of patterns) {
    for (const keyword of pattern.keywords) {
      if (desc.includes(keyword)) {
        score += pattern.weight;
      }
    }
  }
  return score;
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
    const maxParallel = options?.maxParallelAgents ?? getMaxSafeAgents();
    const resourceSem = createResourceAwareSemaphore({
      maxConcurrency: maxParallel,
      minConcurrency: 1,
    });

    // Build dependency graph
    const graph = this.buildDependencyGraph(tasks);

    // Topological sort to get execution levels
    const levels = this.topologicalSort(tasks, graph);

    const results = new Map<string, AgentResult>();
    let totalAgentsExecuted = 0;

    // Execute level by level (parallel within level, sequential across levels)
    for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
      const level = levels[levelIdx];

      getLogger().debug(
        `[Coordinator] Executing level ${levelIdx + 1}/${levels.length} with ${level?.length || 0} agents`,
      );

      // Split level into batches based on max parallel
      if (!level || level.length === 0) continue;
      const batches = this.createBatches(level, maxParallel);

      for (const batch of batches) {
        // Execute batch in parallel, gated by resource-aware semaphore
        const batchResults = await Promise.all(
          batch.map((task) =>
            resourceSem.withSemaphore(async () => {
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
          ),
        );

        // Store results
        for (const { taskId, result } of batchResults) {
          results.set(taskId, result);
        }
      }
    }

    const parallelismAchieved = levels.length > 0 ? totalAgentsExecuted / levels.length : 0;

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
  private topologicalSort(tasks: AgentTask[], graph: Map<string, Set<string>>): AgentTask[][] {
    const levels: AgentTask[][] = [];
    const completed = new Set<string>();
    const taskMap = new Map<string, AgentTask>();

    // Build lookup with real task data
    for (const task of tasks) {
      taskMap.set(task.id, task);
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
        // No progress made — circular dependency in the task graph.
        // Identify which tasks are stuck and surface them in the error.
        const remaining = [...graph.keys()].filter((id) => !completed.has(id));
        throw new Error(
          `[Coordinator] Circular dependency detected. ` +
            `Tasks that could not be scheduled: ${remaining.join(", ")}`,
        );
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
  private buildContext(
    task: AgentTask,
    results: Map<string, AgentResult>,
  ): Record<string, unknown> {
    const context: Record<string, unknown> = { ...(task.context as Record<string, unknown>) };

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
   * Get agent definition for a task using weighted keyword scoring.
   * Scores the task description against all role patterns and picks the best match.
   * Falls back to "coder" if no role scores above the minimum threshold.
   */
  private getAgentForTask(task: AgentTask): AgentDefinition {
    const desc = task.description.toLowerCase();

    // Score each role
    let bestRole = "coder";
    let bestScore = 0;

    for (const [role, patterns] of Object.entries(ROLE_PATTERNS)) {
      const score = scoreTaskForRole(desc, patterns);
      if (score > bestScore) {
        bestScore = score;
        bestRole = role;
      }
    }

    // Minimum score threshold: if no role scores above 2, default to coder
    if (bestScore < 2) {
      bestRole = "coder";
    }

    const maxTurnsMap: Record<string, number> = {
      researcher: 20,
      tester: 15,
      reviewer: 10,
      optimizer: 15,
      planner: 10,
      coder: 20,
    };

    return {
      ...(this.agentDefinitions.get(bestRole) ?? this.getDefaultAgent()),
      maxTurns: maxTurnsMap[bestRole] ?? 20,
    };
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
