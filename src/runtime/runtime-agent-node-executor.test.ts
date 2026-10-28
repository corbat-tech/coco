import { describe, expect, it, vi } from "vitest";
import { AgentRunner, type AgentRunnerExecutionContext } from "./agent-runner.js";
import { createEventLog } from "./event-log.js";
import {
  AgentGraphEngine,
  InMemorySharedWorkspaceStore,
  type AgentDefinition,
} from "./multi-agent.js";
import {
  createAgentDefinitionRegistry,
  createRuntimeAgentNodeExecutor,
} from "./runtime-agent-node-executor.js";
import { createWorkflowEngine } from "./workflow-engine.js";

const profile = (id: string): AgentDefinition => ({
  id,
  role: "researcher",
  name: id,
  instructions: `Instructions for ${id}`,
  capability: { role: "researcher", allowedTools: [], risk: "read-only" },
});

describe("runtime agent profile execution", () => {
  it("does not let a read-only node select a mutation-capable profile", async () => {
    const execute = vi.fn(async () => ({ output: "wrong" }));
    const definition = {
      ...profile("writer"),
      capability: { role: "researcher" as const, allowedTools: [], risk: "write" as const },
    };
    const engine = new AgentGraphEngine({
      nodeExecutor: createRuntimeAgentNodeExecutor({
        registry: createAgentDefinitionRegistry([definition]),
        runner: new AgentRunner({ executor: execute }),
      }),
    });
    const result = await engine.run({
      workflowRunId: "risk",
      input: {},
      graph: {
        nodes: [{ id: "work", agentRole: "researcher", description: "Read", risk: "read-only" }],
      },
    });
    expect(result.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails a registered workflow without a real worker executor", async () => {
    const definition: AgentDefinition = {
      ...profile("architect"),
      role: "architect",
      capability: {
        role: "architect",
        allowedTools: ["repo_context", "read_file", "git_diff"],
        risk: "read-only",
      },
    };
    const engine = createWorkflowEngine(undefined, undefined, {
      agentDefinitionRegistry: createAgentDefinitionRegistry([definition]),
    });
    const result = await engine.run({
      workflowId: "architect-editor-verifier",
      input: { task: "Implement" },
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("requires an executor");
  });

  it("rejects an invalid output schema before any worker action", async () => {
    const execute = vi.fn(async () => ({ output: "wrong" }));
    const definition = { ...profile("invalid"), outputSchema: { type: "invalid-type" } };
    const engine = new AgentGraphEngine({
      nodeExecutor: createRuntimeAgentNodeExecutor({
        registry: createAgentDefinitionRegistry([definition]),
        runner: new AgentRunner({ executor: execute }),
      }),
    });
    const result = await engine.run({
      workflowRunId: "invalid-schema",
      input: {},
      graph: {
        nodes: [
          { id: "work", agentRole: "researcher", description: "Research", risk: "read-only" },
        ],
      },
    });
    expect(result.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("selects an explicit definition ID rather than the last profile for the role", async () => {
    const execute = vi.fn(async (_context: AgentRunnerExecutionContext) => ({
      output: "observed",
      success: true,
    }));
    const engine = new AgentGraphEngine({
      nodeExecutor: createRuntimeAgentNodeExecutor({
        registry: createAgentDefinitionRegistry([profile("first"), profile("second")]),
        runner: new AgentRunner({ executor: execute }),
      }),
    });
    const result = await engine.run({
      workflowRunId: "select",
      input: {},
      graph: {
        nodes: [
          {
            id: "work",
            agentRole: "researcher",
            agentDefinitionId: "first",
            description: "Research",
            risk: "read-only",
          },
        ],
      },
    });
    expect(result.status).toBe("completed");
    expect(execute.mock.calls[0]?.[0].task.context?.instructions).toBe("Instructions for first");
    expect(result.nodeResults.work?.metadata?.agentDefinitionId).toBe("first");
  });

  it("rejects an unknown explicit definition without falling back to another profile", async () => {
    const execute = vi.fn(async () => ({ output: "wrong" }));
    const engine = new AgentGraphEngine({
      nodeExecutor: createRuntimeAgentNodeExecutor({
        registry: createAgentDefinitionRegistry([profile("known")]),
        runner: new AgentRunner({ executor: execute }),
      }),
    });
    const result = await engine.run({
      workflowRunId: "unknown",
      input: {},
      graph: {
        nodes: [
          {
            id: "work",
            agentRole: "researcher",
            agentDefinitionId: "missing",
            description: "Research",
            risk: "read-only",
          },
        ],
      },
    });
    expect(result.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects profile/role mismatch before running the worker", async () => {
    const execute = vi.fn(async () => ({ output: "wrong" }));
    const engine = new AgentGraphEngine({
      nodeExecutor: createRuntimeAgentNodeExecutor({
        registry: createAgentDefinitionRegistry([profile("research")]),
        runner: new AgentRunner({ executor: execute }),
      }),
    });
    const result = await engine.run({
      workflowRunId: "mismatch",
      input: {},
      graph: {
        nodes: [
          {
            id: "work",
            agentRole: "editor",
            agentDefinitionId: "research",
            description: "Edit",
            risk: "write",
          },
        ],
      },
    });
    expect(result.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not report a successful graph when the profile runner lacks an executor", async () => {
    const engine = new AgentGraphEngine({
      nodeExecutor: createRuntimeAgentNodeExecutor({
        registry: createAgentDefinitionRegistry([profile("research")]),
      }),
    });
    const result = await engine.run({
      workflowRunId: "missing",
      input: {},
      graph: {
        nodes: [
          { id: "work", agentRole: "researcher", description: "Research", risk: "read-only" },
        ],
      },
    });
    expect(result.status).toBe("failed");
    expect(result.nodeResults.work?.error).toContain("requires an executor");
  });

  it("delivers only current workflow dependencies and filters unrelated state", async () => {
    const store = new InMemorySharedWorkspaceStore();
    store.write({
      kind: "fact",
      key: "private",
      value: "other session",
      provenance: { workflowRunId: "other" },
    });
    const execute = vi.fn(async (context: AgentRunnerExecutionContext) => ({
      output: context.task.id,
      success: true,
    }));
    const engine = new AgentGraphEngine({
      sharedState: store,
      eventLog: createEventLog(),
      nodeExecutor: createRuntimeAgentNodeExecutor({
        registry: createAgentDefinitionRegistry([profile("research")]),
        runner: new AgentRunner({ executor: execute }),
      }),
    });
    await engine.run({
      workflowRunId: "current",
      input: {},
      graph: {
        nodes: [
          { id: "needed", agentRole: "researcher", description: "Required", risk: "read-only" },
          { id: "unrelated", agentRole: "researcher", description: "Unrelated", risk: "read-only" },
          {
            id: "consumer",
            agentRole: "researcher",
            description: "Consume",
            risk: "read-only",
            dependsOn: ["needed"],
          },
        ],
      },
    });
    const context = execute.mock.calls.find(([value]) => value.task.id === "consumer")?.[0].task
      .context;
    expect(Object.keys(context?.dependencyResults as object)).toEqual(["needed"]);
    expect(context?.sharedState).toMatchObject({
      facts: {},
      artifacts: [expect.objectContaining({ taskId: "needed" })],
    });
  });

  it("rejects structured outputs that fail a declared JSON schema", async () => {
    const definition = {
      ...profile("structured"),
      outputSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    };
    const engine = new AgentGraphEngine({
      nodeExecutor: createRuntimeAgentNodeExecutor({
        registry: createAgentDefinitionRegistry([definition]),
        runner: new AgentRunner({ executor: async () => ({ output: '{"answer":42}' }) }),
      }),
    });
    const result = await engine.run({
      workflowRunId: "schema",
      input: {},
      graph: {
        nodes: [
          { id: "work", agentRole: "researcher", description: "Return answer", risk: "read-only" },
        ],
      },
    });
    expect(result.status).toBe("failed");
    expect(result.nodeResults.work?.error).toContain("output schema");
    expect(result.artifacts).toEqual([]);
  });

  it("accepts valid structured output and preserves its evidence", async () => {
    const definition = {
      ...profile("structured"),
      outputSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
      },
    };
    const engine = new AgentGraphEngine({
      nodeExecutor: createRuntimeAgentNodeExecutor({
        registry: createAgentDefinitionRegistry([definition]),
        runner: new AgentRunner({ executor: async () => ({ output: '{"answer":"observed"}' }) }),
      }),
    });
    const result = await engine.run({
      workflowRunId: "schema-pass",
      input: {},
      graph: {
        nodes: [
          { id: "work", agentRole: "researcher", description: "Return answer", risk: "read-only" },
        ],
      },
    });
    expect(result.status).toBe("completed");
  });
});
