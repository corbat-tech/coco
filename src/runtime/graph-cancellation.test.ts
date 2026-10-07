import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentGraphEngine,
  createAgentArtifact,
  normalizeAgentRunResult,
  type AgentGraphDefinition,
  type AgentGraphNodeExecution,
  type AgentRunResult,
} from "./multi-agent.js";
import { createEventLog } from "./event-log.js";
import { AgentRunner } from "./agent-runner.js";
const graph: AgentGraphDefinition = {
  nodes: [{ id: "work", agentRole: "researcher", description: "Fixture work", risk: "read-only" }],
};
function result(execution: AgentGraphNodeExecution, success = true) {
  return normalizeAgentRunResult({
    id: `${execution.node.id}-result`,
    taskId: execution.task.id,
    role: execution.task.role,
    success,
    output: success ? "fixture complete" : "fixture failed",
    error: success ? undefined : "fixture node failure",
    durationMs: 1,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Agent graph cancellation and settlement", () => {
  it("pre-abort returns a failed graph without dispatching a node", async () => {
    const controller = new AbortController();
    controller.abort(new Error("fixture preabort"));
    const nodeExecutor = vi.fn(async (execution: AgentGraphNodeExecution) => result(execution));
    const engine = new AgentGraphEngine({ nodeExecutor });
    const outcome = await engine.run({
      workflowRunId: "fixture",
      graph,
      input: {},
      signal: controller.signal,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("fixture preabort");
    expect(nodeExecutor).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("propagates host abort to node execution and waits for its late result", async () => {
    const controller = new AbortController();
    const pending = deferred<AgentRunResult>();
    let execution!: AgentGraphNodeExecution;
    const engine = new AgentGraphEngine({
      nodeExecutor: async (value) => {
        execution = value;
        return pending.promise;
      },
    });
    let settled = false;
    const outcome = engine
      .run({ workflowRunId: "fixture", graph, input: {}, signal: controller.signal })
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(0);
    const reason = new Error("fixture host cancellation");
    controller.abort(reason);
    expect(execution.signal?.aborted).toBe(true);
    expect(execution.signal?.reason).toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    pending.resolve(result(execution));
    const completed = await outcome;
    expect(completed.status).toBe("failed");
    expect(completed.nodeResults.work?.success).toBe(false);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("node timeout aborts execution, awaits settlement and never retries late success", async () => {
    const pending = deferred<AgentRunResult>();
    let execution!: AgentGraphNodeExecution;
    const nodeExecutor = vi.fn(async (value: AgentGraphNodeExecution) => {
      execution = value;
      return pending.promise;
    });
    const engine = new AgentGraphEngine({ nodeExecutor });
    let settled = false;
    const outcome = engine
      .run({
        workflowRunId: "fixture",
        input: {},
        graph: {
          nodes: [
            { ...graph.nodes[0]!, timeoutMs: 11, retryPolicy: { maxAttempts: 3, backoffMs: 5 } },
          ],
        },
      })
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(11);
    expect(execution.signal?.aborted).toBe(true);
    expect(settled).toBe(false);
    pending.resolve(result(execution));
    const completed = await outcome;
    expect(completed.status).toBe("failed");
    expect(completed.nodeResults.work?.status).toBe("timeout");
    expect(nodeExecutor).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("host cancellation during backoff prevents another attempt", async () => {
    const controller = new AbortController();
    const nodeExecutor = vi.fn(async (execution: AgentGraphNodeExecution) =>
      result(execution, false),
    );
    const engine = new AgentGraphEngine({ nodeExecutor });
    const outcome = engine.run({
      workflowRunId: "fixture",
      input: {},
      signal: controller.signal,
      graph: { nodes: [{ ...graph.nodes[0]!, retryPolicy: { maxAttempts: 3, backoffMs: 1000 } }] },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(nodeExecutor).toHaveBeenCalledOnce();
    controller.abort(new Error("fixture backoff canceled"));
    const completed = await outcome;
    expect(completed.status).toBe("failed");
    await vi.advanceTimersByTimeAsync(10000);
    expect(nodeExecutor).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("failed parallel A drains pending B and retains both partial results", async () => {
    const pending = deferred<AgentRunResult>();
    let executionB!: AgentGraphNodeExecution;
    const nodeExecutor = vi.fn(async (execution: AgentGraphNodeExecution) => {
      if (execution.node.id === "a") return result(execution, false);
      executionB = execution;
      return pending.promise;
    });
    const engine = new AgentGraphEngine({ nodeExecutor });
    let settled = false;
    const outcome = engine
      .run({
        workflowRunId: "fixture",
        input: {},
        graph: {
          parallelism: 2,
          nodes: [
            { ...graph.nodes[0]!, id: "a" },
            { ...graph.nodes[0]!, id: "b" },
          ],
        },
      })
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(nodeExecutor).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);
    pending.resolve(result(executionB));
    const completed = await outcome;
    expect(completed.status).toBe("failed");
    expect(Object.keys(completed.nodeResults).sort()).toEqual(["a", "b"]);
    expect(completed.nodeResults.a?.success).toBe(false);
    expect(completed.nodeResults.b?.output).toContain("fixture complete");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancellation during a gate suppresses late pass and artifact publication", async () => {
    const controller = new AbortController();
    const gate = deferred<{ passed: boolean }>();
    const eventLog = createEventLog();
    const gateEvaluator = vi.fn(async () => gate.promise);
    const engine = new AgentGraphEngine({
      eventLog,
      gateEvaluator,
      nodeExecutor: async (execution) => ({
        ...result(execution),
        artifacts: [
          createAgentArtifact({
            id: "fixture-artifact",
            kind: "summary",
            content: "unpublished fixture",
          }),
        ],
      }),
    });
    let settled = false;
    const outcome = engine
      .run({
        workflowRunId: "fixture",
        input: {},
        signal: controller.signal,
        graph: {
          nodes: [{ ...graph.nodes[0]!, gates: ["fixture-gate"] }],
          gates: [
            {
              id: "fixture-gate",
              kind: "quality-score",
              required: true,
              description: "Fixture gate",
            },
          ],
        },
      })
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(gateEvaluator).toHaveBeenCalledOnce();
    controller.abort(new Error("fixture gate canceled"));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    gate.resolve({ passed: true });
    const completed = await outcome;
    expect(completed.status).toBe("failed");
    expect(completed.artifacts).toEqual([]);
    expect(completed.stateSnapshot.artifacts).toEqual([]);
    expect(eventLog.list().map((event) => event.type)).not.toContain("agent.artifact.created");
    expect(eventLog.list().map((event) => event.type)).not.toContain("workflow.gate.passed");
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});

describe("Graph cancellation retains independent failure diagnostics", () => {
  it.each(["direct executor", "AgentRunner"] as const)(
    "%s failure after host cancellation retains ENOSPC without retry",
    async (path) => {
      const controller = new AbortController();
      const failure = Object.assign(new Error("ENOSPC fixture persistence diagnostic"), {
        code: "ENOSPC",
      });
      const fail = vi.fn(async () => {
        controller.abort(new Error("fixture host cancellation"));
        throw failure;
      });
      const runner = new AgentRunner({ executor: fail });
      const nodeExecutor = vi.fn(async (execution: AgentGraphNodeExecution) => {
        if (path === "direct executor") return fail();
        return runner.run({
          task: execution.task,
          capability: { role: execution.task.role, allowedTools: [], risk: "read-only" },
          trace: execution.trace,
          signal: execution.signal,
        });
      });
      const engine = new AgentGraphEngine({ nodeExecutor });
      const outcome = await engine.run({
        workflowRunId: "fixture-diagnostic",
        input: {},
        signal: controller.signal,
        graph: { nodes: [{ ...graph.nodes[0]!, retryPolicy: { maxAttempts: 3, backoffMs: 11 } }] },
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.nodeResults.work?.status).toBe("cancelled");
      expect(outcome.nodeResults.work?.error).toContain("ENOSPC fixture persistence diagnostic");
      expect(nodeExecutor).toHaveBeenCalledOnce();
      expect(fail).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    },
  );
});
