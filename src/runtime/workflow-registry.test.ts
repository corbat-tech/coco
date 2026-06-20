import { describe, expect, it } from "vitest";
import { createEventLog } from "./event-log.js";
import { createWorkflowCatalog, workflowToAgentGraph } from "./workflow-registry.js";
import { createWorkflowEngine } from "./workflow-engine.js";

describe("workflow registry DAG support", () => {
  it("converts legacy linear steps into a DAG graph", () => {
    const catalog = createWorkflowCatalog([
      {
        id: "legacy",
        name: "Legacy",
        description: "Legacy steps",
        inputSchema: "task: string",
        outputKind: "markdown",
        replayable: true,
        checks: ["check"],
        steps: [
          {
            id: "a",
            description: "A",
            requiredTools: ["read_file"],
            risk: "read-only",
          },
          {
            id: "b",
            description: "B",
            requiredTools: ["write_file"],
            risk: "write",
          },
        ],
      },
    ]);

    const workflow = catalog.get("legacy");

    expect(workflow).toBeDefined();
    expect(workflowToAgentGraph(workflow!).nodes).toEqual([
      {
        id: "a",
        description: "A",
        requiredTools: ["read_file"],
        risk: "read-only",
        dependsOn: [],
      },
      {
        id: "b",
        description: "B",
        requiredTools: ["write_file"],
        risk: "write",
        dependsOn: ["a"],
      },
    ]);
  });

  it("accepts explicit workflow nodes, edges, gates, retry policy, and parallelism", () => {
    const catalog = createWorkflowCatalog([
      {
        id: "dag",
        name: "DAG",
        description: "DAG workflow",
        inputSchema: "task: string",
        outputKind: "patch",
        replayable: true,
        checks: ["tests"],
        steps: [],
        parallelism: 2,
        retryPolicy: { maxAttempts: 2, backoffMs: 100 },
        gates: [
          {
            id: "tests",
            kind: "tests",
            description: "Tests pass",
            required: true,
          },
        ],
        nodes: [
          {
            id: "plan",
            agentRole: "architect",
            description: "Plan",
            risk: "read-only",
          },
          {
            id: "edit",
            agentRole: "editor",
            description: "Edit",
            dependsOn: ["plan"],
            gates: ["tests"],
            retryPolicy: { maxAttempts: 2 },
            risk: "write",
          },
        ],
      },
    ]);

    const workflow = catalog.get("dag");

    expect(workflow?.parallelism).toBe(2);
    expect(workflow?.nodes?.[1]).toMatchObject({
      id: "edit",
      dependsOn: ["plan"],
      gates: ["tests"],
    });
  });

  it("rejects invalid workflow graphs when registering", () => {
    expect(() =>
      createWorkflowCatalog([
        {
          id: "invalid",
          name: "Invalid",
          description: "Invalid graph",
          inputSchema: "task: string",
          outputKind: "markdown",
          replayable: true,
          checks: [],
          steps: [],
          nodes: [
            {
              id: "a",
              description: "A",
              dependsOn: ["missing"],
              risk: "read-only",
            },
          ],
        },
      ]),
    ).toThrow("Invalid workflow graph");
  });

  it("records graph execution levels when planning workflows", () => {
    const eventLog = createEventLog();
    const catalog = createWorkflowCatalog();
    const plan = catalog.createPlan("architect-editor-verifier", { task: "x" }, eventLog);

    expect(plan.workflowId).toBe("architect-editor-verifier");
    expect(eventLog.list().find((event) => event.type === "workflow.planned")?.data).toMatchObject({
      workflowId: "architect-editor-verifier",
      planId: plan.id,
      graphLevels: [["architect"], ["editor"], ["verifier"]],
    });
  });

  it("executes workflows as DAGs when no legacy handler is registered", async () => {
    const eventLog = createEventLog();
    const engine = createWorkflowEngine(createWorkflowCatalog(), eventLog);

    const result = await engine.run({
      workflowId: "architect-editor-verifier",
      input: { task: "improve runtime" },
    });

    expect(result.status).toBe("completed");
    expect(result.graphResult?.status).toBe("completed");
    expect(Object.keys(result.graphResult?.nodeResults ?? {})).toEqual([
      "architect",
      "editor",
      "verifier",
    ]);
    expect(eventLog.list().map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "workflow.started",
        "agent.graph.started",
        "agent.completed",
        "agent.graph.completed",
        "workflow.completed",
      ]),
    );
  });
});
