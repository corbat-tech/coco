/**
 * Tests for AgentCoordinator
 */

import { describe, it, expect, vi } from "vitest";
import type { AgentDefinition, AgentTask, AgentResult, AgentExecutor } from "./executor.js";
import { AgentCoordinator } from "./coordinator.js";

describe("AgentCoordinator", () => {
  it("blocks failed dependency chains and diamonds while completing independent branches", async () => {
    const execute = vi.fn(
      async (_agent: AgentDefinition, task: AgentTask): Promise<AgentResult> => ({
        output: `${task.id}-out`,
        success: task.id !== "failed",
        turns: 1,
        toolsUsed: [],
        duration: 1,
      }),
    );
    const coordinator = new AgentCoordinator({ execute } as unknown as AgentExecutor, new Map());
    const result = await coordinator.coordinateAgents(
      [
        { id: "failed", description: "implement" },
        { id: "left", description: "implement", dependencies: ["failed"] },
        { id: "right", description: "implement", dependencies: ["failed"] },
        { id: "join", description: "implement", dependencies: ["left", "right"] },
        { id: "independent", description: "implement" },
        { id: "independent-child", description: "implement", dependencies: ["independent"] },
      ],
      { maxParallelAgents: 2 },
    );

    expect(execute.mock.calls.map(([, task]) => task.id)).toEqual([
      "failed",
      "independent",
      "independent-child",
    ]);
    expect(result.results.size).toBe(6);
    expect(result.results.get("failed")).toMatchObject({ success: false, turns: 1 });
    expect(result.results.get("independent-child")).toMatchObject({ success: true, turns: 1 });
    for (const id of ["left", "right", "join"]) {
      expect(result.results.get(id)).toMatchObject({
        success: false,
        turns: 0,
        toolsUsed: [],
        tokensUsed: 0,
        structuredResult: { status: "failed", error: expect.stringContaining("blocked") },
      });
    }
    expect(result.results.get("join")?.structuredResult?.metadata?.blockedBy).toEqual([
      "left",
      "right",
    ]);
    expect(result.results.get("left")?.output).toContain("failed");
    expect(result.parallelismAchieved).toBe(1);
  });

  it("should preserve task descriptions and dependency context across levels", async () => {
    const calls: Array<{ agent: AgentDefinition; task: AgentTask }> = [];

    const mockExecutor = {
      execute: vi.fn(async (agent: AgentDefinition, task: AgentTask): Promise<AgentResult> => {
        calls.push({ agent, task });
        return {
          output: `${task.id}-out`,
          success: true,
          turns: 1,
          toolsUsed: [],
          duration: 1,
        };
      }),
    };

    const agentDefinitions = new Map<string, AgentDefinition>([
      [
        "researcher",
        {
          role: "researcher",
          systemPrompt: "Research",
          allowedTools: [],
          maxTurns: 5,
        },
      ],
      [
        "coder",
        {
          role: "coder",
          systemPrompt: "Code",
          allowedTools: [],
          maxTurns: 5,
        },
      ],
    ]);

    const coordinator = new AgentCoordinator(mockExecutor as any, agentDefinitions);

    const tasks: AgentTask[] = [
      {
        id: "task-b",
        description: "Research API behavior",
      },
      {
        id: "task-a",
        description: "Implement feature using results",
        dependencies: ["task-b"],
      },
    ];

    await coordinator.coordinateAgents(tasks, { maxParallelAgents: 2 });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.task.description).toBe("Research API behavior");
    expect(calls[0]?.agent.role).toBe("researcher");
    expect(calls[1]?.task.description).toBe("Implement feature using results");
    expect(calls[1]?.agent.role).toBe("coder");

    const secondContext = calls[1]?.task.context as Record<string, unknown>;
    expect(secondContext?.["dependency_task-b"]).toEqual({
      output: "task-b-out",
      success: true,
    });
  });
});
