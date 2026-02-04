/**
 * Background Task Module
 *
 * Exports all background task functionality for managing tasks
 * that run asynchronously while the user continues interacting.
 */

// Types
export type {
  BackgroundTask,
  BackgroundTaskStatus,
  TaskExecutor,
  TaskCompleteCallback,
  BackgroundTaskManagerOptions,
} from "./types.js";

// Manager
export {
  BackgroundTaskManager,
  getBackgroundTaskManager,
  resetBackgroundTaskManager,
} from "./manager.js";

// Display
export {
  renderTaskStatus,
  renderTaskList,
  renderTaskNotification,
} from "./display.js";
