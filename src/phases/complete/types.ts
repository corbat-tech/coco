/**
 * Types for the COMPLETE phase
 *
 * This phase focuses on task execution with quality iteration
 */

import type { Task, TaskVersion, Sprint } from "../../types/task.js";
import type { QualityScores, QualityDimensions } from "../../quality/types.js";

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  taskId: string;
  success: boolean;
  versions: TaskVersion[];
  finalScore: number;
  converged: boolean;
  iterations: number;
  error?: string;
}

/**
 * Task execution context
 */
export interface TaskExecutionContext {
  task: Task;
  projectPath: string;
  sprint: Sprint;
  previousVersions: TaskVersion[];
  qualityConfig: QualityConfig;
}

/**
 * Quality configuration for iterations
 */
export interface QualityConfig {
  /** Minimum acceptable score */
  minScore: number;

  /** Minimum coverage percentage */
  minCoverage: number;

  /** Maximum iterations before giving up */
  maxIterations: number;

  /** Score improvement threshold for convergence */
  convergenceThreshold: number;

  /** Minimum iterations before considering convergence */
  minConvergenceIterations: number;
}

/**
 * Default quality configuration
 */
export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  minScore: 85,
  minCoverage: 80,
  maxIterations: 10,
  convergenceThreshold: 2,
  minConvergenceIterations: 2,
};

/**
 * Code generation request
 */
export interface CodeGenerationRequest {
  task: Task;
  context: string;
  previousCode?: string;
  feedback?: string;
  iteration: number;
}

/**
 * Code generation response
 */
export interface CodeGenerationResponse {
  files: GeneratedFile[];
  explanation: string;
  confidence: number;
}

/**
 * Generated file
 */
export interface GeneratedFile {
  path: string;
  content: string;
  action: "create" | "modify" | "delete";
}

/**
 * Code review result
 */
export interface CodeReviewResult {
  passed: boolean;
  scores: QualityScores;
  issues: ReviewIssue[];
  suggestions: ReviewSuggestion[];
  testResults: TestExecutionResult;
}

/**
 * Review issue
 */
export interface ReviewIssue {
  severity: "critical" | "major" | "minor" | "info";
  category: keyof QualityDimensions;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

/**
 * Review suggestion
 */
export interface ReviewSuggestion {
  type: "improvement" | "refactor" | "test" | "documentation";
  description: string;
  priority: "high" | "medium" | "low";
  impact: number;
}

/**
 * Test execution result
 */
export interface TestExecutionResult {
  passed: number;
  failed: number;
  skipped: number;
  coverage: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
  failures: TestFailureDetail[];
  duration: number;
}

/**
 * Test failure detail
 */
export interface TestFailureDetail {
  name: string;
  file: string;
  message: string;
  stack?: string;
  expected?: string;
  actual?: string;
}

/**
 * Iteration result
 */
export interface IterationResult {
  iteration: number;
  version: TaskVersion;
  review: CodeReviewResult;
  shouldContinue: boolean;
  reason: string;
}

/**
 * Convergence check result
 */
export interface ConvergenceCheck {
  converged: boolean;
  reason: string;
  scoreHistory: number[];
  improvement: number;
}

/**
 * Sprint execution result
 */
export interface SprintExecutionResult {
  sprintId: string;
  success: boolean;
  tasksCompleted: number;
  tasksTotal: number;
  averageQuality: number;
  totalIterations: number;
  taskResults: TaskExecutionResult[];
  duration: number;
}

/**
 * COMPLETE phase configuration
 */
export interface CompleteConfig {
  /** Quality configuration */
  quality: QualityConfig;

  /** Enable parallel task execution */
  parallelExecution: boolean;

  /** Maximum parallel tasks */
  maxParallelTasks: number;

  /** Save intermediate versions */
  saveVersions: boolean;

  /** Run tests after each iteration */
  runTestsEachIteration: boolean;

  /** Callback for progress updates */
  onProgress?: (progress: CompleteProgress) => void;

  /** Callback for user interaction */
  onUserInput?: (prompt: string) => Promise<string>;
}

/**
 * Default COMPLETE configuration
 */
export const DEFAULT_COMPLETE_CONFIG: CompleteConfig = {
  quality: DEFAULT_QUALITY_CONFIG,
  parallelExecution: false,
  maxParallelTasks: 3,
  saveVersions: true,
  runTestsEachIteration: true,
};

/**
 * Progress update
 */
export interface CompleteProgress {
  phase: "executing" | "reviewing" | "iterating" | "complete" | "blocked";
  sprintId: string;
  taskId?: string;
  taskTitle?: string;
  iteration?: number;
  currentScore?: number;
  tasksCompleted: number;
  tasksTotal: number;
  message: string;
}

/**
 * Version diff
 */
export interface VersionDiff {
  file: string;
  additions: number;
  deletions: number;
  diff: string;
}

/**
 * Rollback request
 */
export interface RollbackRequest {
  taskId: string;
  targetVersion: number;
  reason: string;
}

/**
 * Task state machine
 */
export type TaskState =
  | "pending"
  | "generating"
  | "reviewing"
  | "iterating"
  | "testing"
  | "completed"
  | "failed"
  | "rolled_back";

/**
 * State transition
 */
export interface StateTransition {
  from: TaskState;
  to: TaskState;
  timestamp: Date;
  trigger: string;
  metadata?: Record<string, unknown>;
}
