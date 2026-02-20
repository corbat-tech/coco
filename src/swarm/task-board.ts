/**
 * Swarm Task Board
 *
 * JSON task board stored at .coco/swarm/task-board.json.
 * Tracks all swarm tasks, their status, and dependencies.
 */

import type { SwarmAgentRole } from "./agents/types.js";
import type { SwarmFeature } from "./spec-parser.js";

/**
 * Type of task in the swarm pipeline
 */
export type SwarmTaskType = "acceptance-test" | "implement" | "integrate" | "review";

/**
 * Current status of a swarm task
 */
export type SwarmTaskStatus = "pending" | "in_progress" | "done" | "failed" | "blocked";

/**
 * A single task on the swarm board
 */
export interface SwarmTask {
  id: string;
  featureId: string;
  type: SwarmTaskType;
  title: string;
  description: string;
  /** IDs of other tasks that must be done before this one */
  dependencies: string[];
  status: SwarmTaskStatus;
  assignedRole?: SwarmAgentRole;
  iterations: number;
  createdAt: string;
  updatedAt: string;
  result?: string;
  failureReason?: string;
}

/**
 * The full task board for a swarm run
 */
export interface SwarmBoard {
  projectName: string;
  features: SwarmFeature[];
  tasks: SwarmTask[];
  stats: {
    total: number;
    done: number;
    failed: number;
    inProgress: number;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Create a fresh task board from a spec.
 * Generates acceptance-test + implement tasks for each feature,
 * plus a single integrate task at the end.
 */
export async function createBoard(
  projectPath: string,
  spec: { projectName: string; features: SwarmFeature[] },
): Promise<SwarmBoard> {
  const now = new Date().toISOString();
  const tasks: SwarmTask[] = [];

  for (const feature of spec.features) {
    const acceptanceTestId = `task-${feature.id}-acceptance-test`;
    const implementId = `task-${feature.id}-implement`;

    // Map feature dependencies to their acceptance-test task IDs
    const featureDepTaskIds = feature.dependencies.map(
      (depFeatureId) => `task-${depFeatureId}-implement`,
    );

    tasks.push({
      id: acceptanceTestId,
      featureId: feature.id,
      type: "acceptance-test",
      title: `Write acceptance tests (RED) for: ${feature.name}`,
      description: `TDD Red phase: write failing acceptance tests for feature "${feature.name}" based on acceptance criteria.`,
      dependencies: featureDepTaskIds,
      status: "pending",
      iterations: 0,
      createdAt: now,
      updatedAt: now,
    });

    tasks.push({
      id: implementId,
      featureId: feature.id,
      type: "implement",
      title: `Implement: ${feature.name}`,
      description: `TDD Green+Refactor phase: implement "${feature.name}" to make acceptance tests pass, then refactor.`,
      dependencies: [acceptanceTestId],
      status: "pending",
      iterations: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Single integrate task that depends on all implement tasks
  const allImplementTaskIds = spec.features.map((f) => `task-${f.id}-implement`);
  tasks.push({
    id: "task-integrate",
    featureId: "integration",
    type: "integrate",
    title: "Integrate all features",
    description:
      "Run end-to-end integration: resolve conflicts, verify all tests pass, check TypeScript build.",
    dependencies: allImplementTaskIds,
    status: "pending",
    iterations: 0,
    createdAt: now,
    updatedAt: now,
  });

  const board: SwarmBoard = {
    projectName: spec.projectName,
    features: spec.features,
    tasks,
    stats: computeStats(tasks),
    createdAt: now,
    updatedAt: now,
  };

  await saveBoard(projectPath, board);
  return board;
}

/**
 * Load the task board from disk.
 * Throws if the board file doesn't exist.
 */
export async function loadBoard(projectPath: string): Promise<SwarmBoard> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const boardPath = path.join(projectPath, ".coco", "swarm", "task-board.json");
  const raw = await fs.readFile(boardPath, "utf-8");
  return JSON.parse(raw) as SwarmBoard;
}

/**
 * Persist the task board to disk.
 */
export async function saveBoard(projectPath: string, board: SwarmBoard): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const boardDir = path.join(projectPath, ".coco", "swarm");
  const boardPath = path.join(boardDir, "task-board.json");

  await fs.mkdir(boardDir, { recursive: true });
  await fs.writeFile(boardPath, JSON.stringify(board, null, 2), "utf-8");
}

/**
 * Returns the next task that is ready to execute:
 * - status is "pending"
 * - all dependencies are "done"
 *
 * Returns null if no task is ready.
 */
export function getNextTask(board: SwarmBoard): SwarmTask | null {
  const doneIds = new Set(board.tasks.filter((t) => t.status === "done").map((t) => t.id));

  for (const task of board.tasks) {
    if (task.status !== "pending") continue;
    const allDepsDone = task.dependencies.every((depId) => doneIds.has(depId));
    if (allDepsDone) {
      return task;
    }
  }

  return null;
}

/**
 * Mark a task as in-progress (immutable update — returns new board).
 */
export function markTaskInProgress(
  board: SwarmBoard,
  taskId: string,
  role: SwarmAgentRole,
): SwarmBoard {
  const now = new Date().toISOString();
  const tasks = board.tasks.map((t) => {
    if (t.id !== taskId) return t;
    return { ...t, status: "in_progress" as SwarmTaskStatus, assignedRole: role, updatedAt: now };
  });
  return { ...board, tasks, stats: computeStats(tasks), updatedAt: now };
}

/**
 * Mark a task as done (immutable update — returns new board).
 */
export function markTaskDone(board: SwarmBoard, taskId: string, result: string): SwarmBoard {
  const now = new Date().toISOString();
  const tasks = board.tasks.map((t) => {
    if (t.id !== taskId) return t;
    return {
      ...t,
      status: "done" as SwarmTaskStatus,
      result,
      updatedAt: now,
      iterations: t.iterations + 1,
    };
  });
  return { ...board, tasks, stats: computeStats(tasks), updatedAt: now };
}

/**
 * Mark a task as failed (immutable update — returns new board).
 */
export function markTaskFailed(board: SwarmBoard, taskId: string, reason: string): SwarmBoard {
  const now = new Date().toISOString();
  const tasks = board.tasks.map((t) => {
    if (t.id !== taskId) return t;
    return {
      ...t,
      status: "failed" as SwarmTaskStatus,
      failureReason: reason,
      updatedAt: now,
      iterations: t.iterations + 1,
    };
  });
  return { ...board, tasks, stats: computeStats(tasks), updatedAt: now };
}

/**
 * Get board statistics
 */
export function getBoardStats(board: SwarmBoard): {
  total: number;
  done: number;
  failed: number;
  inProgress: number;
  pendingCount: number;
} {
  const total = board.tasks.length;
  const done = board.tasks.filter((t) => t.status === "done").length;
  const failed = board.tasks.filter((t) => t.status === "failed").length;
  const inProgress = board.tasks.filter((t) => t.status === "in_progress").length;
  const pendingCount = board.tasks.filter((t) => t.status === "pending").length;
  return { total, done, failed, inProgress, pendingCount };
}

function computeStats(tasks: SwarmTask[]): SwarmBoard["stats"] {
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
  };
}
