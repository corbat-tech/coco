/**
 * Progress Tracker
 *
 * Manages todo items for tracking task progress in the REPL.
 */

import { randomUUID } from 'node:crypto';
import type {
  TodoItem,
  TodoStatus,
  ProgressState,
  ProgressStats,
} from './types.js';

/**
 * Tracks progress of tasks via a todo list
 */
export class ProgressTracker {
  private todos: Map<string, TodoItem> = new Map();
  private currentTaskId?: string;

  /**
   * Create a new progress tracker
   * @param initialState Optional initial state to restore from
   */
  constructor(initialState?: ProgressState) {
    if (initialState) {
      this.fromJSON(initialState);
    }
  }

  /**
   * Add a new todo item
   * @param content Description of what needs to be done (imperative form)
   * @param activeForm Present tense description shown during execution
   * @param parentId Optional parent todo ID for nested todos
   * @returns The created todo item
   */
  addTodo(content: string, activeForm: string, parentId?: string): TodoItem {
    const now = new Date().toISOString();
    const todo: TodoItem = {
      id: randomUUID(),
      content,
      activeForm,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      parentId,
    };

    this.todos.set(todo.id, todo);
    return todo;
  }

  /**
   * Add multiple todos at once
   * @param items Array of { content, activeForm, parentId } objects
   * @returns Array of created todo items
   */
  addTodos(
    items: Array<{ content: string; activeForm: string; parentId?: string }>
  ): TodoItem[] {
    return items.map((item) =>
      this.addTodo(item.content, item.activeForm, item.parentId)
    );
  }

  /**
   * Update the status of a todo
   * @param id Todo ID
   * @param status New status
   * @throws Error if todo not found
   */
  updateStatus(id: string, status: TodoStatus): void {
    const todo = this.todos.get(id);
    if (!todo) {
      throw new Error(`Todo not found: ${id}`);
    }

    todo.status = status;
    todo.updatedAt = new Date().toISOString();

    // Update current task tracking
    if (status === 'in_progress') {
      this.currentTaskId = id;
    } else if (this.currentTaskId === id) {
      this.currentTaskId = undefined;
    }
  }

  /**
   * Start a todo (set to in_progress)
   * @param id Todo ID
   */
  startTodo(id: string): void {
    this.updateStatus(id, 'in_progress');
  }

  /**
   * Complete a todo
   * @param id Todo ID
   */
  completeTodo(id: string): void {
    this.updateStatus(id, 'completed');
  }

  /**
   * Mark a todo as failed
   * @param id Todo ID
   */
  failTodo(id: string): void {
    this.updateStatus(id, 'failed');
  }

  /**
   * Get a todo by ID
   * @param id Todo ID
   * @returns The todo item or undefined
   */
  getTodo(id: string): TodoItem | undefined {
    return this.todos.get(id);
  }

  /**
   * Get all todos
   * @returns Array of all todo items
   */
  getTodos(): TodoItem[] {
    return Array.from(this.todos.values());
  }

  /**
   * Get todos filtered by status
   * @param status Status to filter by
   * @returns Array of matching todo items
   */
  getTodosByStatus(status: TodoStatus): TodoItem[] {
    return this.getTodos().filter((todo) => todo.status === status);
  }

  /**
   * Get child todos of a parent
   * @param parentId Parent todo ID
   * @returns Array of child todo items
   */
  getChildTodos(parentId: string): TodoItem[] {
    return this.getTodos().filter((todo) => todo.parentId === parentId);
  }

  /**
   * Get the currently in-progress task
   * @returns The current task or undefined
   */
  getCurrentTask(): TodoItem | undefined {
    if (this.currentTaskId) {
      return this.todos.get(this.currentTaskId);
    }
    // Fall back to first in_progress todo
    return this.getTodosByStatus('in_progress')[0];
  }

  /**
   * Get progress statistics
   * @returns Progress stats object
   */
  getStats(): ProgressStats {
    const todos = this.getTodos();
    const total = todos.length;
    const pending = todos.filter((t) => t.status === 'pending').length;
    const inProgress = todos.filter((t) => t.status === 'in_progress').length;
    const completed = todos.filter((t) => t.status === 'completed').length;
    const failed = todos.filter((t) => t.status === 'failed').length;

    const completionPercent = total > 0 ? (completed / total) * 100 : 0;

    return {
      total,
      pending,
      inProgress,
      completed,
      failed,
      completionPercent,
    };
  }

  /**
   * Remove a todo
   * @param id Todo ID
   * @returns true if removed, false if not found
   */
  removeTodo(id: string): boolean {
    if (this.currentTaskId === id) {
      this.currentTaskId = undefined;
    }
    return this.todos.delete(id);
  }

  /**
   * Clear all todos
   */
  clear(): void {
    this.todos.clear();
    this.currentTaskId = undefined;
  }

  /**
   * Check if there are any todos
   * @returns true if there are todos
   */
  hasTodos(): boolean {
    return this.todos.size > 0;
  }

  /**
   * Check if all todos are completed
   * @returns true if all todos are completed (or no todos exist)
   */
  isComplete(): boolean {
    const todos = this.getTodos();
    if (todos.length === 0) return true;
    return todos.every(
      (t) => t.status === 'completed' || t.status === 'failed'
    );
  }

  /**
   * Format progress for display
   * @returns Formatted progress string
   */
  formatProgress(): string {
    const stats = this.getStats();
    if (stats.total === 0) {
      return 'No tasks';
    }

    const parts: string[] = [];
    parts.push(`${stats.completed}/${stats.total} completed`);

    if (stats.inProgress > 0) {
      parts.push(`${stats.inProgress} in progress`);
    }
    if (stats.failed > 0) {
      parts.push(`${stats.failed} failed`);
    }

    return `${parts.join(', ')} (${stats.completionPercent.toFixed(0)}%)`;
  }

  /**
   * Serialize to JSON
   * @returns Serializable progress state
   */
  toJSON(): ProgressState {
    return {
      todos: this.getTodos(),
      currentTask: this.currentTaskId,
    };
  }

  /**
   * Restore from JSON state
   * @param state Progress state to restore
   */
  fromJSON(state: ProgressState): void {
    this.todos.clear();
    for (const todo of state.todos) {
      this.todos.set(todo.id, todo);
    }
    this.currentTaskId = state.currentTask;
  }
}

/**
 * Create a new progress tracker
 * @param initialState Optional initial state
 * @returns New ProgressTracker instance
 */
export function createProgressTracker(
  initialState?: ProgressState
): ProgressTracker {
  return new ProgressTracker(initialState);
}
