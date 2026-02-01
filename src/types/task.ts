/**
 * Task types for Corbat-Coco
 */

import type { QualityScores } from "../quality/types.js";

/**
 * Task in the backlog
 */
export interface Task {
  id: string;
  storyId: string;
  title: string;
  description: string;
  type: TaskType;
  files: string[];
  dependencies: string[];
  estimatedComplexity: TaskComplexity;
  status: TaskStatus;
  assignedSprint?: string;
}

/**
 * Task types
 */
export type TaskType =
  | "feature"    // New functionality
  | "test"       // Test implementation
  | "refactor"   // Code improvement
  | "docs"       // Documentation
  | "infra"      // Infrastructure
  | "config";    // Configuration

/**
 * Task complexity levels
 */
export type TaskComplexity =
  | "trivial"    // < 30 min
  | "simple"     // 30 min - 2 hours
  | "moderate"   // 2-8 hours
  | "complex";   // > 8 hours

/**
 * Task status
 */
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "rolled_back";

/**
 * Version of a task (iteration snapshot)
 */
export interface TaskVersion {
  version: number;
  timestamp: Date;

  /**
   * Files changed in this version
   */
  changes: TaskChanges;

  /**
   * Diffs for each changed file
   */
  diffs: FileDiff[];

  /**
   * Quality scores for this version
   */
  scores: QualityScores;

  /**
   * Test results
   */
  testResults: TaskTestResults;

  /**
   * Analysis and reasoning
   */
  analysis: TaskAnalysis;
}

/**
 * Changes made in a task version
 */
export interface TaskChanges {
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
}

/**
 * Diff for a single file
 */
export interface FileDiff {
  file: string;
  diff: string;
  additions: number;
  deletions: number;
}

/**
 * Test results for a task version
 */
export interface TaskTestResults {
  passed: number;
  failed: number;
  skipped: number;
  coverage: {
    lines: number;
    branches: number;
    functions: number;
  };
  failures: TestFailureInfo[];
}

/**
 * Information about a test failure
 */
export interface TestFailureInfo {
  name: string;
  file: string;
  message: string;
  stack?: string;
}

/**
 * Analysis of a task version
 */
export interface TaskAnalysis {
  /**
   * Issues found in this version
   */
  issuesFound: TaskIssue[];

  /**
   * Improvements applied from previous version
   */
  improvementsApplied: TaskImprovement[];

  /**
   * LLM reasoning for changes
   */
  reasoning: string;

  /**
   * Confidence level (0-100)
   */
  confidence: number;
}

/**
 * Issue found in task code
 */
export interface TaskIssue {
  category: IssueCategory;
  severity: "critical" | "major" | "minor" | "info";
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

/**
 * Issue categories
 */
export type IssueCategory =
  | "correctness"
  | "completeness"
  | "robustness"
  | "readability"
  | "maintainability"
  | "performance"
  | "security"
  | "testing"
  | "documentation"
  | "style";

/**
 * Improvement made to task code
 */
export interface TaskImprovement {
  category: IssueCategory;
  description: string;
  impact: "high" | "medium" | "low";
  scoreImpact: number;
}

/**
 * Complete history of a task
 */
export interface TaskHistory {
  taskId: string;
  task: Task;
  versions: TaskVersion[];
  currentVersion: number;
  status: TaskStatus;

  /**
   * Metrics
   */
  metrics: TaskMetrics;

  /**
   * Final result (if completed)
   */
  finalResult?: TaskFinalResult;
}

/**
 * Task execution metrics
 */
export interface TaskMetrics {
  totalIterations: number;
  totalTimeMs: number;
  llmCalls: number;
  tokensUsed: number;
  qualityProgression: number[];
  convergenceIteration?: number;
}

/**
 * Final result of completed task
 */
export interface TaskFinalResult {
  completedAt: Date;
  finalScore: number;
  totalIterations: number;
  filesCreated: string[];
  filesModified: string[];
  converged: boolean;
  convergenceReason: string;
}

/**
 * Story (user story containing tasks)
 */
export interface Story {
  id: string;
  epicId: string;
  title: string;
  asA: string;       // "As a [role]"
  iWant: string;     // "I want [feature]"
  soThat: string;    // "So that [benefit]"
  acceptanceCriteria: string[];
  tasks: string[];   // Task IDs
  points: number;    // Story points (1, 2, 3, 5, 8, 13)
  status: StoryStatus;
}

/**
 * Story status
 */
export type StoryStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "review"
  | "done";

/**
 * Epic (collection of related stories)
 */
export interface Epic {
  id: string;
  title: string;
  description: string;
  stories: string[];     // Story IDs
  priority: 1 | 2 | 3 | 4 | 5;
  dependencies: string[]; // Epic IDs
  status: EpicStatus;
}

/**
 * Epic status
 */
export type EpicStatus =
  | "planned"
  | "in_progress"
  | "done";

/**
 * Sprint
 */
export interface Sprint {
  id: string;
  name: string;
  goal: string;
  startDate: Date;
  endDate?: Date;
  stories: string[];  // Story IDs
  status: SprintStatus;
  metrics?: SprintMetrics;
}

/**
 * Sprint status
 */
export type SprintStatus =
  | "planning"
  | "active"
  | "review"
  | "completed";

/**
 * Sprint metrics
 */
export interface SprintMetrics {
  plannedPoints: number;
  completedPoints: number;
  tasksCompleted: number;
  tasksTotal: number;
  averageQuality: number;
  velocity: number;
}

/**
 * Backlog (all epics, stories, tasks)
 */
export interface Backlog {
  epics: Epic[];
  stories: Story[];
  tasks: Task[];
  currentSprint: Sprint | null;
  completedSprints: Sprint[];
}
