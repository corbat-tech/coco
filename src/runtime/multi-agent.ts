import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { EventLog, RuntimeEvent } from "./types.js";
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
  maxConcurrentRuns?: number;
}

export interface AgentCapability {
  role: AgentRole;
  allowedTools: string[];
  risk: WorkflowRisk;
  model?: string;
  temperature?: number;
  budget?: AgentBudget;
  guardrails?: AgentGuardrailPolicy;
}

export interface AgentGuardrailPolicy {
  input?: boolean;
  output?: boolean;
  toolUse?: boolean;
  redactSecrets?: boolean;
  blockPromptInjection?: boolean;
}

export interface AgentDefinition {
  id: string;
  role: AgentRole;
  name: string;
  instructions: string;
  capability: AgentCapability;
  outputSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface LegacyAgentRoleMapping {
  legacy: string;
  role: AgentRole;
  reason: string;
}

const LEGACY_ROLE_MAPPINGS: LegacyAgentRoleMapping[] = [
  { legacy: "explore", role: "researcher", reason: "read-only codebase exploration" },
  { legacy: "researcher", role: "researcher", reason: "legacy executor role" },
  { legacy: "plan", role: "planner", reason: "task planning" },
  { legacy: "planner", role: "planner", reason: "legacy executor role" },
  { legacy: "architect", role: "architect", reason: "architecture design" },
  { legacy: "editor", role: "editor", reason: "implementation edits" },
  { legacy: "debug", role: "coder", reason: "debugging maps to coding capability" },
  { legacy: "coder", role: "coder", reason: "legacy executor role" },
  { legacy: "test", role: "tester", reason: "test authoring/execution" },
  { legacy: "tester", role: "tester", reason: "legacy executor role" },
  { legacy: "verifier", role: "tester", reason: "verification maps to tester capability" },
  { legacy: "tdd", role: "tester", reason: "test-first implementation" },
  { legacy: "e2e", role: "tester", reason: "end-to-end testing" },
  { legacy: "review", role: "reviewer", reason: "code review" },
  { legacy: "reviewer", role: "reviewer", reason: "legacy executor role" },
  { legacy: "refactor", role: "optimizer", reason: "structure optimization" },
  { legacy: "optimizer", role: "optimizer", reason: "legacy executor role" },
  { legacy: "security", role: "security", reason: "security analysis" },
  { legacy: "qa", role: "qa", reason: "quality assurance" },
  { legacy: "integrator", role: "integrator", reason: "integration coordination" },
  { legacy: "pm", role: "pm", reason: "product/project coordination" },
  { legacy: "docs", role: "docs", reason: "documentation" },
  { legacy: "database", role: "database", reason: "database work" },
];

const LEGACY_ROLE_MAP = new Map(LEGACY_ROLE_MAPPINGS.map((mapping) => [mapping.legacy, mapping]));

export function mapLegacyAgentRole(legacyRole: string, fallback: AgentRole = "coder"): AgentRole {
  return LEGACY_ROLE_MAP.get(legacyRole)?.role ?? fallback;
}

export function listLegacyAgentRoleMappings(): LegacyAgentRoleMapping[] {
  return LEGACY_ROLE_MAPPINGS.map((mapping) => ({ ...mapping }));
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

export type AgentMessageRole = "user" | "agent" | "system" | "tool";

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  taskId?: string;
  agentRunId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AgentHandoff {
  id: string;
  fromAgentRunId: string;
  toRole: AgentRole;
  task: AgentTask;
  artifacts: AgentArtifact[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCard {
  id: string;
  role: AgentRole;
  name: string;
  description: string;
  skills: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  capability: AgentCapability;
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
  timeoutMs?: number;
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

export type SharedWorkspaceRecordKind =
  | "fact"
  | "decision"
  | "risk"
  | "file"
  | "testResult"
  | "artifact";

export interface SharedWorkspaceProvenance {
  workflowRunId: string;
  agentRunId?: string;
  nodeId?: string;
  taskId?: string;
  eventId?: string;
  confidence?: number;
  risk?: WorkflowRisk;
}

export interface SharedWorkspaceRecord {
  id: string;
  kind: SharedWorkspaceRecordKind;
  key: string;
  value: unknown;
  provenance: SharedWorkspaceProvenance;
  createdAt: string;
}

export interface SharedWorkspaceWriteInput {
  id?: string;
  kind: SharedWorkspaceRecordKind;
  key: string;
  value: unknown;
  provenance: SharedWorkspaceProvenance;
  createdAt?: string;
}

export interface SharedWorkspaceStore {
  write(input: SharedWorkspaceWriteInput): SharedWorkspaceRecord;
  list(): SharedWorkspaceRecord[];
  snapshot(): SharedWorkspaceStateSnapshot;
  readForRole(role: AgentRole): SharedWorkspaceStateSnapshot;
  clear(): void;
}

function assertProvenance(provenance: SharedWorkspaceProvenance): void {
  if (!provenance.workflowRunId) {
    throw new Error("Shared workspace writes require workflowRunId provenance.");
  }
}

function snapshotFromRecords(
  records: SharedWorkspaceRecord[],
  role?: AgentRole,
): SharedWorkspaceStateSnapshot {
  const includeSensitive =
    role === undefined || role === "security" || role === "integrator" || role === "pm";
  const facts = new Map<string, unknown>();
  const decisions = new Map<string, unknown>();
  const risks = new Map<string, unknown>();
  const files = new Map<string, unknown>();
  const testResults = new Map<string, unknown>();
  const artifacts: AgentArtifact[] = [];

  for (const record of records) {
    if (
      !includeSensitive &&
      (record.kind === "risk" || record.provenance.risk === "secrets-sensitive")
    ) {
      continue;
    }

    switch (record.kind) {
      case "fact":
        facts.set(record.key, record.value);
        break;
      case "decision":
        decisions.set(record.key, record.value);
        break;
      case "risk":
        risks.set(record.key, record.value);
        break;
      case "file":
        files.set(record.key, record.value);
        break;
      case "testResult":
        testResults.set(record.key, record.value);
        break;
      case "artifact":
        if (isAgentArtifact(record.value)) {
          if (includeSensitive || record.value.kind !== "riskReport") {
            artifacts.push(cloneArtifact(record.value));
          }
        }
        break;
    }
  }

  return {
    facts: Object.fromEntries(facts),
    decisions: Object.fromEntries(decisions),
    risks: Object.fromEntries(risks),
    files: Object.fromEntries(files),
    testResults: Object.fromEntries(testResults),
    artifacts,
  };
}

export class InMemorySharedWorkspaceStore implements SharedWorkspaceStore {
  private records: SharedWorkspaceRecord[] = [];

  write(input: SharedWorkspaceWriteInput): SharedWorkspaceRecord {
    assertProvenance(input.provenance);
    const record: SharedWorkspaceRecord = {
      id: input.id ?? `state-${randomUUID()}`,
      kind: input.kind,
      key: input.key,
      value: cloneUnknown(input.value),
      provenance: { ...input.provenance },
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.records.push(record);
    return cloneRecord(record);
  }

  list(): SharedWorkspaceRecord[] {
    return this.records.map(cloneRecord);
  }

  snapshot(): SharedWorkspaceStateSnapshot {
    return snapshotFromRecords(this.records);
  }

  readForRole(role: AgentRole): SharedWorkspaceStateSnapshot {
    return snapshotFromRecords(this.records, role);
  }

  clear(): void {
    this.records = [];
  }
}

export class FileSharedWorkspaceStore implements SharedWorkspaceStore {
  private readonly memory = new InMemorySharedWorkspaceStore();
  private writable = true;

  constructor(private readonly filePath: string) {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      for (const record of this.readRecordsFromDisk()) {
        this.memory.write(record);
      }
    } catch {
      this.writable = false;
    }
  }

  write(input: SharedWorkspaceWriteInput): SharedWorkspaceRecord {
    const record = this.memory.write(input);
    if (this.writable) {
      try {
        writeFileSync(this.filePath, JSON.stringify(this.memory.list(), null, 2), "utf-8");
      } catch {
        this.writable = false;
      }
    }
    return record;
  }

  list(): SharedWorkspaceRecord[] {
    return this.memory.list();
  }

  snapshot(): SharedWorkspaceStateSnapshot {
    return this.memory.snapshot();
  }

  readForRole(role: AgentRole): SharedWorkspaceStateSnapshot {
    return this.memory.readForRole(role);
  }

  clear(): void {
    this.memory.clear();
    if (this.writable) {
      try {
        writeFileSync(this.filePath, "[]", "utf-8");
      } catch {
        this.writable = false;
      }
    }
  }

  private readRecordsFromDisk(): SharedWorkspaceWriteInput[] {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as SharedWorkspaceRecord[];
      return Array.isArray(parsed)
        ? parsed.map((record) => ({
            id: record.id,
            kind: record.kind,
            key: record.key,
            value: record.value,
            provenance: record.provenance,
            createdAt: record.createdAt,
          }))
        : [];
    } catch {
      return [];
    }
  }
}

export class SharedWorkspaceState {
  private readonly workflowRunId = `legacy-state-${Date.now().toString(36)}`;
  private readonly store = new InMemorySharedWorkspaceStore();
  private facts = new Map<string, unknown>();
  private decisions = new Map<string, unknown>();
  private risks = new Map<string, unknown>();
  private files = new Map<string, unknown>();
  private testResults = new Map<string, unknown>();
  private artifacts: AgentArtifact[] = [];

  writeFact(key: string, value: unknown): void {
    this.facts.set(key, value);
    this.store.write({
      kind: "fact",
      key,
      value,
      provenance: { workflowRunId: this.workflowRunId },
    });
  }

  recordDecision(key: string, value: unknown): void {
    this.decisions.set(key, value);
    this.store.write({
      kind: "decision",
      key,
      value,
      provenance: { workflowRunId: this.workflowRunId },
    });
  }

  recordRisk(key: string, value: unknown): void {
    this.risks.set(key, value);
    this.store.write({
      kind: "risk",
      key,
      value,
      provenance: { workflowRunId: this.workflowRunId, risk: "secrets-sensitive" },
    });
  }

  recordFile(path: string, value: unknown): void {
    this.files.set(path, value);
    this.store.write({
      kind: "file",
      key: path,
      value,
      provenance: { workflowRunId: this.workflowRunId },
    });
  }

  recordTestResult(key: string, value: unknown): void {
    this.testResults.set(key, value);
    this.store.write({
      kind: "testResult",
      key,
      value,
      provenance: { workflowRunId: this.workflowRunId },
    });
  }

  addArtifact(artifact: AgentArtifact): void {
    this.artifacts.push(cloneArtifact(artifact));
    this.store.write({
      kind: "artifact",
      key: artifact.id,
      value: artifact,
      provenance: {
        workflowRunId: this.workflowRunId,
        agentRunId: artifact.agentRunId,
        taskId: artifact.taskId,
      },
    });
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

  records(): SharedWorkspaceRecord[] {
    return this.store.list();
  }
}

export type ToolRiskLevel = "low" | "medium" | "high" | "critical";

export interface ToolRiskManifestEntry {
  toolName: string;
  risk: WorkflowRisk;
  level: ToolRiskLevel;
  requiredCapability?: AgentRole | AgentRole[];
  requiresConsent?: boolean;
  destructive?: boolean;
  secretsSensitive?: boolean;
  network?: boolean;
  filesystem?: boolean;
}

export type ToolRiskManifest = Record<string, ToolRiskManifestEntry>;

export interface AgentToolPolicyDecision {
  allowed: boolean;
  risk: WorkflowRisk;
  reason?: string;
  requiresConsent?: boolean;
}

export function evaluateAgentToolPolicy(input: {
  capability: AgentCapability;
  toolName: string;
  manifest?: ToolRiskManifest;
}): AgentToolPolicyDecision {
  const manifestEntry = input.manifest?.[input.toolName];
  const risk = manifestEntry?.risk ?? input.capability.risk;

  if (!input.capability.allowedTools.includes(input.toolName)) {
    return {
      allowed: false,
      risk,
      reason: `Tool '${input.toolName}' is not allowed for agent role '${input.capability.role}'.`,
    };
  }

  if (manifestEntry?.requiredCapability) {
    const allowedRoles = Array.isArray(manifestEntry.requiredCapability)
      ? manifestEntry.requiredCapability
      : [manifestEntry.requiredCapability];
    if (!allowedRoles.includes(input.capability.role)) {
      return {
        allowed: false,
        risk,
        reason: `Tool '${input.toolName}' requires role ${allowedRoles.join(", ")}.`,
      };
    }
  }

  if (riskRank(risk) > riskRank(input.capability.risk)) {
    return {
      allowed: false,
      risk,
      reason: `Tool '${input.toolName}' risk '${risk}' exceeds agent capability risk '${input.capability.risk}'.`,
    };
  }

  return {
    allowed: true,
    risk,
    requiresConsent:
      manifestEntry?.requiresConsent ?? (risk === "destructive" || risk === "secrets-sensitive"),
  };
}

export interface AgentTraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  workflowRunId?: string;
  agentRunId?: string;
  taskId?: string;
  toolCallId?: string;
}

export function createAgentTraceContext(input: Partial<AgentTraceContext> = {}): AgentTraceContext {
  return {
    traceId: input.traceId ?? `trace-${randomUUID()}`,
    spanId: input.spanId ?? `span-${randomUUID()}`,
    parentSpanId: input.parentSpanId,
    workflowRunId: input.workflowRunId,
    agentRunId: input.agentRunId,
    taskId: input.taskId,
    toolCallId: input.toolCallId,
  };
}

export interface AgentGraphNodeExecution {
  node: AgentGraphNode;
  task: AgentTask;
  attempt: number;
  workflowRunId: string;
  trace: AgentTraceContext;
  dependencyResults: Map<string, AgentRunResult>;
  sharedState: SharedWorkspaceStore;
  eventLog: EventLog;
}

export type AgentGraphNodeExecutor = (
  execution: AgentGraphNodeExecution,
) => Promise<AgentRunResult>;

export type AgentGateEvaluator = (input: {
  gate: AgentGateDefinition;
  node: AgentGraphNode;
  result: AgentRunResult;
  workflowRunId: string;
  trace: AgentTraceContext;
  sharedState: SharedWorkspaceStore;
  eventLog: EventLog;
}) => Promise<{ passed: boolean; reason?: string }>;

export interface AgentGraphEngineOptions {
  eventLog?: EventLog;
  sharedState?: SharedWorkspaceStore;
  nodeExecutor?: AgentGraphNodeExecutor;
  gateEvaluator?: AgentGateEvaluator;
  trace?: AgentTraceContext;
  allowSimulated?: boolean;
}

export interface AgentGraphRunInput {
  workflowRunId: string;
  graph: AgentGraphDefinition;
  input: Record<string, unknown>;
}

export type AgentGraphRunStatus = "completed" | "failed";

export interface AgentGraphRunResult {
  id: string;
  status: AgentGraphRunStatus;
  nodeResults: Record<string, AgentRunResult>;
  artifacts: AgentArtifact[];
  stateSnapshot: SharedWorkspaceStateSnapshot;
  trace: AgentTraceContext;
  startedAt: string;
  completedAt: string;
  error?: string;
}

export class AgentGraphEngine {
  private readonly eventLog?: EventLog;
  private readonly sharedState: SharedWorkspaceStore;
  private readonly nodeExecutor: AgentGraphNodeExecutor;
  private readonly gateEvaluator: AgentGateEvaluator;
  private readonly trace: AgentTraceContext;

  constructor(options: AgentGraphEngineOptions = {}) {
    this.eventLog = options.eventLog;
    this.sharedState = options.sharedState ?? new InMemorySharedWorkspaceStore();
    this.nodeExecutor =
      options.nodeExecutor ??
      (options.allowSimulated ? dryRunAgentGraphNodeExecutor : missingAgentGraphNodeExecutor);
    this.gateEvaluator = options.gateEvaluator ?? defaultAgentGateEvaluator;
    this.trace = options.trace ?? createAgentTraceContext();
  }

  async run(input: AgentGraphRunInput): Promise<AgentGraphRunResult> {
    const validation = validateAgentGraph(input.graph);
    if (!validation.valid) {
      throw new Error(
        `Invalid agent graph: ${validation.issues.map((issue) => issue.message).join("; ")}`,
      );
    }

    const startedAt = new Date().toISOString();
    const nodeResults = new Map<string, AgentRunResult>();
    const artifacts: AgentArtifact[] = [];
    const graphTrace = createAgentTraceContext({
      ...this.trace,
      workflowRunId: input.workflowRunId,
    });

    this.eventLog?.record("agent.graph.started", {
      workflowRunId: input.workflowRunId,
      trace: graphTrace,
      levels: validation.levels,
    });

    try {
      for (const level of validation.levels) {
        const batches = chunk(level, input.graph.parallelism ?? level.length);
        for (const batch of batches) {
          const levelResults = await Promise.all(
            batch.map((nodeId) =>
              this.executeNode({
                node: input.graph.nodes.find((candidate) => candidate.id === nodeId)!,
                graph: input.graph,
                workflowRunId: input.workflowRunId,
                input: input.input,
                graphTrace,
                nodeResults,
              }),
            ),
          );
          for (const result of levelResults) {
            nodeResults.set(result.taskId, result);
            artifacts.push(...result.artifacts.map(cloneArtifact));
          }
        }
      }

      const completedAt = new Date().toISOString();
      const result: AgentGraphRunResult = {
        id: input.workflowRunId,
        status: "completed",
        nodeResults: Object.fromEntries(nodeResults),
        artifacts,
        stateSnapshot: this.sharedState.snapshot(),
        trace: graphTrace,
        startedAt,
        completedAt,
      };
      this.eventLog?.record("agent.graph.completed", {
        workflowRunId: input.workflowRunId,
        trace: graphTrace,
        nodeCount: nodeResults.size,
      });
      return result;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      this.eventLog?.record("agent.graph.failed", {
        workflowRunId: input.workflowRunId,
        trace: graphTrace,
        error: message,
      });
      return {
        id: input.workflowRunId,
        status: "failed",
        nodeResults: Object.fromEntries(nodeResults),
        artifacts,
        stateSnapshot: this.sharedState.snapshot(),
        trace: graphTrace,
        startedAt,
        completedAt,
        error: message,
      };
    }
  }

  private async executeNode(input: {
    node: AgentGraphNode;
    graph: AgentGraphDefinition;
    workflowRunId: string;
    input: Record<string, unknown>;
    graphTrace: AgentTraceContext;
    nodeResults: Map<string, AgentRunResult>;
  }): Promise<AgentRunResult> {
    const skipReason = shouldSkipNode(input.node, input.graph, input.input, input.nodeResults);
    if (skipReason) {
      const completedAt = new Date().toISOString();
      const task = graphNodeToTask(input.node, input.input);
      const skipped = normalizeAgentRunResult({
        id: `${input.workflowRunId}-${input.node.id}-skipped`,
        taskId: task.id,
        role: task.role,
        success: true,
        status: "cancelled",
        output: `Skipped node '${input.node.id}': ${skipReason}`,
        startedAt: completedAt,
        completedAt,
        durationMs: 0,
        metadata: {
          workflowRunId: input.workflowRunId,
          nodeId: input.node.id,
          skipped: true,
          skipReason,
        },
      });
      this.eventLog?.record("agent.completed", {
        workflowRunId: input.workflowRunId,
        nodeId: input.node.id,
        agentRunId: skipped.id,
        taskId: task.id,
        role: skipped.role,
        skipped: true,
        reason: skipReason,
        trace: input.graphTrace,
      });
      return skipped;
    }

    const attempts = input.node.retryPolicy?.maxAttempts ?? 1;
    let lastResult: AgentRunResult | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const task = graphNodeToTask(input.node, input.input);
      const trace = createAgentTraceContext({
        traceId: input.graphTrace.traceId,
        parentSpanId: input.graphTrace.spanId,
        workflowRunId: input.workflowRunId,
        taskId: task.id,
      });
      this.eventLog?.record("agent.started", {
        workflowRunId: input.workflowRunId,
        nodeId: input.node.id,
        taskId: task.id,
        role: task.role,
        attempt,
        trace,
      });

      const result = await runWithOptionalTimeout(
        this.nodeExecutor({
          node: input.node,
          task,
          attempt,
          workflowRunId: input.workflowRunId,
          trace,
          dependencyResults: input.nodeResults,
          sharedState: this.sharedState,
          eventLog: this.eventLog ?? NULL_EVENT_LOG,
        }),
        input.node.timeoutMs,
        () =>
          normalizeAgentRunResult({
            id: `${input.workflowRunId}-${input.node.id}-attempt-${attempt}-timeout`,
            taskId: task.id,
            role: task.role,
            success: false,
            status: "timeout",
            output: "",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: input.node.timeoutMs ?? 0,
            error: `Node '${input.node.id}' timed out after ${input.node.timeoutMs}ms.`,
            metadata: {
              workflowRunId: input.workflowRunId,
              nodeId: input.node.id,
              trace,
              timeoutMs: input.node.timeoutMs,
            },
          }),
      );
      lastResult = result;

      for (const artifact of result.artifacts) {
        const record = this.sharedState.write({
          kind: "artifact",
          key: artifact.id,
          value: artifact,
          provenance: {
            workflowRunId: input.workflowRunId,
            agentRunId: result.id,
            nodeId: input.node.id,
            taskId: task.id,
            risk: input.node.risk,
          },
        });
        this.eventLog?.record("shared_state.updated", {
          workflowRunId: input.workflowRunId,
          nodeId: input.node.id,
          agentRunId: result.id,
          recordId: record.id,
          kind: record.kind,
          key: record.key,
          trace,
        });
        this.eventLog?.record("agent.artifact.created", {
          workflowRunId: input.workflowRunId,
          nodeId: input.node.id,
          agentRunId: result.id,
          artifactId: artifact.id,
          kind: artifact.kind,
          trace,
        });
      }

      if (result.success) {
        await this.evaluateNodeGates(input.graph, input.node, result, input.workflowRunId, trace);
        this.eventLog?.record("agent.completed", {
          workflowRunId: input.workflowRunId,
          nodeId: input.node.id,
          agentRunId: result.id,
          taskId: task.id,
          role: result.role,
          attempt,
          trace,
        });
        this.eventLog?.record("checkpoint.created", {
          workflowRunId: input.workflowRunId,
          nodeId: input.node.id,
          agentRunId: result.id,
          taskId: task.id,
          attempt,
          trace,
        });
        return result;
      }

      this.eventLog?.record("agent.failed", {
        workflowRunId: input.workflowRunId,
        nodeId: input.node.id,
        agentRunId: result.id,
        taskId: task.id,
        role: result.role,
        attempt,
        error: result.error,
        trace,
      });

      if (attempt < attempts && input.node.retryPolicy?.backoffMs) {
        await new Promise((resolve) => setTimeout(resolve, input.node.retryPolicy!.backoffMs));
      }
    }

    throw new Error(
      `Node '${input.node.id}' failed after ${attempts} attempt(s): ${
        lastResult?.error ?? "unknown error"
      }`,
    );
  }

  private async evaluateNodeGates(
    graph: AgentGraphDefinition,
    node: AgentGraphNode,
    result: AgentRunResult,
    workflowRunId: string,
    trace: AgentTraceContext,
  ): Promise<void> {
    for (const gateId of node.gates ?? []) {
      const gate = graph.gates?.find((candidate) => candidate.id === gateId);
      if (!gate) continue;
      const evaluation = await this.gateEvaluator({
        gate,
        node,
        result,
        workflowRunId,
        trace,
        sharedState: this.sharedState,
        eventLog: this.eventLog ?? NULL_EVENT_LOG,
      });
      const eventType = evaluation.passed ? "workflow.gate.passed" : "workflow.gate.failed";
      this.eventLog?.record(eventType, {
        workflowRunId,
        nodeId: node.id,
        gateId: gate.id,
        kind: gate.kind,
        required: gate.required,
        reason: evaluation.reason,
        trace,
      });
      if (!evaluation.passed && gate.required) {
        throw new Error(
          `Required gate '${gate.id}' failed for node '${node.id}': ${evaluation.reason ?? "no reason"}`,
        );
      }
    }
  }
}

export function createAgentGraphEngine(options?: AgentGraphEngineOptions): AgentGraphEngine {
  return new AgentGraphEngine(options);
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

const NULL_EVENT_LOG: EventLog = {
  record(type, data = {}): RuntimeEvent {
    return {
      id: `event-${randomUUID()}`,
      type,
      timestamp: new Date().toISOString(),
      data,
    };
  },
  list() {
    return [];
  },
  count() {
    return 0;
  },
  clear() {},
};

function graphNodeToTask(node: AgentGraphNode, workflowInput: Record<string, unknown>): AgentTask {
  return {
    id: node.id,
    role: node.agentRole ?? mapLegacyAgentRole(node.id, "coder"),
    objective: node.description,
    context: {
      workflowInput,
      condition: node.condition,
    },
    dependencies: node.dependsOn,
    constraints: node.requiredTools?.map((tool) => `Requires tool: ${tool}`),
  };
}

export async function dryRunAgentGraphNodeExecutor(
  execution: AgentGraphNodeExecution,
): Promise<AgentRunResult> {
  const startedAt = new Date().toISOString();
  const dependencyOutputs = Object.fromEntries(
    [...execution.dependencyResults.entries()].map(([id, result]) => [
      id,
      { success: result.success, output: result.output },
    ]),
  );
  const output = [
    `Node '${execution.node.id}' executed by ${execution.task.role}.`,
    `Objective: ${execution.task.objective}`,
    Object.keys(dependencyOutputs).length > 0
      ? `Dependencies: ${JSON.stringify(dependencyOutputs)}`
      : "Dependencies: none",
  ].join("\n");

  return normalizeAgentRunResult({
    id: `${execution.workflowRunId}-${execution.node.id}-attempt-${execution.attempt}`,
    taskId: execution.task.id,
    role: execution.task.role,
    success: true,
    output,
    startedAt,
    completedAt: new Date().toISOString(),
    turns: 0,
    toolsUsed: [],
    durationMs: 0,
    metadata: {
      workflowRunId: execution.workflowRunId,
      nodeId: execution.node.id,
      trace: execution.trace,
      simulated: true,
    },
  });
}

async function missingAgentGraphNodeExecutor(
  execution: AgentGraphNodeExecution,
): Promise<AgentRunResult> {
  const completedAt = new Date().toISOString();
  return normalizeAgentRunResult({
    id: `${execution.workflowRunId}-${execution.node.id}-missing-executor`,
    taskId: execution.task.id,
    role: execution.task.role,
    success: false,
    output: "",
    startedAt: completedAt,
    completedAt,
    durationMs: 0,
    error:
      "AgentGraphEngine requires a nodeExecutor. Pass a real executor or set allowSimulated: true for dry-run/demo workflows.",
    metadata: {
      workflowRunId: execution.workflowRunId,
      nodeId: execution.node.id,
      trace: execution.trace,
      missingExecutor: true,
    },
  });
}

async function defaultAgentGateEvaluator(input: {
  gate: AgentGateDefinition;
  result: AgentRunResult;
}): Promise<{ passed: boolean; reason?: string }> {
  if (!input.result.success) {
    return { passed: false, reason: "Agent result was not successful." };
  }
  if (
    input.gate.kind === "tests" ||
    input.gate.kind === "coverage" ||
    input.gate.kind === "security" ||
    input.gate.kind === "quality-score" ||
    input.gate.kind === "human-approval"
  ) {
    return {
      passed: false,
      reason: `Gate '${input.gate.kind}' requires an explicit evaluator.`,
    };
  }
  return { passed: true };
}

function chunk<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(1, size);
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    result.push(items.slice(index, index + safeSize));
  }
  return result;
}

async function runWithOptionalTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  onTimeout: () => T,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(onTimeout()), timeoutMs);
    }),
  ]);
}

function shouldSkipNode(
  node: AgentGraphNode,
  graph: AgentGraphDefinition,
  workflowInput: Record<string, unknown>,
  dependencyResults: Map<string, AgentRunResult>,
): string | undefined {
  const nodeCondition = evaluateGraphCondition(node.condition, workflowInput, dependencyResults);
  if (!nodeCondition.passed) return nodeCondition.reason;

  for (const edge of graph.edges ?? []) {
    if (edge.to !== node.id || !edge.condition) continue;
    const edgeCondition = evaluateGraphCondition(edge.condition, workflowInput, dependencyResults);
    if (!edgeCondition.passed) {
      return `edge '${edge.from}' -> '${edge.to}' condition '${edge.condition}' was false`;
    }
  }

  return undefined;
}

function evaluateGraphCondition(
  condition: string | undefined,
  workflowInput: Record<string, unknown>,
  dependencyResults: Map<string, AgentRunResult>,
): { passed: boolean; reason?: string } {
  if (!condition || condition === "always") return { passed: true };
  if (condition === "never") return { passed: false, reason: "condition 'never' was false" };

  if (condition.startsWith("!input.")) {
    const path = condition.slice("!input.".length);
    return {
      passed: !readPath(workflowInput, path),
      reason: `condition '${condition}' was false`,
    };
  }

  if (condition.startsWith("input.")) {
    const path = condition.slice("input.".length);
    return {
      passed: Boolean(readPath(workflowInput, path)),
      reason: `condition '${condition}' was false`,
    };
  }

  if (condition.startsWith("dependency.") && condition.endsWith(".success")) {
    const id = condition.slice("dependency.".length, -".success".length);
    return {
      passed: dependencyResults.get(id)?.success === true,
      reason: `condition '${condition}' was false`,
    };
  }

  if (condition.startsWith("dependency.") && condition.endsWith(".failed")) {
    const id = condition.slice("dependency.".length, -".failed".length);
    return {
      passed: dependencyResults.get(id)?.success === false,
      reason: `condition '${condition}' was false`,
    };
  }

  return {
    passed: false,
    reason: `Unsupported graph condition '${condition}'.`,
  };
}

function readPath(input: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, input);
}

function riskRank(risk: WorkflowRisk): number {
  switch (risk) {
    case "read-only":
      return 0;
    case "network":
      return 1;
    case "write":
      return 2;
    case "destructive":
      return 3;
    case "secrets-sensitive":
      return 4;
  }
}

function cloneUnknown<T>(value: T): T {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function cloneRecord(record: SharedWorkspaceRecord): SharedWorkspaceRecord {
  return {
    ...record,
    value: cloneUnknown(record.value),
    provenance: { ...record.provenance },
  };
}

function isAgentArtifact(value: unknown): value is AgentArtifact {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "kind" in value &&
    "content" in value &&
    "createdAt" in value
  );
}

function cloneArtifact<T>(artifact: AgentArtifact<T>): AgentArtifact<T> {
  return {
    ...artifact,
    metadata: artifact.metadata ? { ...artifact.metadata } : undefined,
  };
}
