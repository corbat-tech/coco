import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock provider-bridge
vi.mock("../agents/provider-bridge.js", () => ({
  getAgentProvider: vi.fn(),
  getAgentToolRegistry: vi.fn(),
}));

// Mock AgentExecutor
vi.mock("../agents/executor.js", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    AgentExecutor: vi.fn().mockImplementation(() => ({
      execute: vi.fn(),
    })),
  };
});

import {
  AgentTaskQueue,
  planExecution,
  createAgentPlanTool,
  delegateTaskTool,
  aggregateResultsTool,
  agentCoordinatorTools,
} from "./agent-coordinator.js";
import { getAgentProvider, getAgentToolRegistry } from "../agents/provider-bridge.js";
import { AgentExecutor } from "../agents/executor.js";

const mockedGetAgentProvider = vi.mocked(getAgentProvider);
const mockedGetAgentToolRegistry = vi.mocked(getAgentToolRegistry);

describe("agent-coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── AgentTaskQueue ────────────────────────────────────────────────

  describe("AgentTaskQueue", () => {
    it("should add tasks and return an ID", () => {
      const queue = new AgentTaskQueue();
      const id = queue.addTask({
        description: "Test task",
        priority: "high",
        estimatedDuration: 100,
        dependencies: [],
      });

      expect(id).toBeTruthy();
      expect(queue.getTasks()).toHaveLength(1);
    });

    it("should use provided idOverride", () => {
      const queue = new AgentTaskQueue();
      const id = queue.addTask(
        {
          description: "Deterministic",
          priority: "medium",
          estimatedDuration: 100,
          dependencies: [],
        },
        "task-0",
      );

      expect(id).toBe("task-0");
      expect(queue.getTask("task-0")).toBeDefined();
      expect(queue.getTask("task-0")?.description).toBe("Deterministic");
    });

    it("should complete tasks and track completion order", () => {
      const queue = new AgentTaskQueue();
      const id1 = queue.addTask(
        { description: "First", priority: "high", estimatedDuration: 100, dependencies: [] },
        "t1",
      );
      const id2 = queue.addTask(
        { description: "Second", priority: "low", estimatedDuration: 50, dependencies: [] },
        "t2",
      );

      queue.completeTask(id2, { output: "result-2" });
      queue.completeTask(id1, { output: "result-1" });

      expect(queue.getTask(id1)?.status).toBe("completed");
      expect(queue.getTask(id1)?.result).toEqual({ output: "result-1" });
      expect(queue.getTask(id2)?.status).toBe("completed");
      expect(queue.getCompletionOrder()).toEqual(["t2", "t1"]);
    });

    it("should fail tasks with error message", () => {
      const queue = new AgentTaskQueue();
      const id = queue.addTask(
        { description: "Failing", priority: "high", estimatedDuration: 100, dependencies: [] },
        "fail-1",
      );

      queue.failTask(id, "Something went wrong");

      const task = queue.getTask(id);
      expect(task?.status).toBe("failed");
      expect(task?.error).toBe("Something went wrong");
    });

    it("should silently ignore complete/fail for non-existent IDs", () => {
      const queue = new AgentTaskQueue();
      queue.completeTask("nonexistent", {});
      queue.failTask("nonexistent", "error");
      // No error thrown
      expect(queue.getTasks()).toHaveLength(0);
    });

    it("should return pending tasks", () => {
      const queue = new AgentTaskQueue();
      queue.addTask(
        { description: "Pending", priority: "low", estimatedDuration: 100, dependencies: [] },
        "p1",
      );
      queue.addTask(
        { description: "ToComplete", priority: "low", estimatedDuration: 100, dependencies: [] },
        "p2",
      );

      queue.completeTask("p2", {});

      const pending = queue.getPendingTasks();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.id).toBe("p1");
    });

    it("should return ready tasks (dependencies met)", () => {
      const queue = new AgentTaskQueue();
      queue.addTask(
        { description: "First", priority: "high", estimatedDuration: 100, dependencies: [] },
        "dep-1",
      );
      queue.addTask(
        {
          description: "Depends on first",
          priority: "medium",
          estimatedDuration: 100,
          dependencies: ["dep-1"],
        },
        "dep-2",
      );
      queue.addTask(
        { description: "Independent", priority: "low", estimatedDuration: 100, dependencies: [] },
        "dep-3",
      );

      // Before completing dep-1, only independent tasks are ready
      let ready = queue.getReadyTasks();
      expect(ready.map((t) => t.id)).toEqual(["dep-1", "dep-3"]);

      // After completing dep-1, dep-2 becomes ready
      queue.completeTask("dep-1", {});
      ready = queue.getReadyTasks();
      expect(ready.map((t) => t.id)).toEqual(["dep-2", "dep-3"]);
    });

    it("should return undefined for non-existent task", () => {
      const queue = new AgentTaskQueue();
      expect(queue.getTask("nonexistent")).toBeUndefined();
    });

    it("should return empty completion order when no tasks completed", () => {
      const queue = new AgentTaskQueue();
      expect(queue.getCompletionOrder()).toEqual([]);
    });
  });

  // ─── planExecution ─────────────────────────────────────────────────

  describe("planExecution", () => {
    it("should plan parallel execution with all tasks", () => {
      const tasks = [
        { id: "task-0", description: "Task A", dependencies: [] },
        { id: "task-1", description: "Task B", dependencies: [] },
        { id: "task-2", description: "Task C", dependencies: [] },
      ];

      const plan = planExecution(tasks, "parallel");
      expect(plan.plan).toHaveLength(3);
      expect(plan.maxParallelism).toBe(3);
      expect(plan.estimatedTime).toBe(100);
      expect(plan.unresolvedDependencies).toHaveLength(0);
    });

    it("should plan sequential execution", () => {
      const tasks = [
        { id: "task-0", description: "Task A", dependencies: [] },
        { id: "task-1", description: "Task B", dependencies: [] },
      ];

      const plan = planExecution(tasks, "sequential");
      expect(plan.maxParallelism).toBe(1);
      expect(plan.estimatedTime).toBe(200); // 2 tasks * 100ms
      expect(plan.plan).toEqual(["task-0", "task-1"]);
    });

    it("should plan priority-based execution sorted by priority field", () => {
      const tasks = [
        { description: "Low priority task", priority: "low" },
        { description: "High priority task", priority: "high" },
        { description: "Medium priority task", priority: "medium" },
      ];

      const plan = planExecution(tasks, "priority-based");
      expect(plan.maxParallelism).toBe(3);
      // Sorted by priority: high > medium > low
      expect(plan.plan[0]).toBe("task-1"); // high
      expect(plan.plan[1]).toBe("task-2"); // medium
      expect(plan.plan[2]).toBe("task-0"); // low
      expect(plan.estimatedTime).toBe(240); // 3 * 80
    });

    it("should plan pipeline execution with topological sort", () => {
      const tasks = [
        { id: "task-0", description: "Build", dependencies: [] },
        { id: "task-1", description: "Test", dependencies: ["task-0"] },
        { id: "task-2", description: "Deploy", dependencies: ["task-1"] },
      ];

      const plan = planExecution(tasks, "pipeline");
      expect(plan.maxParallelism).toBe(2);
      // Topological order: task-0 before task-1, task-1 before task-2
      const idx0 = plan.plan.indexOf("task-0");
      const idx1 = plan.plan.indexOf("task-1");
      const idx2 = plan.plan.indexOf("task-2");
      expect(idx0).toBeLessThan(idx1);
      expect(idx1).toBeLessThan(idx2);
      expect(plan.estimatedTime).toBe(270); // 3 * 90
    });

    it("should detect circular dependencies in pipeline", () => {
      const tasks = [
        { id: "task-0", description: "A", dependencies: ["task-1"] },
        { id: "task-1", description: "B", dependencies: ["task-0"] },
      ];

      expect(() => planExecution(tasks, "pipeline")).toThrow("Circular dependency");
    });

    it("should report unresolved dependencies", () => {
      const tasks = [
        { id: "task-0", description: "Task A", dependencies: ["missing-dep"] },
        { id: "task-1", description: "Task B", dependencies: ["also-missing", "task-0"] },
      ];

      const plan = planExecution(tasks, "pipeline");
      expect(plan.unresolvedDependencies).toEqual([
        { taskId: "task-0", dependency: "missing-dep" },
        { taskId: "task-1", dependency: "also-missing" },
      ]);
      // Tasks should still be in the plan (with unresolved deps filtered out)
      expect(plan.plan).toContain("task-0");
      expect(plan.plan).toContain("task-1");
    });

    it("should auto-generate task IDs when not provided", () => {
      const tasks = [{ description: "No ID" }, { description: "Also no ID" }];

      const plan = planExecution(tasks, "parallel");
      expect(plan.plan).toEqual(["task-0", "task-1"]);
    });
  });

  // ─── createAgentPlanTool ───────────────────────────────────────────

  describe("createAgentPlanTool", () => {
    it("should have correct metadata", () => {
      expect(createAgentPlanTool.name).toBe("createAgentPlan");
      expect(createAgentPlanTool.category).toBe("build");
    });

    it("should create a plan with all tasks in pending state", async () => {
      const result = await createAgentPlanTool.execute({
        tasks: [
          { description: "Build components", priority: "high", dependencies: [] },
          { description: "Write tests", priority: "medium", dependencies: [] },
        ],
        strategy: "parallel",
      });

      expect(result.totalTasks).toBe(2);
      expect(result.strategy).toBe("parallel");
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks.every((t: any) => t.status === "pending")).toBe(true);
      expect(result.executionOrder).toHaveLength(2);
    });

    it("should normalize numeric dependency ids", async () => {
      const result = await createAgentPlanTool.execute({
        tasks: [
          { description: "First task", priority: "high", dependencies: [] },
          { description: "Second task", priority: "medium", dependencies: ["0"] },
        ],
        strategy: "sequential",
      });

      expect(result.tasks[1]?.dependencies).toEqual(["task-0"]);
      expect(result.executionOrder).toEqual(["task-0", "task-1"]);
    });

    it("should generate planId with timestamp prefix", async () => {
      const result = await createAgentPlanTool.execute({
        tasks: [{ description: "Single", priority: "low", dependencies: [] }],
        strategy: "parallel",
      });

      expect(result.planId).toMatch(/^plan-\d+$/);
    });

    it("should include unresolved dependencies in output", async () => {
      const result = await createAgentPlanTool.execute({
        tasks: [{ description: "Has missing dep", priority: "high", dependencies: ["ext-dep"] }],
        strategy: "parallel",
      });

      expect(result.unresolvedDependencies.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── delegateTaskTool ──────────────────────────────────────────────

  describe("delegateTaskTool", () => {
    it("should have correct metadata", () => {
      expect(delegateTaskTool.name).toBe("delegateTask");
      expect(delegateTaskTool.category).toBe("build");
    });

    it("should return unavailable when provider is not initialized", async () => {
      mockedGetAgentProvider.mockReturnValue(null);
      mockedGetAgentToolRegistry.mockReturnValue(null);

      const result = await delegateTaskTool.execute({
        taskId: "task-1",
        task: "Build feature",
        agentRole: "coder",
        maxTurns: 10,
      });

      expect(result.status).toBe("unavailable");
      expect(result.success).toBe(false);
      expect(result.taskId).toBe("task-1");
      expect(result.message).toContain("Agent provider not initialized");
    });

    it("should return error for unknown agent role", async () => {
      mockedGetAgentProvider.mockReturnValue({ id: "test" } as any);
      mockedGetAgentToolRegistry.mockReturnValue({} as any);

      const result = await delegateTaskTool.execute({
        taskId: "task-1",
        task: "Build feature",
        agentRole: "nonexistent_role" as any,
        maxTurns: 10,
      });

      expect(result.status).toBe("error");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown agent role");
    });

    it("should delegate task successfully to agent executor", async () => {
      const mockProvider = { id: "test" } as any;
      const mockToolRegistry = {} as any;
      mockedGetAgentProvider.mockReturnValue(mockProvider);
      mockedGetAgentToolRegistry.mockReturnValue(mockToolRegistry);

      const mockExecute = vi.fn().mockResolvedValue({
        output: "Feature built successfully",
        success: true,
        turns: 4,
        toolsUsed: ["write_file", "bash_exec"],
        tokensUsed: 2000,
        duration: 8000,
      });

      vi.mocked(AgentExecutor).mockImplementation(
        () =>
          ({
            execute: mockExecute,
          }) as any,
      );

      const result = await delegateTaskTool.execute({
        taskId: "task-42",
        task: "Build auth feature",
        agentRole: "coder",
        context: "Use JWT tokens",
        maxTurns: 15,
      });

      expect(result.status).toBe("completed");
      expect(result.success).toBe(true);
      expect(result.taskId).toBe("task-42");
      expect(result.role).toBe("coder");
      expect(result.output).toBe("Feature built successfully");
      expect(result.turns).toBe(4);
      expect(result.toolsUsed).toEqual(["write_file", "bash_exec"]);
    });

    it("should report failure when agent execution fails", async () => {
      mockedGetAgentProvider.mockReturnValue({ id: "test" } as any);
      mockedGetAgentToolRegistry.mockReturnValue({} as any);

      vi.mocked(AgentExecutor).mockImplementation(
        () =>
          ({
            execute: vi.fn().mockResolvedValue({
              output: "Max turns exceeded",
              success: false,
              turns: 10,
              toolsUsed: [],
              duration: 5000,
            }),
          }) as any,
      );

      const result = await delegateTaskTool.execute({
        taskId: "task-99",
        task: "Impossible task",
        agentRole: "coder",
        maxTurns: 10,
      });

      expect(result.status).toBe("failed");
      expect(result.success).toBe(false);
    });
  });

  // ─── aggregateResultsTool ──────────────────────────────────────────

  describe("aggregateResultsTool", () => {
    it("should have correct metadata", () => {
      expect(aggregateResultsTool.name).toBe("aggregateResults");
      expect(aggregateResultsTool.category).toBe("build");
    });

    it("should merge results with 'merge' strategy", async () => {
      const result = await aggregateResultsTool.execute({
        results: [
          { agentId: "a1", taskId: "t1", status: "completed", output: "Output A" },
          { agentId: "a2", taskId: "t2", status: "completed", output: "Output B" },
        ],
        aggregationStrategy: "merge",
      });

      expect(result.totalResults).toBe(2);
      expect(result.completedCount).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.strategy).toBe("merge");
      expect(result.aggregatedOutput).toBe("Output A\n\n---\n\nOutput B");
    });

    it("should pick most-common output with 'vote' strategy", async () => {
      const result = await aggregateResultsTool.execute({
        results: [
          { agentId: "a1", taskId: "t1", status: "completed", output: "Answer X" },
          { agentId: "a2", taskId: "t2", status: "completed", output: "Answer Y" },
          { agentId: "a3", taskId: "t3", status: "completed", output: "Answer X" },
        ],
        aggregationStrategy: "vote",
      });

      expect(result.aggregatedOutput).toBe("Answer X");
    });

    it("should return empty string for vote with no completed results", async () => {
      const result = await aggregateResultsTool.execute({
        results: [{ agentId: "a1", taskId: "t1", status: "failed", output: "Error" }],
        aggregationStrategy: "vote",
      });

      expect(result.aggregatedOutput).toBe("");
      expect(result.completedCount).toBe(0);
    });

    it("should pick first completed result with 'best' strategy based on success rate", async () => {
      const result = await aggregateResultsTool.execute({
        results: [
          { agentId: "a1", taskId: "t1", status: "completed", output: "First completed" },
          {
            agentId: "a2",
            taskId: "t2",
            status: "completed",
            output: "This is a much longer and more detailed output",
          },
          { agentId: "a3", taskId: "t3", status: "failed", output: "Error" },
        ],
        aggregationStrategy: "best",
      });

      // Should pick first completed result, prefixed with success rate
      expect(result.aggregatedOutput).toContain("[Success rate: 67%]");
      expect(result.aggregatedOutput).toContain("First completed");
    });

    it("should return empty string for best with no completed results", async () => {
      const result = await aggregateResultsTool.execute({
        results: [{ agentId: "a1", taskId: "t1", status: "failed", output: "Error" }],
        aggregationStrategy: "best",
      });

      expect(result.aggregatedOutput).toBe("");
    });

    it("should create summary with 'summary' strategy", async () => {
      const result = await aggregateResultsTool.execute({
        results: [
          { agentId: "agent-1", taskId: "t1", status: "completed", output: "Done" },
          { agentId: "agent-2", taskId: "t2", status: "failed", output: "Error" },
          { agentId: "agent-3", taskId: "t3", status: "completed", output: "Also done" },
        ],
        aggregationStrategy: "summary",
      });

      expect(result.aggregatedOutput).toContain("Completed: 2");
      expect(result.aggregatedOutput).toContain("Failed: 1");
      expect(result.aggregatedOutput).toContain("agent-1: Success");
      expect(result.aggregatedOutput).toContain("agent-3: Success");
    });

    it("should correctly count individual results", async () => {
      const result = await aggregateResultsTool.execute({
        results: [
          { agentId: "a1", taskId: "t1", status: "completed", output: "OK" },
          { agentId: "a2", taskId: "t2", status: "failed", output: "Error" },
        ],
        aggregationStrategy: "merge",
      });

      expect(result.individualResults).toHaveLength(2);
      expect(result.individualResults[0]).toEqual({
        agentId: "a1",
        taskId: "t1",
        status: "completed",
      });
      expect(result.individualResults[1]).toEqual({
        agentId: "a2",
        taskId: "t2",
        status: "failed",
      });
    });

    it("should exclude failed results from merge output", async () => {
      const result = await aggregateResultsTool.execute({
        results: [
          { agentId: "a1", taskId: "t1", status: "completed", output: "Good output" },
          { agentId: "a2", taskId: "t2", status: "failed", output: "Error output" },
        ],
        aggregationStrategy: "merge",
      });

      expect(result.aggregatedOutput).toBe("Good output");
      expect(result.aggregatedOutput).not.toContain("Error output");
    });
  });

  // ─── agentCoordinatorTools export ──────────────────────────────────

  describe("agentCoordinatorTools export", () => {
    it("should export all three tools", () => {
      expect(agentCoordinatorTools).toHaveLength(3);
      const names = agentCoordinatorTools.map((t) => t.name);
      expect(names).toContain("createAgentPlan");
      expect(names).toContain("delegateTask");
      expect(names).toContain("aggregateResults");
    });
  });
});
