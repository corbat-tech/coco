import { describe, expect, it, vi } from "vitest";
import {
  normalizeAgentRunResult,
  type AgentGraphNodeExecution,
  type AgentRunResult,
} from "./multi-agent.js";
import {
  createSpecialistCoordinator,
  type SpecialistAssignment,
} from "./specialist-coordinator.js";

const assignment = (id: string): SpecialistAssignment => ({
  id,
  profile: "explore",
  objective: `Investigate ${id}`,
  acceptance: ["Return a file reference supporting the finding"],
  resources: { reads: [`src/${id}.ts`], writes: [] },
});
const result = (execution: AgentGraphNodeExecution, success = true): AgentRunResult =>
  normalizeAgentRunResult({
    id: execution.task.id,
    taskId: execution.task.id,
    role: execution.task.role,
    success,
    output: execution.task.objective,
    error: success ? undefined : "Observed failure",
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("bounded specialist coordination", () => {
  it("rejects invalid host configuration and oversized worker batches", async () => {
    const execute = async (execution: AgentGraphNodeExecution) => result(execution);
    for (const maxConcurrentWorkers of [0, NaN, Infinity, 1.2, 65])
      expect(() =>
        createSpecialistCoordinator({ nodeExecutor: execute, maxConcurrentWorkers }),
      ).toThrow("integers");
    expect(() => createSpecialistCoordinator({ nodeExecutor: undefined! })).toThrow("nodeExecutor");
    const coordinator = createSpecialistCoordinator({
      nodeExecutor: execute,
      maxWorkersPerTask: 1,
      budgetAvailable: () => true,
    });
    await expect(
      coordinator.run({
        workflowRunId: "many",
        message: "Usa agentes en paralelo",
        assignments: [assignment("a"), assignment("b")],
      }),
    ).rejects.toThrow();
    await expect(
      coordinator.run({
        workflowRunId: "../bad",
        message: "Usa un especialista",
        assignments: [assignment("a")],
      }),
    ).rejects.toThrow("workflowRunId");
    await expect(
      createSpecialistCoordinator({ nodeExecutor: execute, budgetAvailable: () => true }).run({
        workflowRunId: "ambiguous",
        message: "Usa un especialista",
        assignments: [assignment("a"), assignment("b")],
      }),
    ).rejects.toThrow("one assignment");
  });

  it("requires write resources and serializes mutation-capable assignments", async () => {
    let active = 0;
    const execute = vi.fn(async (execution: AgentGraphNodeExecution) => {
      active++;
      expect(active).toBe(1);
      await Promise.resolve();
      active--;
      return result(execution);
    });
    const coordinator = createSpecialistCoordinator({
      nodeExecutor: execute,
      budgetAvailable: () => true,
    });
    await expect(
      coordinator.run({
        workflowRunId: "unscoped",
        message: "Usa un especialista",
        assignments: [{ ...assignment("a"), profile: "debug" }],
      }),
    ).rejects.toThrow("explicit write resources");
    const outcome = await coordinator.run({
      workflowRunId: "mutators",
      message: "Usa agentes en paralelo",
      assignments: [
        {
          ...assignment("a"),
          profile: "debug",
          maxTurns: 100,
          resources: { writes: ["src/a.ts"] },
        },
        { ...assignment("b"), profile: "docs", resources: { writes: ["README.md"] } },
      ],
    });
    expect(outcome.graphResult?.status).toBe("completed");
    expect(execute.mock.calls[0]?.[0].task.context?.maxTurns).toBe(12);
    expect(execute.mock.calls.map(([execution]) => execution.node.risk)).toEqual([
      "write",
      "write",
    ]);
  });

  it("declines automatic concurrent tasks with overlapping parent/child resources", async () => {
    const execute = vi.fn(async (execution: AgentGraphNodeExecution) => result(execution));
    const coordinator = createSpecialistCoordinator({
      nodeExecutor: execute,
      budgetAvailable: () => true,
    });
    const outcome = await coordinator.run({
      workflowRunId: "overlap",
      message: "Update modules",
      mode: "auto",
      assignments: [
        { ...assignment("a"), profile: "debug", resources: { writes: ["src"] } },
        { ...assignment("b"), resources: { reads: ["src/b.ts"] } },
      ],
    });
    expect(outcome.decision.strategy).toBe("direct");
    expect(execute).not.toHaveBeenCalled();
  });

  it("cancels queued work without dispatch and rejects task-identity substitution", async () => {
    const first = deferred<void>();
    const started = deferred<void>();
    const execute = vi.fn(async (execution: AgentGraphNodeExecution) => {
      started.resolve();
      await first.promise;
      return result(execution);
    });
    const coordinator = createSpecialistCoordinator({
      nodeExecutor: execute,
      budgetAvailable: () => true,
    });
    const a = coordinator.run({
      workflowRunId: "active",
      message: "Usa un especialista",
      assignments: [assignment("a")],
    });
    await started.promise;
    const controller = new AbortController();
    const b = coordinator.run({
      workflowRunId: "queued",
      message: "Usa un especialista",
      assignments: [assignment("b")],
      signal: controller.signal,
    });
    controller.abort(new Error("Canceled while queued"));
    first.resolve();
    await a;
    await expect(b).rejects.toThrow("Canceled while queued");
    expect(execute).toHaveBeenCalledOnce();
    const mismatch = createSpecialistCoordinator({
      budgetAvailable: () => true,
      nodeExecutor: async (execution) => ({ ...result(execution), taskId: "another-task" }),
    });
    expect(
      (
        await mismatch.run({
          workflowRunId: "mismatch",
          message: "Usa un especialista",
          assignments: [assignment("a")],
        })
      ).graphResult?.status,
    ).toBe("failed");
  });

  it("keeps simple/manual/off work direct and dispatches no workers", async () => {
    const execute = vi.fn(async (execution: AgentGraphNodeExecution) => result(execution));
    const coordinator = createSpecialistCoordinator({
      nodeExecutor: execute,
      budgetAvailable: () => true,
    });
    const simple = await coordinator.run({
      workflowRunId: "simple",
      message: "Explain a.ts",
      assignments: [assignment("a")],
    });
    const off = await coordinator.run({
      workflowRunId: "off",
      message: "Usa agentes en paralelo",
      mode: "off",
      assignments: [assignment("a"), assignment("b")],
    });
    expect(simple.decision.strategy).toBe("direct");
    expect(off.decision.strategy).toBe("direct");
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not delegate without host-established shared budget or host authority", async () => {
    const execute = vi.fn(async (execution: AgentGraphNodeExecution) => result(execution));
    const input = {
      workflowRunId: "budget",
      message: "Usa un especialista",
      assignments: [assignment("a")],
    };
    expect(
      (await createSpecialistCoordinator({ nodeExecutor: execute }).run(input)).decision.strategy,
    ).toBe("direct");
    expect(
      (
        await createSpecialistCoordinator({
          nodeExecutor: execute,
          budgetAvailable: () => true,
          hostEnabled: false,
        }).run(input)
      ).decision.strategy,
    ).toBe("direct");
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes an explicit specialist with bounded task context and unverified acceptance", async () => {
    const execute = vi.fn(async (execution: AgentGraphNodeExecution) => result(execution));
    const coordinator = createSpecialistCoordinator({
      nodeExecutor: execute,
      budgetAvailable: () => true,
    });
    const outcome = await coordinator.run({
      workflowRunId: "one",
      message: "Usa un especialista",
      assignments: [assignment("a")],
    });
    expect(outcome.graphResult?.status).toBe("completed");
    expect(outcome.acceptance).toBe("unverified");
    expect(execute.mock.calls[0]?.[0].task.context).toMatchObject({
      acceptance: assignment("a").acceptance,
      resources: assignment("a").resources,
      profile: { id: "explore", version: 1 },
      maxTurns: 10,
    });
    await expect(
      coordinator.run({
        workflowRunId: "one",
        message: "Usa un especialista",
        assignments: [assignment("a")],
      }),
    ).rejects.toThrow("already submitted");
  });

  it("parallelizes independent investigations with an actual observed overlap", async () => {
    let active = 0;
    let maximum = 0;
    const barrier = deferred<void>();
    const coordinator = createSpecialistCoordinator({
      budgetAvailable: () => true,
      nodeExecutor: async (execution) => {
        active++;
        maximum = Math.max(maximum, active);
        if (active === 2) barrier.resolve();
        await barrier.promise;
        active--;
        return result(execution);
      },
    });
    const outcome = await coordinator.run({
      workflowRunId: "parallel",
      message: "Investiga dos hipótesis",
      mode: "auto",
      assignments: [assignment("a"), assignment("b")],
    });
    expect(outcome.decision.strategy).toBe("parallel");
    expect(outcome.graphResult?.status).toBe("completed");
    expect(maximum).toBe(2);
  });

  it("passes only direct dependency results and blocks failed descendants", async () => {
    const execute = vi.fn(async (execution: AgentGraphNodeExecution) =>
      result(execution, execution.task.id !== "a"),
    );
    const coordinator = createSpecialistCoordinator({
      nodeExecutor: execute,
      budgetAvailable: () => true,
    });
    const outcome = await coordinator.run({
      workflowRunId: "dependencies",
      message: "Usa agentes primero para investigar y después revisar",
      assignments: [
        assignment("a"),
        { ...assignment("b"), dependsOn: ["a"] },
        assignment("c"),
        { ...assignment("d"), dependsOn: ["c"] },
      ],
    });
    expect(outcome.decision.strategy).toBe("sequential");
    expect(outcome.graphResult?.status).toBe("failed");
    expect(execute.mock.calls.map(([execution]) => execution.task.id)).toEqual(["a", "c", "d"]);
    const dependent = execute.mock.calls.find(([execution]) => execution.task.id === "d")?.[0];
    expect(Object.keys(dependent!.task.context!.dependencyResults as object)).toEqual(["c"]);
    expect(outcome.graphResult?.nodeResults.b?.metadata?.blocked).toBe(true);
  });

  it("rejects malformed decompositions before dispatch", async () => {
    const execute = vi.fn(async (execution: AgentGraphNodeExecution) => result(execution));
    const coordinator = createSpecialistCoordinator({
      nodeExecutor: execute,
      budgetAvailable: () => true,
    });
    const run = (assignments: SpecialistAssignment[]) =>
      coordinator.run({
        workflowRunId: "invalid",
        message: "Usa agentes en paralelo",
        assignments,
      });
    await expect(run([{ ...assignment("a"), acceptance: [] }])).rejects.toThrow();
    await expect(
      run([{ ...assignment("a"), resources: { reads: ["../secrets"], writes: [] } }]),
    ).rejects.toThrow("project-relative");
    await expect(run([assignment("a"), assignment("a")])).rejects.toThrow("Duplicate");
    await expect(
      run([
        { ...assignment("a"), dependsOn: ["b"] },
        { ...assignment("b"), dependsOn: ["a"] },
      ]),
    ).rejects.toThrow("cycle");
    await expect(
      run([{ ...assignment("a"), resources: { writes: ["src/a.ts"] } }]),
    ).rejects.toThrow("Read-only");
    expect(execute).not.toHaveBeenCalled();
  });

  it("serializes complete runs per coordinator instance and waits for settlement", async () => {
    const first = deferred<void>();
    const started = deferred<void>();
    const calls: string[] = [];
    const coordinator = createSpecialistCoordinator({
      budgetAvailable: () => true,
      nodeExecutor: async (execution) => {
        calls.push(execution.workflowRunId);
        if (execution.workflowRunId === "first") {
          started.resolve();
          await first.promise;
        }
        return result(execution);
      },
    });
    const a = coordinator.run({
      workflowRunId: "first",
      message: "Usa un especialista",
      assignments: [assignment("a")],
    });
    await started.promise;
    const b = coordinator.run({
      workflowRunId: "second",
      message: "Usa un especialista",
      assignments: [assignment("b")],
    });
    await Promise.resolve();
    expect(calls).toEqual(["first"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(calls).toEqual(["first", "second"]);
  });

  it("rechecks budget before queued workers and does not simulate successful execution", async () => {
    let available = true;
    const execute = vi.fn(async (execution: AgentGraphNodeExecution) => {
      available = false;
      return result(execution);
    });
    const coordinator = createSpecialistCoordinator({
      nodeExecutor: execute,
      budgetAvailable: () => available,
      maxConcurrentWorkers: 1,
    });
    const outcome = await coordinator.run({
      workflowRunId: "exhausted",
      message: "Usa agentes en paralelo",
      assignments: [assignment("a"), assignment("b")],
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(outcome.graphResult?.status).toBe("failed");
    expect(outcome.graphResult?.nodeResults.b?.error).toContain("budget");
    const simulation = createSpecialistCoordinator({
      budgetAvailable: () => true,
      nodeExecutor: async (execution) => ({ ...result(execution), metadata: { simulated: true } }),
    });
    expect(
      (
        await simulation.run({
          workflowRunId: "simulated",
          message: "Usa un especialista",
          assignments: [assignment("a")],
        })
      ).graphResult?.status,
    ).toBe("failed");
  });
});
