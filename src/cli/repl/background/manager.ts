/**
 * Background Task Manager
 *
 * Manages the lifecycle of background tasks including queuing,
 * execution, cancellation, and completion callbacks.
 */

import type {
  BackgroundTask,
  BackgroundTaskStatus,
  TaskExecutor,
  TaskCompleteCallback,
  BackgroundTaskManagerOptions,
} from "./types.js";

/**
 * Internal task entry with executor
 */
interface TaskEntry {
  task: BackgroundTask;
  executor: TaskExecutor;
  abortController: AbortController;
}

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Background Task Manager
 *
 * @description Manages background tasks with a configurable concurrency limit.
 * Tasks are queued and executed in order, with support for cancellation and
 * completion callbacks. This allows long-running operations to execute while
 * the user continues interacting with the REPL.
 *
 * @example
 * ```typescript
 * const manager = new BackgroundTaskManager({ maxConcurrent: 3 });
 *
 * // Create a background task
 * const task = manager.createTask(
 *   'analyze',
 *   'Analyzing codebase structure',
 *   async () => {
 *     // Long-running analysis...
 *     return 'Analysis complete';
 *   }
 * );
 *
 * // Listen for completion
 * manager.onTaskComplete((t) => console.log(`Task ${t.id} finished`));
 * ```
 */
export class BackgroundTaskManager {
  private readonly tasks: Map<string, TaskEntry> = new Map();
  private readonly completionCallbacks: TaskCompleteCallback[] = [];
  private readonly maxConcurrent: number;
  private runningCount: number = 0;

  /**
   * Create a new background task manager
   * @param options Configuration options
   */
  constructor(options: BackgroundTaskManagerOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 3;
  }

  /**
   * Create and queue a new background task
   *
   * @description Creates a new task and queues it for execution. If concurrency
   * limit permits, the task starts immediately; otherwise it waits in the queue.
   *
   * @param name - Short name for the task (e.g., 'analyze', 'build')
   * @param description - Detailed description of what the task does
   * @param executor - Async function that performs the task and returns a result string
   * @returns The created task object with initial 'pending' status
   *
   * @example
   * ```typescript
   * const task = manager.createTask('build', 'Building project', async () => {
   *   await runBuild();
   *   return 'Build successful';
   * });
   * console.log(task.id); // 'task_1704067200000_abc123'
   * ```
   */
  createTask(
    name: string,
    description: string,
    executor: TaskExecutor
  ): BackgroundTask {
    const task: BackgroundTask = {
      id: generateTaskId(),
      name,
      description,
      status: "pending",
      startedAt: new Date().toISOString(),
    };

    const entry: TaskEntry = {
      task,
      executor,
      abortController: new AbortController(),
    };

    this.tasks.set(task.id, entry);

    // Try to start the task immediately if we have capacity
    this.processQueue();

    return { ...task };
  }

  /**
   * Get a task by ID
   * @param id Task ID
   * @returns The task or undefined if not found
   */
  getTask(id: string): BackgroundTask | undefined {
    const entry = this.tasks.get(id);
    if (!entry) {
      return undefined;
    }
    return { ...entry.task };
  }

  /**
   * Get all tasks
   * @returns Array of all tasks (copies)
   */
  getAllTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).map((entry) => ({ ...entry.task }));
  }

  /**
   * Get tasks filtered by status
   * @param status Status to filter by
   * @returns Array of tasks with the given status
   */
  getTasksByStatus(status: BackgroundTaskStatus): BackgroundTask[] {
    return this.getAllTasks().filter((task) => task.status === status);
  }

  /**
   * Cancel a task by ID
   *
   * @description Cancels a pending or running task. Completed, failed, or already
   * cancelled tasks cannot be cancelled. For running tasks, sends an abort signal.
   *
   * @param id - Task ID to cancel
   * @returns true if the task was cancelled, false if not found or not cancellable
   */
  cancelTask(id: string): boolean {
    const entry = this.tasks.get(id);
    if (!entry) {
      return false;
    }

    const { task, abortController } = entry;

    // Can only cancel pending or running tasks
    if (task.status !== "pending" && task.status !== "running") {
      return false;
    }

    // Check if running before changing status (for running count)
    const wasRunning = task.status === "running";

    // Abort the task
    abortController.abort();

    // Update task status
    task.status = "cancelled";
    task.completedAt = new Date().toISOString();

    // If it was running, decrement the running count
    if (wasRunning) {
      this.runningCount--;
    }

    // Notify callbacks
    this.notifyCompletion(task);

    // Process queue in case there are pending tasks
    this.processQueue();

    return true;
  }

  /**
   * Register a callback for task completion events
   *
   * @description Registers a function to be called when any task completes,
   * fails, or is cancelled. Multiple callbacks can be registered.
   *
   * @param callback - Function to call when a task finishes (any final state)
   */
  onTaskComplete(callback: TaskCompleteCallback): void {
    this.completionCallbacks.push(callback);
  }

  /**
   * Remove a completion callback
   * @param callback The callback to remove
   */
  offTaskComplete(callback: TaskCompleteCallback): void {
    const index = this.completionCallbacks.indexOf(callback);
    if (index !== -1) {
      this.completionCallbacks.splice(index, 1);
    }
  }

  /**
   * Clear all completed/failed/cancelled tasks from the list
   */
  clearFinishedTasks(): void {
    for (const [id, entry] of this.tasks) {
      const { status } = entry.task;
      if (status === "completed" || status === "failed" || status === "cancelled") {
        this.tasks.delete(id);
      }
    }
  }

  /**
   * Get the number of running tasks
   *
   * @returns Count of tasks currently executing
   */
  getRunningCount(): number {
    return this.runningCount;
  }

  /**
   * Get the number of pending tasks
   *
   * @returns Count of tasks waiting to be executed
   */
  getPendingCount(): number {
    return this.getTasksByStatus("pending").length;
  }

  /**
   * Process the queue and start pending tasks if capacity allows
   */
  private processQueue(): void {
    if (this.runningCount >= this.maxConcurrent) {
      return;
    }

    // Find pending tasks
    for (const [, entry] of this.tasks) {
      if (entry.task.status === "pending" && this.runningCount < this.maxConcurrent) {
        this.startTask(entry);
      }
    }
  }

  /**
   * Start executing a task
   */
  private startTask(entry: TaskEntry): void {
    const { task, executor, abortController } = entry;

    task.status = "running";
    this.runningCount++;

    // Execute the task
    this.executeTask(task, executor, abortController.signal)
      .then((result) => {
        if (task.status === "running") {
          task.status = "completed";
          task.result = result;
          task.progress = 100;
          task.completedAt = new Date().toISOString();
        }
      })
      .catch((error: Error) => {
        if (task.status === "running") {
          if (error.name === "AbortError") {
            task.status = "cancelled";
          } else {
            task.status = "failed";
            task.error = error.message;
          }
          task.completedAt = new Date().toISOString();
        }
      })
      .finally(() => {
        if (task.status !== "pending") {
          this.runningCount--;
          this.notifyCompletion(task);
          this.processQueue();
        }
      });
  }

  /**
   * Execute a task with abort signal support
   */
  private async executeTask(
    _task: BackgroundTask,
    executor: TaskExecutor,
    signal: AbortSignal
  ): Promise<string> {
    // Check if already aborted
    if (signal.aborted) {
      const error = new Error("Task was cancelled");
      error.name = "AbortError";
      throw error;
    }

    // Create a wrapper that can be aborted
    return new Promise<string>((resolve, reject) => {
      // Handle abort signal
      const abortHandler = () => {
        const error = new Error("Task was cancelled");
        error.name = "AbortError";
        reject(error);
      };

      signal.addEventListener("abort", abortHandler, { once: true });

      // Execute the actual task
      executor()
        .then((result) => {
          signal.removeEventListener("abort", abortHandler);
          if (signal.aborted) {
            const error = new Error("Task was cancelled");
            error.name = "AbortError";
            reject(error);
          } else {
            resolve(result);
          }
        })
        .catch((error) => {
          signal.removeEventListener("abort", abortHandler);
          reject(error);
        });
    });
  }

  /**
   * Notify all completion callbacks
   */
  private notifyCompletion(task: BackgroundTask): void {
    const taskCopy = { ...task };
    for (const callback of this.completionCallbacks) {
      try {
        callback(taskCopy);
      } catch {
        // Ignore callback errors
      }
    }
  }
}

// Singleton instance for the application
let defaultManager: BackgroundTaskManager | null = null;

/**
 * Get the default background task manager instance
 *
 * @description Returns the singleton BackgroundTaskManager instance,
 * creating it if it doesn't exist. Use this for application-wide
 * background task management.
 *
 * @returns The singleton BackgroundTaskManager instance
 *
 * @example
 * ```typescript
 * const manager = getBackgroundTaskManager();
 * manager.createTask('sync', 'Syncing data', syncFunction);
 * ```
 */
export function getBackgroundTaskManager(): BackgroundTaskManager {
  if (!defaultManager) {
    defaultManager = new BackgroundTaskManager();
  }
  return defaultManager;
}

/**
 * Reset the default background task manager (mainly for testing)
 *
 * @description Clears the singleton instance, allowing a fresh manager
 * to be created on the next `getBackgroundTaskManager()` call.
 * Primarily used in tests to ensure isolation.
 */
export function resetBackgroundTaskManager(): void {
  defaultManager = null;
}
