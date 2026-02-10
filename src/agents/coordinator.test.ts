/**
 * Tests for AgentCoordinator
 */

import { describe, it, expect, vi } from "vitest";
import type { AgentDefinition, AgentTask, AgentResult } from "./executor.js";
import { AgentCoordinator } from "./coordinator.js";

describe("AgentCoordinator", () => {
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
