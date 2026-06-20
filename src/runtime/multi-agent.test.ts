import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAgentGraphEngine,
  createAgentArtifact,
  dryRunAgentGraphNodeExecutor,
  evaluateAgentToolPolicy,
  FileSharedWorkspaceStore,
  InMemorySharedWorkspaceStore,
  listLegacyAgentRoleMappings,
  mapLegacyAgentRole,
  normalizeAgentRunResult,
  SharedWorkspaceState,
  validateAgentCapabilities,
  validateAgentGraph,
} from "./multi-agent.js";
import { createEventLog } from "./event-log.js";

describe("multi-agent runtime contracts", () => {
  it("validates DAG execution levels for fan-out and fan-in workflows", () => {
    const result = validateAgentGraph({
      parallelism: 3,
      gates: [
        {
          id: "review",
          kind: "review",
          description: "Review gate",
          required: true,
        },
      ],
      nodes: [
        {
          id: "plan",
          agentRole: "architect",
          description: "Plan work",
          risk: "read-only",
        },
        {
          id: "implement",
          agentRole: "editor",
          description: "Implement work",
          dependsOn: ["plan"],
          risk: "write",
        },
        {
          id: "test",
          agentRole: "tester",
          description: "Run tests",
          dependsOn: ["plan"],
          risk: "destructive",
        },
        {
          id: "verify",
          agentRole: "reviewer",
          description: "Verify result",
          dependsOn: ["implement", "test"],
          gates: ["review"],
          risk: "read-only",
        },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.levels).toEqual([["plan"], ["implement", "test"], ["verify"]]);
  });

  it("reports cycles, missing dependencies, missing gates, and invalid policies", () => {
    const result = validateAgentGraph({
      parallelism: 0,
      gates: [],
      nodes: [
        {
          id: "a",
          description: "A",
          dependsOn: ["b", "missing"],
          gates: ["quality"],
          retryPolicy: { maxAttempts: 0 },
          risk: "read-only",
        },
        {
          id: "b",
          description: "B",
          dependsOn: ["a"],
          risk: "read-only",
        },
      ],
      edges: [{ from: "ghost", to: "a" }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "invalid-parallelism",
        "invalid-retry-policy",
        "missing-dependency",
        "missing-gate",
        "missing-edge-node",
        "cycle",
      ]),
    );
  });

  it("normalizes legacy agent output into structured artifacts", () => {
    const result = normalizeAgentRunResult({
      id: "run-1",
      taskId: "task-1",
      role: "coder",
      success: true,
      output: "Implemented feature",
      toolsUsed: ["read_file"],
      turns: 2,
      durationMs: 50,
    });

    expect(result.status).toBe("completed");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      kind: "summary",
      content: "Implemented feature",
      agentRunId: "run-1",
      taskId: "task-1",
    });
  });

  it("filters risk reports from non-sensitive shared state reads", () => {
    const state = new SharedWorkspaceState();
    state.writeFact("repo", "coco");
    state.recordRisk("secret-risk", { token: "redacted" });
    state.addArtifact(createAgentArtifact({ kind: "riskReport", content: "security concern" }));
    state.addArtifact(createAgentArtifact({ kind: "summary", content: "done" }));

    expect(state.readForRole("coder").risks).toEqual({});
    expect(state.readForRole("coder").artifacts.map((artifact) => artifact.kind)).toEqual([
      "summary",
    ]);
    expect(state.readForRole("security").risks).toEqual({
      "secret-risk": { token: "redacted" },
    });
    expect(state.readForRole("security").artifacts.map((artifact) => artifact.kind)).toEqual([
      "riskReport",
      "summary",
    ]);
  });

  it("validates agent tool capabilities", () => {
    const issues = validateAgentCapabilities(
      {
        role: "reviewer",
        allowedTools: ["read_file"],
        risk: "read-only",
      },
      ["read_file", "write_file"],
    );

    expect(issues).toEqual([
      {
        code: "missing-dependency",
        message: "Tool 'write_file' is not allowed for agent role 'reviewer'.",
      },
    ]);
  });

  it("maps legacy agent surfaces to canonical runtime roles", () => {
    expect(mapLegacyAgentRole("explore")).toBe("researcher");
    expect(mapLegacyAgentRole("debug")).toBe("coder");
    expect(mapLegacyAgentRole("e2e")).toBe("tester");
    expect(mapLegacyAgentRole("database")).toBe("database");
    expect(listLegacyAgentRoleMappings().some((mapping) => mapping.legacy === "refactor")).toBe(
      true,
    );
  });

  it("enforces capability and risk policies for agent tools", () => {
    const decision = evaluateAgentToolPolicy({
      capability: {
        role: "reviewer",
        allowedTools: ["read_file", "write_file"],
        risk: "read-only",
      },
      toolName: "write_file",
      manifest: {
        write_file: {
          toolName: "write_file",
          risk: "write",
          level: "high",
          filesystem: true,
        },
      },
    });

    expect(decision).toMatchObject({
      allowed: false,
      risk: "write",
    });
  });

  it("requires provenance for shared workspace store writes and filters sensitive reads", () => {
    const store = new InMemorySharedWorkspaceStore();

    expect(() =>
      store.write({
        kind: "fact",
        key: "repo",
        value: "coco",
        provenance: { workflowRunId: "" },
      }),
    ).toThrow("workflowRunId");

    store.write({
      kind: "risk",
      key: "secret",
      value: { token: "redacted" },
      provenance: { workflowRunId: "wf-1", risk: "secrets-sensitive" },
    });
    store.write({
      kind: "artifact",
      key: "a1",
      value: createAgentArtifact({ id: "a1", kind: "summary", content: "safe" }),
      provenance: { workflowRunId: "wf-1", agentRunId: "agent-1" },
    });

    expect(store.readForRole("coder").risks).toEqual({});
    expect(store.readForRole("security").risks).toEqual({ secret: { token: "redacted" } });
    expect(store.snapshot().artifacts[0]?.id).toBe("a1");
  });

  it("executes an agent graph with fan-out/fan-in, gates, state, and trace events", async () => {
    const eventLog = createEventLog();
    const store = new InMemorySharedWorkspaceStore();
    const attempts = new Map<string, number>();
    const engine = createAgentGraphEngine({
      eventLog,
      sharedState: store,
      nodeExecutor: async ({ node, task, attempt, workflowRunId }) => {
        attempts.set(node.id, attempt);
        return normalizeAgentRunResult({
          id: `${node.id}-${attempt}`,
          taskId: task.id,
          role: task.role,
          success: node.id !== "test" || attempt > 1,
          output: `${node.id} output`,
          error: node.id === "test" && attempt === 1 ? "flaky" : undefined,
          turns: 1,
          toolsUsed: node.requiredTools ?? [],
          durationMs: 1,
          metadata: { workflowRunId },
        });
      },
    });

    const result = await engine.run({
      workflowRunId: "wf-graph",
      input: { task: "ship" },
      graph: {
        parallelism: 2,
        gates: [
          {
            id: "review",
            kind: "review",
            description: "review passed",
            required: true,
          },
        ],
        nodes: [
          { id: "plan", agentRole: "architect", description: "plan", risk: "read-only" },
          {
            id: "edit",
            agentRole: "editor",
            description: "edit",
            dependsOn: ["plan"],
            risk: "write",
          },
          {
            id: "test",
            agentRole: "tester",
            description: "test",
            dependsOn: ["plan"],
            retryPolicy: { maxAttempts: 2 },
            risk: "destructive",
          },
          {
            id: "verify",
            agentRole: "reviewer",
            description: "verify",
            dependsOn: ["edit", "test"],
            gates: ["review"],
            risk: "read-only",
          },
        ],
      },
    });

    expect(result.status).toBe("completed");
    expect(Object.keys(result.nodeResults)).toEqual(["plan", "edit", "test", "verify"]);
    expect(attempts.get("test")).toBe(2);
    expect(result.trace.workflowRunId).toBe("wf-graph");
    expect(result.stateSnapshot.artifacts.map((artifact) => artifact.taskId)).toEqual([
      "plan",
      "edit",
      "test",
      "test",
      "verify",
    ]);
    expect(eventLog.list().map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "agent.graph.started",
        "agent.started",
        "agent.failed",
        "agent.completed",
        "agent.artifact.created",
        "shared_state.updated",
        "checkpoint.created",
        "workflow.gate.passed",
        "agent.graph.completed",
      ]),
    );
  });

  it("fails graph execution without a real node executor unless dry-run is explicitly enabled", async () => {
    const engine = createAgentGraphEngine();

    const result = await engine.run({
      workflowRunId: "wf-missing-executor",
      input: {},
      graph: {
        nodes: [{ id: "plan", agentRole: "architect", description: "plan", risk: "read-only" }],
      },
    });

    expect(result).toMatchObject({
      status: "failed",
    });
    expect(result.error).toContain("requires a nodeExecutor");
  });

  it("supports explicit dry-run graph execution for demos and tests", async () => {
    const engine = createAgentGraphEngine({
      allowSimulated: true,
      nodeExecutor: dryRunAgentGraphNodeExecutor,
    });

    const result = await engine.run({
      workflowRunId: "wf-dry-run",
      input: {},
      graph: {
        nodes: [{ id: "plan", agentRole: "architect", description: "plan", risk: "read-only" }],
      },
    });

    expect(result.status).toBe("completed");
    expect(result.nodeResults["plan"]?.metadata).toMatchObject({ simulated: true });
  });

  it("fails required critical gates unless an explicit evaluator is configured", async () => {
    const engine = createAgentGraphEngine({
      nodeExecutor: async ({ node, task, workflowRunId }) =>
        normalizeAgentRunResult({
          id: `${workflowRunId}-${node.id}`,
          taskId: task.id,
          role: task.role,
          success: true,
          output: "ok",
          durationMs: 1,
        }),
    });

    const result = await engine.run({
      workflowRunId: "wf-critical-gate",
      input: {},
      graph: {
        gates: [
          {
            id: "security",
            kind: "security",
            description: "Security gate",
            required: true,
          },
        ],
        nodes: [
          {
            id: "verify",
            agentRole: "security",
            description: "verify security",
            risk: "read-only",
            gates: ["security"],
          },
        ],
      },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("requires an explicit evaluator");
  });

  it("skips nodes when declarative conditions evaluate to false", async () => {
    const executed: string[] = [];
    const engine = createAgentGraphEngine({
      nodeExecutor: async ({ node, task, workflowRunId }) => {
        executed.push(node.id);
        return normalizeAgentRunResult({
          id: `${workflowRunId}-${node.id}`,
          taskId: task.id,
          role: task.role,
          success: true,
          output: `${node.id} ok`,
          durationMs: 1,
        });
      },
    });

    const result = await engine.run({
      workflowRunId: "wf-condition",
      input: { shouldRun: false },
      graph: {
        nodes: [
          {
            id: "optional",
            agentRole: "coder",
            description: "optional work",
            risk: "read-only",
            condition: "input.shouldRun",
          },
        ],
      },
    });

    expect(result.status).toBe("completed");
    expect(executed).toEqual([]);
    expect(result.nodeResults["optional"]?.status).toBe("cancelled");
    expect(result.nodeResults["optional"]?.metadata).toMatchObject({ skipped: true });
  });

  it("fails nodes that exceed their timeout", async () => {
    const engine = createAgentGraphEngine({
      nodeExecutor: async ({ node, task, workflowRunId }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return normalizeAgentRunResult({
          id: `${workflowRunId}-${node.id}`,
          taskId: task.id,
          role: task.role,
          success: true,
          output: "late",
          durationMs: 20,
        });
      },
    });

    const result = await engine.run({
      workflowRunId: "wf-timeout",
      input: {},
      graph: {
        nodes: [
          {
            id: "slow",
            agentRole: "coder",
            description: "slow work",
            risk: "read-only",
            timeoutMs: 1,
          },
        ],
      },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("timed out");
  });

  it("preserves shared workspace record ids when replaying from file store", () => {
    const dir = mkdtempSync(join(tmpdir(), "coco-state-"));
    const file = join(dir, "state.json");

    try {
      const writer = new FileSharedWorkspaceStore(file);
      const written = writer.write({
        kind: "fact",
        key: "repo",
        value: "coco",
        provenance: { workflowRunId: "wf-file" },
      });

      const reader = new FileSharedWorkspaceStore(file);

      expect(reader.list()[0]?.id).toBe(written.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
