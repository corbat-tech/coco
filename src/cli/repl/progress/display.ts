/**
 * Progress Display
 *
 * Functions to render progress information in the terminal.
 */

import chalk from "chalk";

// Alias for consistency with original code
const pc = chalk;
import type { TodoItem, ProgressStats } from './types.js';

/**
 * Status icons for todo items
 */
const STATUS_ICONS: Record<string, string> = {
  pending: pc.dim('○'),
  in_progress: pc.cyan('◐'),
  completed: pc.green('●'),
  failed: pc.red('✖'),
};

/**
 * Status labels for todo items
 * Used for verbose output when needed
 */
export const STATUS_LABELS: Record<string, string> = {
  pending: pc.dim('pending'),
  in_progress: pc.cyan('in progress'),
  completed: pc.green('completed'),
  failed: pc.red('failed'),
};

/**
 * Render a progress bar
 * @param completed Number of completed items
 * @param total Total number of items
 * @param width Width of the progress bar in characters (default 20)
 * @returns Formatted progress bar string
 */
export function renderProgressBar(
  completed: number,
  total: number,
  width: number = 20
): string {
  if (total === 0) {
    return pc.dim('[' + ' '.repeat(width) + '] 0%');
  }

  const percent = Math.min(100, (completed / total) * 100);
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  const bar = pc.green('█'.repeat(filled)) + pc.dim('░'.repeat(empty));
  const percentStr = `${percent.toFixed(0)}%`.padStart(4);

  return `[${bar}] ${percentStr}`;
}

/**
 * Render a single todo item
 * @param todo Todo item to render
 * @param indent Indentation level (default 0)
 * @returns Formatted todo string
 */
export function renderTodoItem(todo: TodoItem, indent: number = 0): string {
  const icon = STATUS_ICONS[todo.status];
  const indentStr = '  '.repeat(indent);

  let content: string;
  if (todo.status === 'in_progress') {
    content = pc.cyan(todo.activeForm);
  } else if (todo.status === 'completed') {
    content = pc.dim(todo.content);
  } else if (todo.status === 'failed') {
    content = pc.red(todo.content);
  } else {
    content = todo.content;
  }

  return `${indentStr}${icon} ${content}`;
}

/**
 * Render a list of todo items
 * @param todos Array of todo items
 * @param showNested Whether to show nested todos (default true)
 * @returns Formatted todo list string
 */
export function renderTodoList(
  todos: TodoItem[],
  showNested: boolean = true
): string {
  if (todos.length === 0) {
    return pc.dim('No tasks');
  }

  const lines: string[] = [];

  // Get root todos (no parentId)
  const rootTodos = todos.filter((t) => !t.parentId);
  const childrenMap = new Map<string, TodoItem[]>();

  // Build children map
  if (showNested) {
    for (const todo of todos) {
      if (todo.parentId) {
        const children = childrenMap.get(todo.parentId) ?? [];
        children.push(todo);
        childrenMap.set(todo.parentId, children);
      }
    }
  }

  // Render todos with children
  for (const todo of rootTodos) {
    lines.push(renderTodoItem(todo, 0));

    const children = childrenMap.get(todo.id);
    if (children) {
      for (const child of children) {
        lines.push(renderTodoItem(child, 1));
      }
    }
  }

  return lines.join('\n');
}

/**
 * Render the current task prominently
 * @param task Current task todo item
 * @returns Formatted current task string
 */
export function renderCurrentTask(task: TodoItem): string {
  const spinner = pc.cyan('◐');
  const label = pc.dim('Current:');
  const content = pc.cyan(pc.bold(task.activeForm));

  return `${spinner} ${label} ${content}`;
}

/**
 * Render progress statistics
 * @param stats Progress statistics
 * @returns Formatted statistics string
 */
export function renderProgressStats(stats: ProgressStats): string {
  const parts: string[] = [];

  if (stats.completed > 0) {
    parts.push(pc.green(`${stats.completed} completed`));
  }
  if (stats.inProgress > 0) {
    parts.push(pc.cyan(`${stats.inProgress} in progress`));
  }
  if (stats.pending > 0) {
    parts.push(pc.dim(`${stats.pending} pending`));
  }
  if (stats.failed > 0) {
    parts.push(pc.red(`${stats.failed} failed`));
  }

  if (parts.length === 0) {
    return pc.dim('No tasks');
  }

  return parts.join(pc.dim(' | '));
}

/**
 * Render a compact progress summary
 * @param stats Progress statistics
 * @returns Compact progress string
 */
export function renderCompactProgress(stats: ProgressStats): string {
  if (stats.total === 0) {
    return '';
  }

  const bar = renderProgressBar(stats.completed, stats.total, 10);
  return `${bar} ${pc.dim(`${stats.completed}/${stats.total}`)}`;
}

/**
 * Render full progress display with bar, stats, and optional current task
 * @param todos All todo items
 * @param currentTask Current task (optional)
 * @returns Full progress display string
 */
export function renderFullProgress(
  todos: TodoItem[],
  currentTask?: TodoItem
): string {
  const lines: string[] = [];

  // Calculate stats
  const total = todos.length;
  const completed = todos.filter((t) => t.status === 'completed').length;
  const failed = todos.filter((t) => t.status === 'failed').length;
  const inProgress = todos.filter((t) => t.status === 'in_progress').length;
  const pending = todos.filter((t) => t.status === 'pending').length;

  // Header with progress bar
  if (total > 0) {
    const bar = renderProgressBar(completed, total);
    lines.push(`${pc.bold('Progress:')} ${bar}`);
    lines.push('');
  }

  // Current task
  if (currentTask) {
    lines.push(renderCurrentTask(currentTask));
    lines.push('');
  }

  // Stats summary
  const stats: ProgressStats = {
    total,
    pending,
    inProgress,
    completed,
    failed,
    completionPercent: total > 0 ? (completed / total) * 100 : 0,
  };
  lines.push(renderProgressStats(stats));

  return lines.join('\n');
}
