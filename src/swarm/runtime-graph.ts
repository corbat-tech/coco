import type {
  AgentGateDefinition,
  AgentGraphDefinition,
  AgentGraphNode,
  AgentRole,
} from "../runtime/multi-agent.js";
import type { WorkflowRisk } from "../runtime/workflow-registry.js";
import type { SwarmAgentRole, SwarmGate } from "./agents/types.js";
import type { SwarmSpec } from "./spec-parser.js";

const SWARM_ROLE_MAP: Record<SwarmAgentRole, AgentRole> = {
  pm: "pm",
  architect: "architect",
  "best-practices": "reviewer",
  "tdd-developer": "tester",
  qa: "qa",
  "external-reviewer": "reviewer",
  "security-auditor": "security",
  integrator: "integrator",
};

const SWARM_GATE_MAP: Record<SwarmGate, AgentGateDefinition["kind"]> = {
  plan: "review",
  "acceptance-test-red": "tests",
  test: "tests",
  coverage: "coverage",
  review: "review",
  integration: "quality-score",
  "global-score": "quality-score",
};

export function swarmRoleToAgentRole(role: SwarmAgentRole): AgentRole {
  return SWARM_ROLE_MAP[role];
}

export function swarmGateToAgentGate(gate: SwarmGate): AgentGateDefinition {
  return {
    id: gate,
    kind: SWARM_GATE_MAP[gate],
    description: `Swarm gate: ${gate}`,
    required: true,
  };
}

export function createSwarmAgentGraph(spec: SwarmSpec): AgentGraphDefinition {
  const planNodes: AgentGraphNode[] = [
    createNode("plan-pm", "pm", "Clarify product intent and acceptance criteria.", "read-only"),
    createNode("plan-architect", "architect", "Design implementation architecture.", "read-only", [
      "plan-pm",
    ]),
    createNode(
      "plan-best-practices",
      "best-practices",
      "Check implementation strategy against project standards.",
      "read-only",
      ["plan-pm"],
    ),
  ];

  const featureNodes = spec.features.flatMap((feature) => {
    const base = `feature-${feature.id}`;
    const featureDependencies = feature.dependencies.map((id) => `feature-${id}-integrate`);
    const dependencies =
      featureDependencies.length > 0
        ? featureDependencies
        : ["plan-architect", "plan-best-practices"];
    return [
      createNode(
        `${base}-acceptance`,
        "tdd-developer",
        `Write failing acceptance tests for ${feature.name}.`,
        "write",
        dependencies,
        ["acceptance-test-red"],
      ),
      createNode(
        `${base}-implement`,
        "tdd-developer",
        `Implement ${feature.name}.`,
        "destructive",
        [`${base}-acceptance`],
        ["test", "coverage"],
      ),
      createNode(
        `${base}-review`,
        "external-reviewer",
        `Review ${feature.name}.`,
        "read-only",
        [`${base}-implement`],
        ["review"],
      ),
      createNode(
        `${base}-security`,
        "security-auditor",
        `Security review for ${feature.name}.`,
        "read-only",
        [`${base}-implement`],
      ),
      createNode(
        `${base}-integrate`,
        "integrator",
        `Integrate ${feature.name}.`,
        "write",
        [`${base}-review`, `${base}-security`],
        ["integration"],
      ),
    ];
  });

  const finalDependencies =
    spec.features.length > 0
      ? spec.features.map((feature) => `feature-${feature.id}-integrate`)
      : ["plan-architect", "plan-best-practices"];

  return {
    parallelism: 4,
    gates: [
      "plan",
      "acceptance-test-red",
      "test",
      "coverage",
      "review",
      "integration",
      "global-score",
    ].map((gate) => swarmGateToAgentGate(gate as SwarmGate)),
    nodes: [
      ...planNodes,
      ...featureNodes,
      createNode(
        "global-integrator",
        "integrator",
        "Produce final integrated delivery and quality score.",
        "write",
        finalDependencies,
        ["global-score"],
      ),
    ],
  };
}

function createNode(
  id: string,
  role: SwarmAgentRole,
  description: string,
  risk: WorkflowRisk,
  dependsOn: string[] = [],
  gates: SwarmGate[] = [],
): AgentGraphNode {
  return {
    id,
    agentRole: swarmRoleToAgentRole(role),
    description,
    dependsOn,
    gates,
    risk,
  };
}
