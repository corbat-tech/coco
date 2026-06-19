import { describe, expect, it } from "vitest";
import {
  createAgentArtifact,
  normalizeAgentRunResult,
  SharedWorkspaceState,
  validateAgentCapabilities,
  validateAgentGraph,
} from "./multi-agent.js";

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
});
