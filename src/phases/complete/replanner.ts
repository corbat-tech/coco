/**
 * Re-planning system for failure recovery
 * Generates alternative plans when tasks repeatedly fail
 */

import type { Task, TaskStatus, TaskComplexity, TaskType } from "../../types/task.js";
import type { QualityScores } from "../../quality/types.js";

/**
 * Failure context for re-planning
 */
export interface FailureContext {
  /** The task that failed */
  task: Task;
  /** Number of failed attempts */
  attemptCount: number;
  /** History of errors encountered */
  errorHistory: string[];
  /** Quality scores from attempts */
  scoreHistory: QualityScores[];
  /** Tool calls that were made */
  toolHistory: ToolAttempt[];
}

/**
 * Tool attempt record
 */
export interface ToolAttempt {
  name: string;
  input: Record<string, unknown>;
  success: boolean;
  error?: string;
  duration: number;
}

/**
 * Re-plan strategy
 */
export type ReplanStrategy =
  | "simplify"      // Break down into smaller steps
  | "alternative"   // Try a different approach
  | "defer"         // Move to later in backlog
  | "escalate"      // Require human intervention
  | "skip";         // Skip this task

/**
 * Re-plan decision
 */
export interface ReplanDecision {
  strategy: ReplanStrategy;
  reason: string;
  confidence: number; // 0-1
  suggestedTasks?: Task[];
  suggestedPrompt?: string;
  blockingIssues?: string[];
}

/**
 * Re-planning options
 */
export interface ReplanOptions {
  /** Maximum attempts before escalating */
  maxAttempts?: number;
  /** Minimum quality improvement to continue */
  minQualityDelta?: number;
  /** Enable automatic simplification */
  autoSimplify?: boolean;
  /** Strategies to consider */
  allowedStrategies?: ReplanStrategy[];
}

/**
 * Default re-planning options
 */
const defaultOptions: Required<ReplanOptions> = {
  maxAttempts: 3,
  minQualityDelta: 2,
  autoSimplify: true,
  allowedStrategies: ["simplify", "alternative", "defer", "escalate", "skip"],
};

/**
 * Analyze failure and determine re-planning strategy
 */
export function analyzeFailure(
  context: FailureContext,
  options: ReplanOptions = {}
): ReplanDecision {
  const opts = { ...defaultOptions, ...options };

  // Check if we've exceeded max attempts
  if (context.attemptCount >= opts.maxAttempts) {
    return {
      strategy: "escalate",
      reason: `Task failed ${context.attemptCount} times, exceeding maximum attempts (${opts.maxAttempts})`,
      confidence: 0.9,
      blockingIssues: extractBlockingIssues(context),
    };
  }

  // Check for repeating errors
  const repeatingError = findRepeatingError(context.errorHistory);
  if (repeatingError) {
    return {
      strategy: "alternative",
      reason: `Same error repeating: ${repeatingError.substring(0, 100)}`,
      confidence: 0.8,
      suggestedPrompt: generateAlternativePrompt(context.task, repeatingError),
    };
  }

  // Check for quality stagnation
  if (context.scoreHistory.length >= 2) {
    const stagnation = detectQualityStagnation(context.scoreHistory, opts.minQualityDelta);
    if (stagnation) {
      return {
        strategy: "simplify",
        reason: "Quality scores not improving between iterations",
        confidence: 0.7,
        suggestedTasks: suggestSimplifiedTasks(context.task),
      };
    }
  }

  // Check for tool failures
  const toolFailures = context.toolHistory.filter(t => !t.success);
  if (toolFailures.length > 0) {
    const criticalFailure = analyzeCriticalToolFailure(toolFailures);
    if (criticalFailure) {
      return {
        strategy: "defer",
        reason: `Critical tool failures: ${criticalFailure}`,
        confidence: 0.6,
        blockingIssues: toolFailures.map(t => `${t.name}: ${t.error}`),
      };
    }
  }

  // Default: try again with alternative approach
  return {
    strategy: "alternative",
    reason: "Previous approach did not succeed, trying alternative",
    confidence: 0.5,
    suggestedPrompt: generateAlternativePrompt(context.task, context.errorHistory[0] ?? "unknown error"),
  };
}

/**
 * Find repeating error in history
 */
function findRepeatingError(errorHistory: string[]): string | null {
  if (errorHistory.length < 2) return null;

  // Normalize errors for comparison
  const normalized = errorHistory.map(e => e.toLowerCase().trim().substring(0, 200));

  // Check for exact repeats
  const counts = new Map<string, number>();
  for (const error of normalized) {
    counts.set(error, (counts.get(error) ?? 0) + 1);
  }

  for (const [error, count] of counts) {
    if (count >= 2) {
      return error;
    }
  }

  return null;
}

/**
 * Detect quality score stagnation
 */
function detectQualityStagnation(
  scoreHistory: QualityScores[],
  minDelta: number
): boolean {
  if (scoreHistory.length < 2) return false;

  const recent = scoreHistory.slice(-2);
  const prev = recent[0];
  const current = recent[1];

  // Safety check (should never happen given length check above)
  if (!prev || !current) return false;

  // Check if overall score improved
  const delta = current.overall - prev.overall;

  return delta < minDelta;
}

/**
 * Extract blocking issues from failure context
 */
function extractBlockingIssues(context: FailureContext): string[] {
  const issues: string[] = [];

  // Add unique errors
  const uniqueErrors = [...new Set(context.errorHistory)];
  issues.push(...uniqueErrors.slice(0, 5));

  // Add tool failures
  const toolErrors = context.toolHistory
    .filter(t => !t.success)
    .map(t => `Tool ${t.name} failed: ${t.error}`);
  issues.push(...toolErrors.slice(0, 5));

  return issues;
}

/**
 * Generate alternative prompt for task
 */
function generateAlternativePrompt(task: Task, previousError: string): string {
  return `Previous approach failed with error: ${previousError}

Please try a different approach to complete this task:
${task.description}

Consider:
1. Alternative libraries or methods
2. Breaking the task into smaller steps
3. Handling edge cases explicitly
4. Adding more robust error handling`;
}

/**
 * Suggest simplified sub-tasks
 */
function suggestSimplifiedTasks(task: Task): Task[] {
  // Generate 2-3 smaller tasks from the original
  const baseId = task.id;

  // Simplify complexity based on original
  const simplifiedComplexity: TaskComplexity =
    task.estimatedComplexity === "complex" ? "moderate" :
    task.estimatedComplexity === "moderate" ? "simple" : "trivial";

  const subtasks: Task[] = [
    {
      id: `${baseId}-prep`,
      storyId: task.storyId,
      title: `Prepare for: ${task.title}`,
      description: `Set up prerequisites and validate inputs for: ${task.description}`,
      type: task.type,
      files: [],
      dependencies: task.dependencies,
      estimatedComplexity: simplifiedComplexity,
      status: "pending" as TaskStatus,
    },
    {
      id: `${baseId}-core`,
      storyId: task.storyId,
      title: `Core implementation: ${task.title}`,
      description: `Implement the core logic for: ${task.description}`,
      type: task.type,
      files: task.files,
      dependencies: [`${baseId}-prep`],
      estimatedComplexity: simplifiedComplexity,
      status: "pending" as TaskStatus,
    },
    {
      id: `${baseId}-verify`,
      storyId: task.storyId,
      title: `Verify: ${task.title}`,
      description: `Test and verify the implementation: ${task.description}`,
      type: "test" as TaskType,
      files: [],
      dependencies: [`${baseId}-core`],
      estimatedComplexity: simplifiedComplexity,
      status: "pending" as TaskStatus,
    },
  ];

  return subtasks;
}

/**
 * Analyze critical tool failures
 */
function analyzeCriticalToolFailure(failures: ToolAttempt[]): string | null {
  // Critical tools that indicate blocking issues
  const criticalTools = ["git_commit", "git_push", "write_file", "run_tests"];

  const criticalFailures = failures.filter(f =>
    criticalTools.some(ct => f.name.includes(ct))
  );

  if (criticalFailures.length > 0) {
    return criticalFailures.map(f => f.name).join(", ");
  }

  return null;
}

/**
 * Create re-plan prompt for LLM
 */
export function createReplanPrompt(
  context: FailureContext,
  decision: ReplanDecision
): string {
  const lines: string[] = [];

  lines.push("# Re-planning Required");
  lines.push("");
  lines.push(`**Task**: ${context.task.title}`);
  lines.push(`**Attempts**: ${context.attemptCount}`);
  lines.push(`**Strategy**: ${decision.strategy}`);
  lines.push(`**Reason**: ${decision.reason}`);
  lines.push("");

  if (decision.blockingIssues && decision.blockingIssues.length > 0) {
    lines.push("## Blocking Issues");
    for (const issue of decision.blockingIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push("");
  }

  if (decision.suggestedPrompt) {
    lines.push("## Suggested Approach");
    lines.push(decision.suggestedPrompt);
    lines.push("");
  }

  if (decision.suggestedTasks && decision.suggestedTasks.length > 0) {
    lines.push("## Suggested Sub-tasks");
    for (const task of decision.suggestedTasks) {
      lines.push(`- **${task.title}**: ${task.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Check if task should be re-planned
 */
export function shouldReplan(
  attemptCount: number,
  lastScore: QualityScores | null,
  targetScore: number,
  options: ReplanOptions = {}
): boolean {
  const opts = { ...defaultOptions, ...options };

  // Too many attempts
  if (attemptCount >= opts.maxAttempts) {
    return true;
  }

  // Score not improving
  if (lastScore && lastScore.overall < targetScore * 0.7) {
    return true;
  }

  return false;
}

/**
 * Get human-readable strategy description
 */
export function describeStrategy(strategy: ReplanStrategy): string {
  switch (strategy) {
    case "simplify":
      return "Breaking the task into smaller, more manageable steps";
    case "alternative":
      return "Trying a different implementation approach";
    case "defer":
      return "Moving the task to later in the backlog";
    case "escalate":
      return "Requiring human intervention to resolve blocking issues";
    case "skip":
      return "Skipping this task (may affect dependent tasks)";
    default:
      return "Unknown strategy";
  }
}
