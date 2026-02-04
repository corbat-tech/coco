/**
 * Background Task Display
 *
 * Functions to render background task information in the terminal.
 */

import chalk from "chalk";
import type { BackgroundTask, BackgroundTaskStatus } from "./types.js";

/**
 * Status icons for background tasks
 */
const STATUS_ICONS: Record<BackgroundTaskStatus, string> = {
  pending: chalk.dim("○"),
  running: chalk.cyan("◐"),
  completed: chalk.green("●"),
  failed: chalk.red("✖"),
  cancelled: chalk.yellow("⊘"),
};

/**
 * Status labels for background tasks
 */
const STATUS_LABELS: Record<BackgroundTaskStatus, string> = {
  pending: chalk.dim("pending"),
  running: chalk.cyan("running"),
  completed: chalk.green("completed"),
  failed: chalk.red("failed"),
  cancelled: chalk.yellow("cancelled"),
};

/**
 * Format a duration in milliseconds to a human-readable string
 * @param ms Duration in milliseconds
 * @returns Formatted duration string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Calculate elapsed time for a task
 * @param task The task to calculate elapsed time for
 * @returns Duration in milliseconds
 */
function getElapsedTime(task: BackgroundTask): number {
  const startTime = new Date(task.startedAt).getTime();
  const endTime = task.completedAt
    ? new Date(task.completedAt).getTime()
    : Date.now();
  return endTime - startTime;
}

/**
 * Render a progress bar
 * @param progress Progress percentage (0-100)
 * @param width Width of the progress bar in characters
 * @returns Formatted progress bar string
 */
function renderProgressBar(progress: number, width: number = 10): string {
  const percent = Math.min(100, Math.max(0, progress));
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  const bar = chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(empty));
  return `[${bar}]`;
}

/**
 * Render the status of a single task
 * @param task The task to render
 * @returns Formatted task status string
 */
export function renderTaskStatus(task: BackgroundTask): string {
  const lines: string[] = [];
  const icon = STATUS_ICONS[task.status];
  const statusLabel = STATUS_LABELS[task.status];
  const elapsed = formatDuration(getElapsedTime(task));

  // Header line with ID, name, and status
  lines.push(
    `${icon} ${chalk.bold(task.name)} ${chalk.dim(`[${task.id}]`)} - ${statusLabel}`
  );

  // Description
  lines.push(`  ${chalk.dim(task.description)}`);

  // Progress bar for running tasks with known progress
  if (task.status === "running" && task.progress !== undefined) {
    const bar = renderProgressBar(task.progress);
    lines.push(`  ${bar} ${task.progress}%`);
  }

  // Duration
  lines.push(`  ${chalk.dim("Duration:")} ${elapsed}`);

  // Result for completed tasks
  if (task.status === "completed" && task.result) {
    const resultPreview =
      task.result.length > 100
        ? task.result.slice(0, 97) + "..."
        : task.result;
    lines.push(`  ${chalk.dim("Result:")} ${chalk.green(resultPreview)}`);
  }

  // Error for failed tasks
  if (task.status === "failed" && task.error) {
    lines.push(`  ${chalk.dim("Error:")} ${chalk.red(task.error)}`);
  }

  return lines.join("\n");
}

/**
 * Render a list of tasks
 * @param tasks Array of tasks to render
 * @returns Formatted task list string
 */
export function renderTaskList(tasks: BackgroundTask[]): string {
  if (tasks.length === 0) {
    return chalk.dim("No background tasks");
  }

  const lines: string[] = [];

  // Header
  lines.push(chalk.cyan.bold("═══ Background Tasks ═══"));
  lines.push("");

  // Group tasks by status
  const running = tasks.filter((t) => t.status === "running");
  const pending = tasks.filter((t) => t.status === "pending");
  const completed = tasks.filter((t) => t.status === "completed");
  const failed = tasks.filter((t) => t.status === "failed");
  const cancelled = tasks.filter((t) => t.status === "cancelled");

  // Render running tasks first
  if (running.length > 0) {
    lines.push(chalk.cyan.bold(`Running (${running.length}):`));
    for (const task of running) {
      lines.push(renderTaskCompact(task));
    }
    lines.push("");
  }

  // Pending tasks
  if (pending.length > 0) {
    lines.push(chalk.dim(`Pending (${pending.length}):`));
    for (const task of pending) {
      lines.push(renderTaskCompact(task));
    }
    lines.push("");
  }

  // Completed tasks
  if (completed.length > 0) {
    lines.push(chalk.green(`Completed (${completed.length}):`));
    for (const task of completed) {
      lines.push(renderTaskCompact(task));
    }
    lines.push("");
  }

  // Failed tasks
  if (failed.length > 0) {
    lines.push(chalk.red(`Failed (${failed.length}):`));
    for (const task of failed) {
      lines.push(renderTaskCompact(task));
    }
    lines.push("");
  }

  // Cancelled tasks
  if (cancelled.length > 0) {
    lines.push(chalk.yellow(`Cancelled (${cancelled.length}):`));
    for (const task of cancelled) {
      lines.push(renderTaskCompact(task));
    }
    lines.push("");
  }

  // Summary
  lines.push(chalk.dim("─".repeat(30)));
  lines.push(renderTaskSummary(tasks));

  return lines.join("\n");
}

/**
 * Render a compact single-line view of a task
 * @param task The task to render
 * @returns Single-line task representation
 */
function renderTaskCompact(task: BackgroundTask): string {
  const icon = STATUS_ICONS[task.status];
  const elapsed = formatDuration(getElapsedTime(task));
  const id = chalk.dim(`[${task.id.slice(-8)}]`);

  let progress = "";
  if (task.status === "running" && task.progress !== undefined) {
    progress = chalk.cyan(` ${task.progress}%`);
  }

  let suffix = "";
  if (task.status === "failed" && task.error) {
    const shortError =
      task.error.length > 30 ? task.error.slice(0, 27) + "..." : task.error;
    suffix = chalk.red(` - ${shortError}`);
  }

  return `  ${icon} ${task.name} ${id}${progress} ${chalk.dim(elapsed)}${suffix}`;
}

/**
 * Render a summary of tasks
 * @param tasks Array of tasks
 * @returns Summary string
 */
function renderTaskSummary(tasks: BackgroundTask[]): string {
  const running = tasks.filter((t) => t.status === "running").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;

  const parts: string[] = [];

  if (running > 0) {
    parts.push(chalk.cyan(`${running} running`));
  }
  if (pending > 0) {
    parts.push(chalk.dim(`${pending} pending`));
  }
  if (completed > 0) {
    parts.push(chalk.green(`${completed} completed`));
  }
  if (failed > 0) {
    parts.push(chalk.red(`${failed} failed`));
  }

  return `Total: ${tasks.length} tasks (${parts.join(", ")})`;
}

/**
 * Render a notification for task completion
 * @param task The completed task
 * @returns Notification string
 */
export function renderTaskNotification(task: BackgroundTask): string {
  const icon = STATUS_ICONS[task.status];
  const elapsed = formatDuration(getElapsedTime(task));

  let message: string;
  switch (task.status) {
    case "completed":
      message = `${icon} Task "${task.name}" completed in ${elapsed}`;
      break;
    case "failed":
      message = `${icon} Task "${task.name}" failed: ${task.error ?? "Unknown error"}`;
      break;
    case "cancelled":
      message = `${icon} Task "${task.name}" was cancelled`;
      break;
    default:
      message = `${icon} Task "${task.name}" status: ${task.status}`;
  }

  return chalk.dim("─".repeat(40)) + "\n" + message + "\n" + chalk.dim("─".repeat(40));
}
