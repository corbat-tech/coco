import type { WorkflowRisk } from "./workflow-registry.js";

export type AgentRole =
  | "researcher"
  | "planner"
  | "architect"
  | "editor"
  | "coder"
  | "tester"
  | "reviewer"
  | "optimizer"
  | "security"
  | "qa"
  | "integrator"
  | "pm"
  | "docs"
  | "database";

export interface AgentBudget {
  maxTurns?: number;
  timeoutMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedCostUsd?: number;
}

export interface AgentCapability {
  role: AgentRole;
  allowedTools: string[];
  risk: WorkflowRisk;
  model?: string;
  temperature?: number;
  budget?: AgentBudget;
}

export interface AgentTask {
  id: string;
  role: AgentRole;
  objective: string;
  context?: Record<string, unknown>;
  dependencies?: string[];
  expectedOutput?: AgentArtifactKind[];
  constraints?: string[];
}

export type AgentArtifactKind =
  | "plan"
  | "findings"
  | "patchProposal"
  | "testReport"
  | "riskReport"
  | "summary";

export interface AgentArtifact<T = unknown> {
  id: string;
  kind: AgentArtifactKind;
  agentRunId?: string;
  taskId?: string;
  title?: string;
  content: T;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type AgentRunStatus = "completed" | "failed" | "cancelled" | "timeout";

export interface AgentRunResult {
  id: string;
  taskId: string;
  role: AgentRole;
  status: AgentRunStatus;
  success: boolean;
  output: string;
  artifacts: AgentArtifact[];
  toolsUsed: string[];
  turns: number;
  durationMs: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
  };
  error?: string;
  startedAt: string;
  completedAt: string;
  metadata?: Record<string, unknown>;
}

export type AgentGateKind =
  | "tests"
  | "coverage"
  | "review"
  | "security"
  | "quality-score"
  | "human-approval";

export interface AgentGateDefinition {
  id: string;
  kind: AgentGateKind;
  description: string;
  required: boolean;
  threshold?: number;
}

export interface AgentGraphNode {
  id: string;
  agentRole?: AgentRole;
  description: string;
  dependsOn?: string[];
  requiredTools?: string[];
  risk: WorkflowRisk;
  gates?: string[];
  retryPolicy?: {
    maxAttempts: number;
    backoffMs?: number;
  };
  condition?: string;
}

export interface AgentGraphEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface AgentGraphDefinition {
  nodes: AgentGraphNode[];
  edges?: AgentGraphEdge[];
  gates?: AgentGateDefinition[];
  parallelism?: number;
}

export interface AgentGraphValidationIssue {
  code:
    | "duplicate-node"
    | "missing-dependency"
    | "missing-edge-node"
    | "missing-gate"
    | "cycle"
    | "invalid-parallelism"
    | "invalid-retry-policy";
  message: string;
  nodeId?: string;
  gateId?: string;
}

export interface AgentGraphValidationResult {
  valid: boolean;
  issues: AgentGraphValidationIssue[];
  levels: string[][];
}

export interface SharedWorkspaceStateSnapshot {
  facts: Record<string, unknown>;
  decisions: Record<string, unknown>;
  risks: Record<string, unknown>;
  files: Record<string, unknown>;
  testResults: Record<string, unknown>;
  artifacts: AgentArtifact[];
}

export class SharedWorkspaceState {
  private facts = new Map<string, unknown>();
  private decisions = new Map<string, unknown>();
  private risks = new Map<string, unknown>();
  private files = new Map<string, unknown>();
  private testResults = new Map<string, unknown>();
  private artifacts: AgentArtifact[] = [];

  writeFact(key: string, value: unknown): void {
    this.facts.set(key, value);
  }

  recordDecision(key: string, value: unknown): void {
    this.decisions.set(key, value);
  }

  recordRisk(key: string, value: unknown): void {
    this.risks.set(key, value);
  }

  recordFile(path: string, value: unknown): void {
    this.files.set(path, value);
  }

  recordTestResult(key: string, value: unknown): void {
    this.testResults.set(key, value);
  }

  addArtifact(artifact: AgentArtifact): void {
    this.artifacts.push(cloneArtifact(artifact));
  }

  readForRole(role: AgentRole): SharedWorkspaceStateSnapshot {
    const includeSensitive = role === "security" || role === "integrator" || role === "pm";
    return {
      facts: Object.fromEntries(this.facts),
      decisions: Object.fromEntries(this.decisions),
      risks: includeSensitive ? Object.fromEntries(this.risks) : {},
      files: Object.fromEntries(this.files),
      testResults: Object.fromEntries(this.testResults),
      artifacts: this.artifacts
        .filter((artifact) => includeSensitive || artifact.kind !== "riskReport")
        .map(cloneArtifact),
    };
  }

  snapshot(): SharedWorkspaceStateSnapshot {
    return {
      facts: Object.fromEntries(this.facts),
      decisions: Object.fromEntries(this.decisions),
      risks: Object.fromEntries(this.risks),
      files: Object.fromEntries(this.files),
      testResults: Object.fromEntries(this.testResults),
      artifacts: this.artifacts.map(cloneArtifact),
    };
  }
}

export function createAgentArtifact<T>(
  input: Omit<AgentArtifact<T>, "id" | "createdAt"> & { id?: string; createdAt?: string },
): AgentArtifact<T> {
  return {
    ...input,
    id: input.id ?? `artifact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function createSummaryArtifact(
  output: string,
  metadata: Pick<AgentArtifact, "agentRunId" | "taskId"> & { title?: string } = {},
): AgentArtifact<string> {
  return createAgentArtifact({
    kind: "summary",
    content: output,
    title: metadata.title ?? "Agent summary",
    agentRunId: metadata.agentRunId,
    taskId: metadata.taskId,
  });
}

export function normalizeAgentRunResult(input: {
  id: string;
  taskId: string;
  role: AgentRole;
  success: boolean;
  output: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  turns?: number;
  toolsUsed?: string[];
  usage?: AgentRunResult["usage"];
  error?: string;
  artifacts?: AgentArtifact[];
  status?: AgentRunStatus;
  metadata?: Record<string, unknown>;
}): AgentRunResult {
  const completedAt = input.completedAt ?? new Date().toISOString();
  const startedAt = input.startedAt ?? completedAt;
  const status = input.status ?? (input.success ? "completed" : "failed");
  const artifacts =
    input.artifacts && input.artifacts.length > 0
      ? input.artifacts.map(cloneArtifact)
      : [createSummaryArtifact(input.output, { agentRunId: input.id, taskId: input.taskId })];

  return {
    id: input.id,
    taskId: input.taskId,
    role: input.role,
    status,
    success: input.success,
    output: input.output,
    artifacts,
    toolsUsed: [...(input.toolsUsed ?? [])],
    turns: input.turns ?? 0,
    durationMs: input.durationMs ?? 0,
    usage: input.usage,
    error: input.error,
    startedAt,
    completedAt,
    metadata: input.metadata,
  };
}

export function validateAgentCapabilities(
  capability: AgentCapability,
  requiredTools: string[] = [],
): AgentGraphValidationIssue[] {
  const allowed = new Set(capability.allowedTools);
  return requiredTools
    .filter((tool) => !allowed.has(tool))
    .map((tool) => ({
      code: "missing-dependency" as const,
      message: `Tool '${tool}' is not allowed for agent role '${capability.role}'.`,
    }));
}

export function validateAgentGraph(graph: AgentGraphDefinition): AgentGraphValidationResult {
  const issues: AgentGraphValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const gateIds = new Set((graph.gates ?? []).map((gate) => gate.id));

  if (graph.parallelism !== undefined && graph.parallelism < 1) {
    issues.push({
      code: "invalid-parallelism",
      message: "Graph parallelism must be greater than zero.",
    });
  }

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({
        code: "duplicate-node",
        message: `Duplicate graph node '${node.id}'.`,
        nodeId: node.id,
      });
    }
    nodeIds.add(node.id);

    if (node.retryPolicy && node.retryPolicy.maxAttempts < 1) {
      issues.push({
        code: "invalid-retry-policy",
        message: `Node '${node.id}' retry policy must allow at least one attempt.`,
        nodeId: node.id,
      });
    }

    for (const dep of node.dependsOn ?? []) {
      if (!nodeIds.has(dep) && !graph.nodes.some((candidate) => candidate.id === dep)) {
        issues.push({
          code: "missing-dependency",
          message: `Node '${node.id}' depends on missing node '${dep}'.`,
          nodeId: node.id,
        });
      }
    }

    for (const gate of node.gates ?? []) {
      if (!gateIds.has(gate)) {
        issues.push({
          code: "missing-gate",
          message: `Node '${node.id}' references missing gate '${gate}'.`,
          nodeId: node.id,
          gateId: gate,
        });
      }
    }
  }

  for (const edge of graph.edges ?? []) {
    if (!nodeIds.has(edge.from)) {
      issues.push({
        code: "missing-edge-node",
        message: `Graph edge references missing source node '${edge.from}'.`,
        nodeId: edge.from,
      });
    }
    if (!nodeIds.has(edge.to)) {
      issues.push({
        code: "missing-edge-node",
        message: `Graph edge references missing target node '${edge.to}'.`,
        nodeId: edge.to,
      });
    }
  }

  const levels = buildExecutionLevels(graph, issues);
  return { valid: issues.length === 0, issues, levels };
}

function buildExecutionLevels(
  graph: AgentGraphDefinition,
  issues: AgentGraphValidationIssue[],
): string[][] {
  const dependencies = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    dependencies.set(node.id, new Set(node.dependsOn ?? []));
  }
  for (const edge of graph.edges ?? []) {
    if (dependencies.has(edge.to)) {
      dependencies.get(edge.to)!.add(edge.from);
    }
  }

  const completed = new Set<string>();
  const levels: string[][] = [];
  while (completed.size < dependencies.size) {
    const level = [...dependencies.entries()]
      .filter(([id, deps]) => !completed.has(id) && [...deps].every((dep) => completed.has(dep)))
      .map(([id]) => id);

    if (level.length === 0) {
      const remaining = [...dependencies.keys()].filter((id) => !completed.has(id));
      issues.push({
        code: "cycle",
        message: `Graph contains a cycle involving: ${remaining.join(", ")}.`,
      });
      return levels;
    }

    for (const id of level) completed.add(id);
    levels.push(level);
  }

  return levels;
}

function cloneArtifact<T>(artifact: AgentArtifact<T>): AgentArtifact<T> {
  return {
    ...artifact,
    metadata: artifact.metadata ? { ...artifact.metadata } : undefined,
  };
}
