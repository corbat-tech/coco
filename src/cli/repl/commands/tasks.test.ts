/**
 * /tasks command tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { tasksCommand } from "./tasks.js";
import {
  BackgroundTaskManager,
  resetBackgroundTaskManager,
} from "../background/index.js";
import type { ReplSession } from "../types.js";

// Mock console.log to capture output
const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});

describe("tasksCommand", () => {
  let mockSession: ReplSession;

  beforeEach(() => {
    resetBackgroundTaskManager();
    mockLog.mockClear();

    mockSession = {
      id: "test-session",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      trustedTools: new Set(),
      config: {
        provider: {
          type: "anthropic",
          model: "claude-3-5-sonnet-20241022",
          maxTokens: 4096,
        },
        ui: {
          theme: "dark",
          showTimestamps: false,
          maxHistorySize: 100,
        },
        agent: {
          systemPrompt: "test prompt",
          maxToolIterations: 10,
          confirmDestructive: true,
        },
      },
    };
  });

  it("should have correct command properties", () => {
    expect(tasksCommand.name).toBe("tasks");
    expect(tasksCommand.aliases).toContain("bg");
    expect(tasksCommand.aliases).toContain("background");
    expect(tasksCommand.description).toBe("Show and manage background tasks");
  });

  it("should show empty task list", async () => {
    const shouldExit = await tasksCommand.execute([], mockSession);

    expect(shouldExit).toBe(false);
    expect(mockLog).toHaveBeenCalled();

    // Find a call that contains "No background tasks"
    const hasNoTasksMessage = mockLog.mock.calls.some((call) =>
      call.some((arg) => String(arg).includes("No background tasks"))
    );
    expect(hasNoTasksMessage).toBe(true);
  });

  it("should return false (not exit)", async () => {
    const result = await tasksCommand.execute([], mockSession);
    expect(result).toBe(false);
  });

  it("should handle cancel subcommand without task ID", async () => {
    await tasksCommand.execute(["cancel"], mockSession);

    const hasErrorMessage = mockLog.mock.calls.some((call) =>
      call.some((arg) => String(arg).includes("Please provide a task ID"))
    );
    expect(hasErrorMessage).toBe(true);
  });

  it("should handle cancel with unknown task ID", async () => {
    await tasksCommand.execute(["cancel", "nonexistent"], mockSession);

    const hasErrorMessage = mockLog.mock.calls.some((call) =>
      call.some((arg) => String(arg).includes("Task not found"))
    );
    expect(hasErrorMessage).toBe(true);
  });

  it("should handle clear subcommand", async () => {
    await tasksCommand.execute(["clear"], mockSession);

    const hasClearedMessage = mockLog.mock.calls.some((call) =>
      call.some((arg) => String(arg).includes("Cleared"))
    );
    expect(hasClearedMessage).toBe(true);
  });

  it("should handle unknown subcommand", async () => {
    await tasksCommand.execute(["unknown"], mockSession);

    const hasErrorMessage = mockLog.mock.calls.some((call) =>
      call.some((arg) => String(arg).includes("Unknown subcommand"))
    );
    expect(hasErrorMessage).toBe(true);
  });
});
