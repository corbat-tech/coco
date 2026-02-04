/**
 * Background Task Display Tests
 */

import { describe, it, expect } from "vitest";
import {
  renderTaskStatus,
  renderTaskList,
  renderTaskNotification,
} from "./display.js";
import type { BackgroundTask } from "./types.js";

describe("Background Task Display", () => {
  const createTask = (overrides: Partial<BackgroundTask> = {}): BackgroundTask => ({
    id: "task_123_abc",
    name: "Test Task",
    description: "A test task description",
    status: "pending",
    startedAt: new Date().toISOString(),
    ...overrides,
  });

  describe("renderTaskStatus", () => {
    it("should render pending task", () => {
      const task = createTask({ status: "pending" });
      const output = renderTaskStatus(task);

      expect(output).toContain("Test Task");
      expect(output).toContain("task_123_abc");
      expect(output).toContain("A test task description");
    });

    it("should render running task with progress", () => {
      const task = createTask({
        status: "running",
        progress: 50,
      });
      const output = renderTaskStatus(task);

      expect(output).toContain("Test Task");
      expect(output).toContain("50%");
    });

    it("should render completed task with result", () => {
      const task = createTask({
        status: "completed",
        result: "Task completed successfully",
        completedAt: new Date().toISOString(),
      });
      const output = renderTaskStatus(task);

      expect(output).toContain("Test Task");
      expect(output).toContain("Task completed successfully");
    });

    it("should render failed task with error", () => {
      const task = createTask({
        status: "failed",
        error: "Something went wrong",
        completedAt: new Date().toISOString(),
      });
      const output = renderTaskStatus(task);

      expect(output).toContain("Test Task");
      expect(output).toContain("Something went wrong");
    });

    it("should truncate long results", () => {
      const longResult = "x".repeat(200);
      const task = createTask({
        status: "completed",
        result: longResult,
        completedAt: new Date().toISOString(),
      });
      const output = renderTaskStatus(task);

      expect(output).toContain("...");
      expect(output.length).toBeLessThan(longResult.length + 200);
    });
  });

  describe("renderTaskList", () => {
    it("should render empty list message", () => {
      const output = renderTaskList([]);
      expect(output).toContain("No background tasks");
    });

    it("should render multiple tasks grouped by status", () => {
      const tasks: BackgroundTask[] = [
        createTask({ id: "1", name: "Running Task", status: "running" }),
        createTask({ id: "2", name: "Pending Task", status: "pending" }),
        createTask({
          id: "3",
          name: "Completed Task",
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
        createTask({
          id: "4",
          name: "Failed Task",
          status: "failed",
          error: "Error",
          completedAt: new Date().toISOString(),
        }),
      ];

      const output = renderTaskList(tasks);

      expect(output).toContain("Running (1)");
      expect(output).toContain("Pending (1)");
      expect(output).toContain("Completed (1)");
      expect(output).toContain("Failed (1)");
      expect(output).toContain("Running Task");
      expect(output).toContain("Pending Task");
      expect(output).toContain("Completed Task");
      expect(output).toContain("Failed Task");
    });

    it("should show task summary", () => {
      const tasks: BackgroundTask[] = [
        createTask({ id: "1", status: "running" }),
        createTask({ id: "2", status: "pending" }),
        createTask({
          id: "3",
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      ];

      const output = renderTaskList(tasks);

      expect(output).toContain("Total: 3 tasks");
    });
  });

  describe("renderTaskNotification", () => {
    it("should render completed task notification", () => {
      const task = createTask({
        status: "completed",
        completedAt: new Date().toISOString(),
      });
      const output = renderTaskNotification(task);

      expect(output).toContain("Test Task");
      expect(output).toContain("completed");
    });

    it("should render failed task notification with error", () => {
      const task = createTask({
        status: "failed",
        error: "Network error",
        completedAt: new Date().toISOString(),
      });
      const output = renderTaskNotification(task);

      expect(output).toContain("Test Task");
      expect(output).toContain("failed");
      expect(output).toContain("Network error");
    });

    it("should render cancelled task notification", () => {
      const task = createTask({
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });
      const output = renderTaskNotification(task);

      expect(output).toContain("Test Task");
      expect(output).toContain("cancelled");
    });
  });
});
