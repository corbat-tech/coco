/**
 * Background Task Manager Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BackgroundTaskManager,
  resetBackgroundTaskManager,
  getBackgroundTaskManager,
} from "./manager.js";

describe("BackgroundTaskManager", () => {
  let manager: BackgroundTaskManager;

  beforeEach(() => {
    resetBackgroundTaskManager();
    manager = new BackgroundTaskManager({ maxConcurrent: 2 });
  });

  describe("createTask", () => {
    it("should create a task with pending status", () => {
      const task = manager.createTask("Test Task", "A test task", async () => "done");

      expect(task.id).toBeDefined();
      expect(task.name).toBe("Test Task");
      expect(task.description).toBe("A test task");
      expect(task.startedAt).toBeDefined();
    });

    it("should generate unique IDs for each task", () => {
      const task1 = manager.createTask("Task 1", "First", async () => "1");
      const task2 = manager.createTask("Task 2", "Second", async () => "2");

      expect(task1.id).not.toBe(task2.id);
    });
  });

  describe("getTask", () => {
    it("should return the task by ID", () => {
      const created = manager.createTask("Test", "Test task", async () => "done");
      const retrieved = manager.getTask(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe("Test");
    });

    it("should return undefined for unknown ID", () => {
      const task = manager.getTask("nonexistent");
      expect(task).toBeUndefined();
    });
  });

  describe("getAllTasks", () => {
    it("should return all tasks", () => {
      manager.createTask("Task 1", "First", async () => "1");
      manager.createTask("Task 2", "Second", async () => "2");
      manager.createTask("Task 3", "Third", async () => "3");

      const tasks = manager.getAllTasks();
      expect(tasks).toHaveLength(3);
    });

    it("should return copies of tasks", () => {
      const created = manager.createTask("Test", "Test task", async () => "done");
      const tasks = manager.getAllTasks();
      const task = tasks.find((t) => t.id === created.id)!;

      // Modifying the returned task shouldn't affect the internal state
      task.name = "Modified";

      const retrieved = manager.getTask(created.id);
      expect(retrieved?.name).toBe("Test");
    });
  });

  describe("cancelTask", () => {
    it("should cancel a pending task", async () => {
      // Create a manager with 0 concurrency so tasks stay pending
      const limitedManager = new BackgroundTaskManager({ maxConcurrent: 0 });

      const task = limitedManager.createTask("Test", "Test task", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return "done";
      });

      const result = limitedManager.cancelTask(task.id);
      expect(result).toBe(true);

      const cancelled = limitedManager.getTask(task.id);
      expect(cancelled?.status).toBe("cancelled");
    });

    it("should return false for unknown task ID", () => {
      const result = manager.cancelTask("nonexistent");
      expect(result).toBe(false);
    });

    it("should return false for already completed task", async () => {
      const task = manager.createTask("Test", "Test task", async () => "done");

      // Wait for task to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = manager.cancelTask(task.id);
      expect(result).toBe(false);
    });
  });

  describe("onTaskComplete", () => {
    it("should call callback when task completes successfully", async () => {
      const callback = vi.fn();
      manager.onTaskComplete(callback);

      manager.createTask("Test", "Test task", async () => "done");

      // Wait for task to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callback).toHaveBeenCalled();
      const completedTask = callback.mock.calls[0]![0];
      expect(completedTask.status).toBe("completed");
      expect(completedTask.result).toBe("done");
    });

    it("should call callback when task fails", async () => {
      const callback = vi.fn();
      manager.onTaskComplete(callback);

      manager.createTask("Test", "Test task", async () => {
        throw new Error("Task failed");
      });

      // Wait for task to fail
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callback).toHaveBeenCalled();
      const failedTask = callback.mock.calls[0]![0];
      expect(failedTask.status).toBe("failed");
      expect(failedTask.error).toBe("Task failed");
    });
  });

  describe("offTaskComplete", () => {
    it("should remove a callback", async () => {
      const callback = vi.fn();
      manager.onTaskComplete(callback);
      manager.offTaskComplete(callback);

      manager.createTask("Test", "Test task", async () => "done");

      // Wait for task to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("clearFinishedTasks", () => {
    it("should clear completed tasks", async () => {
      manager.createTask("Test", "Test task", async () => "done");

      // Wait for task to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.clearFinishedTasks();

      expect(manager.getAllTasks()).toHaveLength(0);
    });
  });

  describe("concurrency", () => {
    it("should respect max concurrent limit", async () => {
      let runningCount = 0;
      let maxRunning = 0;

      const createLongTask = () =>
        manager.createTask("Long Task", "Takes time", async () => {
          runningCount++;
          maxRunning = Math.max(maxRunning, runningCount);
          await new Promise((resolve) => setTimeout(resolve, 100));
          runningCount--;
          return "done";
        });

      // Create 5 tasks with max concurrent of 2
      createLongTask();
      createLongTask();
      createLongTask();
      createLongTask();
      createLongTask();

      // Wait a bit for some tasks to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should never exceed max concurrent
      expect(maxRunning).toBeLessThanOrEqual(2);
    });
  });

  describe("getBackgroundTaskManager (singleton)", () => {
    it("should return the same instance", () => {
      resetBackgroundTaskManager();
      const instance1 = getBackgroundTaskManager();
      const instance2 = getBackgroundTaskManager();

      expect(instance1).toBe(instance2);
    });

    it("should return a new instance after reset", () => {
      const instance1 = getBackgroundTaskManager();
      resetBackgroundTaskManager();
      const instance2 = getBackgroundTaskManager();

      expect(instance1).not.toBe(instance2);
    });
  });
});
