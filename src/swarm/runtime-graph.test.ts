import { describe, expect, it } from "vitest";
import { validateAgentGraph } from "../runtime/multi-agent.js";
import { createSwarmAgentGraph, swarmRoleToAgentRole } from "./runtime-graph.js";
import type { SwarmSpec } from "./spec-parser.js";

describe("swarm runtime graph adapter", () => {
  it("maps swarm roles to canonical runtime roles", () => {
    expect(swarmRoleToAgentRole("tdd-developer")).toBe("tester");
    expect(swarmRoleToAgentRole("security-auditor")).toBe("security");
    expect(swarmRoleToAgentRole("integrator")).toBe("integrator");
  });

  it("creates a valid runtime DAG for swarm features", () => {
    const graph = createSwarmAgentGraph(createSpec());
    const validation = validateAgentGraph(graph);

    expect(validation.valid).toBe(true);
    expect(graph.gates?.map((gate) => gate.id)).toEqual(
      expect.arrayContaining(["test", "coverage", "review", "integration", "global-score"]),
    );
    expect(graph.nodes.find((node) => node.id === "feature-auth-implement")).toMatchObject({
      agentRole: "tester",
      dependsOn: ["feature-auth-acceptance"],
      gates: ["test", "coverage"],
    });
    expect(graph.nodes.find((node) => node.id === "feature-billing-acceptance")).toMatchObject({
      dependsOn: ["feature-auth-integrate"],
    });
  });
});

function createSpec(): SwarmSpec {
  return {
    projectName: "Reference",
    description: "Reference multi-agent workflow",
    techStack: { language: "TypeScript" },
    rawContent: "",
    qualityConfig: {
      minScore: 90,
      maxIterations: 3,
      minCoverage: 85,
    },
    features: [
      {
        id: "auth",
        name: "Auth",
        description: "Authentication",
        acceptanceCriteria: ["login"],
        dependencies: [],
        priority: "high",
      },
      {
        id: "billing",
        name: "Billing",
        description: "Billing",
        acceptanceCriteria: ["invoice"],
        dependencies: ["auth"],
        priority: "medium",
      },
    ],
  };
}
