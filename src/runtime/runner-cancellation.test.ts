import { describe, expect, it, vi } from "vitest";
import { AgentRunner } from "./agent-runner.js";
import { createEventLog } from "./event-log.js";
import { createWorkflowCatalog } from "./workflow-registry.js";
import { createWorkflowEngine } from "./workflow-engine.js";
import { normalizeAgentRunResult } from "./multi-agent.js";

const input = {
  task: { id: "fixture", role: "reviewer" as const, objective: "fixture" },
  capability: {
    role: "reviewer" as const,
    allowedTools: ["read_file"],
    risk: "read-only" as const,
  },
};
describe("Runner and workflow cancellation", () => {
  it("pre-abort skips the executor", async () => {
    const executor = vi.fn();
    const controller = new AbortController();
    controller.abort(new Error("fixture preabort"));
    const result = await new AgentRunner({ executor }).run({ ...input, signal: controller.signal });
    expect(result).toMatchObject({
      success: false,
      status: "cancelled",
      error: "fixture preabort",
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "timeout"] as const)(
    "late success becomes %s and retains known usage",
    async (status) => {
      const controller = new AbortController();
      const events = createEventLog();
      const runner = new AgentRunner({
        eventLog: events,
        executor: async (context) => {
          expect(context.signal).toBe(controller.signal);
          controller.abort(
            status === "timeout"
              ? new DOMException("fixture deadline", "TimeoutError")
              : new Error("fixture cancel"),
          );
          expect(() => context.assertToolAllowed("read_file")).toThrow();
          return { output: "late", inputTokens: 10, outputTokens: 2 };
        },
      });
      const result = await runner.run({ ...input, signal: controller.signal });
      expect(result).toMatchObject({
        success: false,
        status,
        usage: { inputTokens: 10, outputTokens: 2 },
      });
      expect(events.list().map((event) => event.type)).not.toContain("agent.completed");
    },
  );

  it("workflow handler receives signal and cannot publish late success", async () => {
    const controller = new AbortController();
    const engine = createWorkflowEngine();
    engine.registerHandler("provider-diagnosis", async (_input, context) => {
      expect(context.signal).toBe(controller.signal);
      controller.abort(new Error("fixture stop"));
      return "late";
    });
    const result = await engine.run({
      workflowId: "provider-diagnosis",
      input: {},
      signal: controller.signal,
    });
    expect(result).toMatchObject({ status: "failed", error: "fixture stop" });
    expect(result.output).not.toBe("late");
  });

  it("workflow retains results from every settled node in a failed parallel batch", async () => {
    const catalog = createWorkflowCatalog([
      {
        id: "fixture",
        name: "Fixture",
        description: "Fixture",
        inputSchema: "",
        outputKind: "markdown",
        replayable: false,
        checks: [],
        steps: [],
        nodes: [
          { id: "a", description: "A", agentRole: "reviewer" },
          { id: "b", description: "B", agentRole: "reviewer" },
        ],
        parallelism: 2,
      },
    ]);
    const controller = new AbortController();
    const engine = createWorkflowEngine(catalog, createEventLog(), {
      nodeExecutor: async ({ node, task, signal }) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        return normalizeAgentRunResult({
          id: node.id,
          taskId: task.id,
          role: task.role,
          success: node.id === "b",
          output: node.id,
          error: node.id === "a" ? "fixture failure" : undefined,
        });
      },
    });
    const result = await engine.run({
      workflowId: "fixture",
      input: {},
      signal: controller.signal,
    });
    expect(result.status).toBe("failed");
    expect(Object.keys(result.graphResult?.nodeResults ?? {}).sort()).toEqual(["a", "b"]);
    expect(result.output).toBe(result.graphResult);
  });
});
