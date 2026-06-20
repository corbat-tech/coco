import { describe, expect, it } from "vitest";
import { createEventLog } from "./event-log.js";
import { createWorkflowCatalog, workflowToAgentGraph } from "./workflow-registry.js";
import { createWorkflowEngine } from "./workflow-engine.js";
import { normalizeAgentRunResult } from "./multi-agent.js";

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

  it("includes graph-first product workflows for RAG and WhatsApp assistants", () => {
    const catalog = createWorkflowCatalog();
    const rag = catalog.get("enterprise-rag-answer");
    const whatsapp = catalog.get("whatsapp-support-assistant");

    expect(rag?.steps).toEqual([]);
    expect(workflowToAgentGraph(rag!).nodes.map((node) => node.id)).toEqual([
      "retrieve",
      "draft-answer",
      "policy-review",
    ]);
    expect(workflowToAgentGraph(whatsapp!).nodes.map((node) => node.id)).toEqual([
      "classify-message",
      "retrieve-context",
      "draft-response",
      "escalate-if-needed",
    ]);
    expect(whatsapp?.nodes?.find((node) => node.id === "escalate-if-needed")).toMatchObject({
      condition: "input.requiresEscalation",
      requiredTools: ["request_human_escalation"],
    });
  });

  it("fails DAG workflows without a real node executor", async () => {
    const eventLog = createEventLog();
    const engine = createWorkflowEngine(createWorkflowCatalog(), eventLog);

    const result = await engine.run({
      workflowId: "architect-editor-verifier",
      input: { task: "improve runtime" },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("requires a nodeExecutor");
    expect(eventLog.list().map((event) => event.type)).toEqual(
      expect.arrayContaining(["workflow.started", "agent.graph.started", "workflow.failed"]),
    );
  });

  it("executes workflows as DAGs when a runtime node executor is registered", async () => {
    const eventLog = createEventLog();
    const engine = createWorkflowEngine(createWorkflowCatalog(), eventLog, {
      nodeExecutor: async ({ node, task, workflowRunId }) =>
        normalizeAgentRunResult({
          id: `${workflowRunId}-${node.id}`,
          taskId: task.id,
          role: task.role,
          success: true,
          output: `${node.id} done`,
          durationMs: 1,
        }),
    });

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
