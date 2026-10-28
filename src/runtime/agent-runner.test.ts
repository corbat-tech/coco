import { describe, expect, it } from "vitest";
import { createAgentRunner } from "./agent-runner.js";
import { createEventLog } from "./event-log.js";

describe("AgentRunner", () => {
  it("fails closed when no real executor is configured", async () => {
    const result = await createAgentRunner().run({
      task: { id: "missing", role: "researcher", objective: "Investigate" },
      capability: { role: "researcher", allowedTools: [], risk: "read-only" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires an executor");
  });

  it("marks explicitly enabled simulations rather than implying real execution", async () => {
    const result = await createAgentRunner({ allowSimulated: true }).run({
      task: { id: "demo", role: "researcher", objective: "Investigate" },
      capability: { role: "researcher", allowedTools: [], risk: "read-only" },
    });
    expect(result.success).toBe(true);
    expect(result.metadata?.simulated).toBe(true);
    expect(result.turns).toBe(0);
  });

  it("runs agents through canonical capability policy and events", async () => {
    const eventLog = createEventLog();
    const runner = createAgentRunner({
      eventLog,
      executor: async (context) => {
        context.assertToolAllowed("read_file");
        return {
          output: "reviewed",
          toolsUsed: ["read_file"],
          turns: 1,
          inputTokens: 10,
          outputTokens: 2,
        };
      },
    });

    const result = await runner.run({
      task: {
        id: "task-1",
        role: "reviewer",
        objective: "Review code",
      },
      capability: {
        role: "reviewer",
        allowedTools: ["read_file"],
        risk: "read-only",
      },
    });

    expect(result).toMatchObject({
      taskId: "task-1",
      role: "reviewer",
      success: true,
      output: "reviewed",
      toolsUsed: ["read_file"],
    });
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "agent.started",
      "agent.tool.called",
      "agent.completed",
    ]);
  });

  it("returns structured failed results when a tool violates capability policy", async () => {
    const runner = createAgentRunner({
      executor: async (context) => {
        context.assertToolAllowed("write_file");
        return { output: "should not happen" };
      },
    });

    const result = await runner.run({
      task: {
        id: "task-2",
        role: "reviewer",
        objective: "Review only",
      },
      capability: {
        role: "reviewer",
        allowedTools: ["read_file"],
        risk: "read-only",
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not allowed");
  });
});
