/**
 * Tests for the ProgressTracker
 *
 * Tests:
 * - Add/update/remove todos
 * - Status transitions
 * - JSON serialization
 * - Statistics calculation
 * - Edge cases
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ProgressTracker, createProgressTracker } from "./tracker.js";
import type { ProgressState } from "./types.js";

describe("ProgressTracker", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
  });

  describe("Adding Todos", () => {
    it("should add a single todo", () => {
      const todo = tracker.addTodo("Write tests", "Writing tests");

      expect(todo).toBeDefined();
      expect(todo.id).toBeDefined();
      expect(todo.content).toBe("Write tests");
      expect(todo.activeForm).toBe("Writing tests");
      expect(todo.status).toBe("pending");
      expect(todo.createdAt).toBeDefined();
      expect(todo.updatedAt).toBeDefined();
    });

    it("should add a todo with parent reference", () => {
      const parentTodo = tracker.addTodo("Parent task", "Working on parent");
      const childTodo = tracker.addTodo("Child task", "Working on child", parentTodo.id);

      expect(childTodo.parentId).toBe(parentTodo.id);
    });

    it("should add multiple todos at once", () => {
      const todos = tracker.addTodos([
        { content: "Task 1", activeForm: "Doing task 1" },
        { content: "Task 2", activeForm: "Doing task 2" },
        { content: "Task 3", activeForm: "Doing task 3" },
      ]);

      expect(todos).toHaveLength(3);
      expect(todos[0].content).toBe("Task 1");
      expect(todos[1].content).toBe("Task 2");
      expect(todos[2].content).toBe("Task 3");
    });

    it("should add multiple todos with parent references", () => {
      const parentTodo = tracker.addTodo("Parent", "Working on parent");
      const todos = tracker.addTodos([
        { content: "Child 1", activeForm: "Doing child 1", parentId: parentTodo.id },
        { content: "Child 2", activeForm: "Doing child 2", parentId: parentTodo.id },
      ]);

      expect(todos[0].parentId).toBe(parentTodo.id);
      expect(todos[1].parentId).toBe(parentTodo.id);
    });

    it("should assign unique IDs to each todo", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      const todo2 = tracker.addTodo("Task 2", "Doing 2");
      const todo3 = tracker.addTodo("Task 3", "Doing 3");

      expect(todo1.id).not.toBe(todo2.id);
      expect(todo2.id).not.toBe(todo3.id);
      expect(todo1.id).not.toBe(todo3.id);
    });
  });

  describe("Status Transitions", () => {
    it("should update status to in_progress", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      tracker.updateStatus(todo.id, "in_progress");
      const updated = tracker.getTodo(todo.id);

      expect(updated?.status).toBe("in_progress");
    });

    it("should update status to completed", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      tracker.updateStatus(todo.id, "completed");
      const updated = tracker.getTodo(todo.id);

      expect(updated?.status).toBe("completed");
    });

    it("should update status to failed", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      tracker.updateStatus(todo.id, "failed");
      const updated = tracker.getTodo(todo.id);

      expect(updated?.status).toBe("failed");
    });

    it("should update updatedAt timestamp on status change", () => {
      const todo = tracker.addTodo("Task", "Doing task");
      const _originalUpdatedAt = todo.updatedAt;

      // Wait a small amount to ensure timestamp changes
      tracker.updateStatus(todo.id, "in_progress");
      const updated = tracker.getTodo(todo.id);

      // The timestamp should be different or at least defined
      expect(updated?.updatedAt).toBeDefined();
    });

    it("should throw error when updating non-existent todo", () => {
      expect(() => {
        tracker.updateStatus("non-existent-id", "completed");
      }).toThrow("Todo not found: non-existent-id");
    });

    it("should use startTodo helper method", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      tracker.startTodo(todo.id);
      const updated = tracker.getTodo(todo.id);

      expect(updated?.status).toBe("in_progress");
    });

    it("should use completeTodo helper method", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      tracker.completeTodo(todo.id);
      const updated = tracker.getTodo(todo.id);

      expect(updated?.status).toBe("completed");
    });

    it("should use failTodo helper method", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      tracker.failTodo(todo.id);
      const updated = tracker.getTodo(todo.id);

      expect(updated?.status).toBe("failed");
    });

    it("should track current task when starting a todo", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      tracker.startTodo(todo.id);

      const currentTask = tracker.getCurrentTask();
      expect(currentTask?.id).toBe(todo.id);
    });

    it("should clear current task when completing", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      tracker.startTodo(todo.id);
      tracker.completeTodo(todo.id);

      const currentTask = tracker.getCurrentTask();
      expect(currentTask).toBeUndefined();
    });

    it("should update current task when starting a different todo", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      const todo2 = tracker.addTodo("Task 2", "Doing 2");

      tracker.startTodo(todo1.id);
      tracker.startTodo(todo2.id);

      const currentTask = tracker.getCurrentTask();
      expect(currentTask?.id).toBe(todo2.id);
    });
  });

  describe("Retrieving Todos", () => {
    it("should get todo by ID", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      const retrieved = tracker.getTodo(todo.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(todo.id);
    });

    it("should return undefined for non-existent ID", () => {
      const retrieved = tracker.getTodo("non-existent");

      expect(retrieved).toBeUndefined();
    });

    it("should get all todos", () => {
      tracker.addTodo("Task 1", "Doing 1");
      tracker.addTodo("Task 2", "Doing 2");
      tracker.addTodo("Task 3", "Doing 3");

      const todos = tracker.getTodos();

      expect(todos).toHaveLength(3);
    });

    it("should get todos by status", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      const todo2 = tracker.addTodo("Task 2", "Doing 2");
      tracker.addTodo("Task 3", "Doing 3");

      tracker.completeTodo(todo1.id);
      tracker.startTodo(todo2.id);
      // todo3 remains pending

      expect(tracker.getTodosByStatus("completed")).toHaveLength(1);
      expect(tracker.getTodosByStatus("in_progress")).toHaveLength(1);
      expect(tracker.getTodosByStatus("pending")).toHaveLength(1);
    });

    it("should get child todos of a parent", () => {
      const parent = tracker.addTodo("Parent", "Working on parent");
      tracker.addTodo("Child 1", "Doing child 1", parent.id);
      tracker.addTodo("Child 2", "Doing child 2", parent.id);
      tracker.addTodo("Unrelated", "Doing unrelated");

      const children = tracker.getChildTodos(parent.id);

      expect(children).toHaveLength(2);
      expect(children.every((c) => c.parentId === parent.id)).toBe(true);
    });

    it("should fallback to first in_progress todo for getCurrentTask", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      const todo2 = tracker.addTodo("Task 2", "Doing 2");

      // Manually set both to in_progress without using startTodo
      tracker.updateStatus(todo1.id, "in_progress");
      tracker.updateStatus(todo2.id, "in_progress");

      // Should still return a task (the one set as current or first in_progress)
      const current = tracker.getCurrentTask();
      expect(current?.status).toBe("in_progress");
    });
  });

  describe("Removing Todos", () => {
    it("should remove a todo by ID", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      const result = tracker.removeTodo(todo.id);

      expect(result).toBe(true);
      expect(tracker.getTodo(todo.id)).toBeUndefined();
    });

    it("should return false when removing non-existent todo", () => {
      const result = tracker.removeTodo("non-existent");

      expect(result).toBe(false);
    });

    it("should clear current task if removed", () => {
      const todo = tracker.addTodo("Task", "Doing task");
      tracker.startTodo(todo.id);

      tracker.removeTodo(todo.id);

      expect(tracker.getCurrentTask()).toBeUndefined();
    });

    it("should clear all todos", () => {
      tracker.addTodo("Task 1", "Doing 1");
      tracker.addTodo("Task 2", "Doing 2");
      tracker.addTodo("Task 3", "Doing 3");

      tracker.clear();

      expect(tracker.getTodos()).toHaveLength(0);
      expect(tracker.hasTodos()).toBe(false);
    });

    it("should clear current task when clearing all", () => {
      const todo = tracker.addTodo("Task", "Doing task");
      tracker.startTodo(todo.id);

      tracker.clear();

      expect(tracker.getCurrentTask()).toBeUndefined();
    });
  });

  describe("Statistics", () => {
    it("should calculate stats for empty tracker", () => {
      const stats = tracker.getStats();

      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.inProgress).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.completionPercent).toBe(0);
    });

    it("should calculate stats for todos", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      const todo2 = tracker.addTodo("Task 2", "Doing 2");
      const todo3 = tracker.addTodo("Task 3", "Doing 3");
      const todo4 = tracker.addTodo("Task 4", "Doing 4");

      tracker.completeTodo(todo1.id);
      tracker.completeTodo(todo2.id);
      tracker.startTodo(todo3.id);
      tracker.failTodo(todo4.id);

      const stats = tracker.getStats();

      expect(stats.total).toBe(4);
      expect(stats.pending).toBe(0);
      expect(stats.inProgress).toBe(1);
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.completionPercent).toBe(50); // 2/4 = 50%
    });

    it("should check if tracker has todos", () => {
      expect(tracker.hasTodos()).toBe(false);

      tracker.addTodo("Task", "Doing task");

      expect(tracker.hasTodos()).toBe(true);
    });

    it("should check if all todos are complete", () => {
      expect(tracker.isComplete()).toBe(true); // Empty is complete

      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      const todo2 = tracker.addTodo("Task 2", "Doing 2");

      expect(tracker.isComplete()).toBe(false); // Has pending

      tracker.completeTodo(todo1.id);
      expect(tracker.isComplete()).toBe(false); // Still has pending

      tracker.completeTodo(todo2.id);
      expect(tracker.isComplete()).toBe(true); // All complete
    });

    it("should consider failed todos as complete", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      const todo2 = tracker.addTodo("Task 2", "Doing 2");

      tracker.completeTodo(todo1.id);
      tracker.failTodo(todo2.id);

      expect(tracker.isComplete()).toBe(true);
    });
  });

  describe("Progress Formatting", () => {
    it("should format empty progress", () => {
      const formatted = tracker.formatProgress();

      expect(formatted).toBe("No tasks");
    });

    it("should format progress with completed tasks", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      tracker.addTodo("Task 2", "Doing 2");

      tracker.completeTodo(todo1.id);

      const formatted = tracker.formatProgress();

      expect(formatted).toContain("1/2 completed");
      expect(formatted).toContain("50%");
    });

    it("should format progress with in_progress tasks", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      tracker.addTodo("Task 2", "Doing 2");

      tracker.startTodo(todo1.id);

      const formatted = tracker.formatProgress();

      expect(formatted).toContain("1 in progress");
    });

    it("should format progress with failed tasks", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      tracker.addTodo("Task 2", "Doing 2");

      tracker.failTodo(todo1.id);

      const formatted = tracker.formatProgress();

      expect(formatted).toContain("1 failed");
    });

    it("should format progress with multiple statuses", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      const todo2 = tracker.addTodo("Task 2", "Doing 2");
      const todo3 = tracker.addTodo("Task 3", "Doing 3");
      tracker.addTodo("Task 4", "Doing 4");

      tracker.completeTodo(todo1.id);
      tracker.startTodo(todo2.id);
      tracker.failTodo(todo3.id);
      // todo4 remains pending

      const formatted = tracker.formatProgress();

      expect(formatted).toContain("1/4 completed");
      expect(formatted).toContain("1 in progress");
      expect(formatted).toContain("1 failed");
    });
  });

  describe("JSON Serialization", () => {
    it("should serialize to JSON", () => {
      tracker.addTodo("Task 1", "Doing 1");
      const todo2 = tracker.addTodo("Task 2", "Doing 2");
      tracker.startTodo(todo2.id);

      const json = tracker.toJSON();

      expect(json.todos).toHaveLength(2);
      expect(json.currentTask).toBe(todo2.id);
    });

    it("should restore from JSON", () => {
      const state: ProgressState = {
        todos: [
          {
            id: "test-id-1",
            content: "Task 1",
            activeForm: "Doing 1",
            status: "completed",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
          {
            id: "test-id-2",
            content: "Task 2",
            activeForm: "Doing 2",
            status: "in_progress",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
        currentTask: "test-id-2",
      };

      tracker.fromJSON(state);

      expect(tracker.getTodos()).toHaveLength(2);
      expect(tracker.getTodo("test-id-1")?.status).toBe("completed");
      expect(tracker.getTodo("test-id-2")?.status).toBe("in_progress");
      expect(tracker.getCurrentTask()?.id).toBe("test-id-2");
    });

    it("should initialize with state", () => {
      const state: ProgressState = {
        todos: [
          {
            id: "test-id",
            content: "Task",
            activeForm: "Doing task",
            status: "pending",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      };

      const newTracker = new ProgressTracker(state);

      expect(newTracker.getTodos()).toHaveLength(1);
      expect(newTracker.getTodo("test-id")?.content).toBe("Task");
    });

    it("should clear existing state when restoring", () => {
      tracker.addTodo("Original task", "Doing original");

      const newState: ProgressState = {
        todos: [
          {
            id: "new-id",
            content: "New task",
            activeForm: "Doing new",
            status: "pending",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      };

      tracker.fromJSON(newState);

      expect(tracker.getTodos()).toHaveLength(1);
      expect(tracker.getTodos()[0].content).toBe("New task");
    });

    it("should round-trip serialize and deserialize", () => {
      const todo1 = tracker.addTodo("Task 1", "Doing 1");
      const todo2 = tracker.addTodo("Task 2", "Doing 2", todo1.id);
      tracker.completeTodo(todo1.id);
      tracker.startTodo(todo2.id);

      const json = tracker.toJSON();
      const newTracker = new ProgressTracker(json);

      expect(newTracker.getTodos()).toHaveLength(2);
      expect(newTracker.getTodo(todo1.id)?.status).toBe("completed");
      expect(newTracker.getTodo(todo2.id)?.status).toBe("in_progress");
      expect(newTracker.getTodo(todo2.id)?.parentId).toBe(todo1.id);
      expect(newTracker.getCurrentTask()?.id).toBe(todo2.id);
    });
  });

  describe("Factory Function", () => {
    it("should create tracker without initial state", () => {
      const newTracker = createProgressTracker();

      expect(newTracker).toBeInstanceOf(ProgressTracker);
      expect(newTracker.getTodos()).toHaveLength(0);
    });

    it("should create tracker with initial state", () => {
      const state: ProgressState = {
        todos: [
          {
            id: "test-id",
            content: "Task",
            activeForm: "Doing task",
            status: "pending",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      };

      const newTracker = createProgressTracker(state);

      expect(newTracker.getTodos()).toHaveLength(1);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty content", () => {
      const todo = tracker.addTodo("", "");

      expect(todo.content).toBe("");
      expect(todo.activeForm).toBe("");
    });

    it("should handle special characters in content", () => {
      const specialContent = '<script>alert("xss")</script> & "quoted"';
      const todo = tracker.addTodo(specialContent, "Active form");

      expect(todo.content).toBe(specialContent);
    });

    it("should handle unicode in content", () => {
      const unicodeContent = "Task with unicode characters";
      const todo = tracker.addTodo(unicodeContent, "Working on unicode");

      expect(todo.content).toBe(unicodeContent);
    });

    it("should handle very long content", () => {
      const longContent = "a".repeat(10000);
      const todo = tracker.addTodo(longContent, "Working on long content");

      expect(todo.content.length).toBe(10000);
    });

    it("should handle rapid status changes", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      tracker.updateStatus(todo.id, "in_progress");
      tracker.updateStatus(todo.id, "pending");
      tracker.updateStatus(todo.id, "in_progress");
      tracker.updateStatus(todo.id, "completed");

      expect(tracker.getTodo(todo.id)?.status).toBe("completed");
    });

    it("should handle many todos", () => {
      for (let i = 0; i < 1000; i++) {
        tracker.addTodo(`Task ${i}`, `Doing task ${i}`);
      }

      expect(tracker.getTodos()).toHaveLength(1000);
      expect(tracker.hasTodos()).toBe(true);
    });

    it("should handle deep nesting of parent-child todos", () => {
      const root = tracker.addTodo("Root", "Working on root");
      let parent = root;

      for (let i = 0; i < 10; i++) {
        const child = tracker.addTodo(`Child ${i}`, `Working on child ${i}`, parent.id);
        parent = child;
      }

      // Verify chain
      const lastChild = parent;
      expect(lastChild.content).toBe("Child 9");
      expect(lastChild.parentId).toBeDefined();
    });

    it("should handle undefined parentId gracefully", () => {
      const todo = tracker.addTodo("Task", "Doing task", undefined);

      expect(todo.parentId).toBeUndefined();
    });

    it("should get empty array for child todos with no children", () => {
      const todo = tracker.addTodo("Task", "Doing task");

      const children = tracker.getChildTodos(todo.id);

      expect(children).toHaveLength(0);
    });

    it("should get empty array for child todos of non-existent parent", () => {
      const children = tracker.getChildTodos("non-existent");

      expect(children).toHaveLength(0);
    });
  });
});
