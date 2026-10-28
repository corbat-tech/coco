import { z } from "zod";
import { AGENT_TYPES } from "./agent-type.js";
import { getAgentProfile } from "./agent-profiles.js";
import {
  decideDelegation,
  type DelegationDecision,
  type DelegationMode,
} from "./delegation-policy.js";
import {
  AgentGraphEngine,
  normalizeAgentRunResult,
  validateAgentGraph,
  type AgentGraphDefinition,
  type AgentGraphNodeExecutor,
  type AgentGraphRunResult,
} from "./multi-agent.js";
import type { EventLog } from "./types.js";

const resourcePath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (path) =>
      !/^(?:[a-z]:|\/|\\)/i.test(path) &&
      !/[\\*?]/.test(path) &&
      !path.includes("\0") &&
      path.split("/").every((part) => part !== ".." && part !== "." && part !== ""),
    "Resources must be explicit project-relative paths without traversal or globs",
  );

const AssignmentSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/i),
    profile: z.enum(AGENT_TYPES),
    objective: z.string().trim().min(1).max(4000),
    acceptance: z.array(z.string().trim().min(1).max(500)).min(1).max(16),
    dependsOn: z.array(z.string()).max(64).default([]),
    resources: z
      .object({
        reads: z.array(resourcePath).max(64).default([]),
        writes: z.array(resourcePath).max(64).default([]),
      })
      .strict(),
    maxTurns: z.number().int().positive().max(100).optional(),
  })
  .strict();

/** Shared validation for adapters; the parsed resource declarations never grant authority. */
export const specialistAssignmentSchema = AssignmentSchema;

/** A bounded host-approved assignment. Resource declarations are not tool authority. */
export type SpecialistAssignment = z.input<typeof AssignmentSchema>;

export interface SpecialistCoordinatorOptions {
  /** Must execute through the host's tool authority boundary. No executor is simulated. */
  nodeExecutor: AgentGraphNodeExecutor;
  hostEnabled?: boolean;
  maxConcurrentWorkers?: number;
  maxWorkersPerTask?: number;
  eventLog?: EventLog;
  /** Admission only; the host executor must reserve/account for every actual model call. */
  budgetAvailable?: () => boolean;
}

export interface SpecialistRunInput {
  workflowRunId: string;
  message: string;
  mode?: DelegationMode;
  assignments: SpecialistAssignment[];
  signal?: AbortSignal;
}

export interface SpecialistRunResult {
  decision: DelegationDecision;
  graphResult?: AgentGraphRunResult;
  /** Execution completion is not semantic acceptance. Hosts retain their observed receipts. */
  acceptance: "unverified";
}

/**
 * Validates and adapts bounded assignments onto the existing graph engine.
 * Runs serialize per instance; there is no cross-process lock or OS sandbox.
 * Provider execution, durable recovery and shared usage limits remain host-owned.
 */
export class SpecialistCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private readonly usedRunIds = new Set<string>();
  private readonly concurrency: number;
  private readonly maxWorkers: number;

  constructor(private readonly options: SpecialistCoordinatorOptions) {
    this.concurrency = options.maxConcurrentWorkers ?? 2;
    this.maxWorkers = options.maxWorkersPerTask ?? 4;
    for (const value of [this.concurrency, this.maxWorkers]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 64)
        throw new RangeError("Specialist worker limits must be integers between 1 and 64.");
    }
    if (typeof options.nodeExecutor !== "function")
      throw new Error("SpecialistCoordinator requires a host nodeExecutor.");
  }

  async run(input: SpecialistRunInput): Promise<SpecialistRunResult> {
    input.signal?.throwIfAborted();
    const assignments = z
      .array(AssignmentSchema)
      .min(1)
      .max(this.maxWorkers)
      .parse(input.assignments);
    if (!/^[a-z0-9_-]{1,160}$/i.test(input.workflowRunId))
      throw new Error("A bounded workflowRunId is required.");
    const graph = this.buildGraph(assignments);
    const validation = validateAgentGraph(graph);
    if (!validation.valid)
      throw new Error(
        `Invalid specialist assignments: ${validation.issues.map((issue) => issue.message).join("; ")}`,
      );
    const decision = decideDelegation({
      message: input.message,
      mode: input.mode,
      hostEnabled: this.options.hostEnabled,
      proposal: {
        independentTasks: assignments.length,
        hasDependencies: assignments.some((task) => task.dependsOn.length > 0),
        resourcesCompatible: resourcesCompatible(assignments),
        acceptanceDefined: true,
        budgetAvailable: this.options.budgetAvailable?.() === true,
        profile: assignments[0]!.profile,
      },
    });
    if (decision.strategy === "direct") return { decision, acceptance: "unverified" };
    if (this.options.budgetAvailable?.() !== true)
      return {
        decision: {
          strategy: "direct",
          explicit: decision.explicit,
          reason: "The host has not established an available shared budget.",
        },
        acceptance: "unverified",
      };
    if (decision.strategy === "specialist" && assignments.length !== 1)
      throw new Error(
        "A single-specialist request requires one assignment; use an explicit parallel/sequential request for multiple workers.",
      );
    if (decision.strategy === "sequential") graph.parallelism = 1;
    if (this.usedRunIds.has(input.workflowRunId))
      throw new Error(
        "This specialist run ID was already submitted; inspect effects instead of silently replaying it.",
      );
    this.usedRunIds.add(input.workflowRunId);
    const workflowRunId = input.workflowRunId;
    const signal = input.signal;
    const prior = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      signal?.throwIfAborted();
      const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
      const engine = new AgentGraphEngine({
        eventLog: this.options.eventLog,
        nodeExecutor: async (execution) => {
          if (this.options.budgetAvailable?.() !== true)
            return normalizeAgentRunResult({
              id: `${workflowRunId}-${execution.node.id}-budget`,
              taskId: execution.task.id,
              role: execution.task.role,
              success: false,
              output: "",
              error: "Shared budget is unavailable before worker dispatch.",
            });
          const assignment = byId.get(execution.node.id)!;
          const profile = getAgentProfile(assignment.profile);
          const result = await this.options.nodeExecutor({
            ...execution,
            task: {
              ...execution.task,
              context: {
                ...execution.task.context,
                profile: { id: profile.id, version: profile.version },
                instructions: profile.instructions,
                acceptance: assignment.acceptance,
                resources: assignment.resources,
                maxTurns: Math.min(assignment.maxTurns ?? profile.maxTurns, profile.maxTurns),
                dependencyResults: Object.fromEntries(execution.dependencyResults),
              },
            },
          });
          if (
            result.metadata?.simulated ||
            result.taskId !== execution.task.id ||
            result.role !== execution.task.role
          )
            return normalizeAgentRunResult({
              id: `${workflowRunId}-${execution.node.id}-invalid-result`,
              taskId: execution.task.id,
              role: execution.task.role,
              success: false,
              output: "",
              error: "Worker returned a simulated result or mismatched task identity.",
            });
          return result;
        },
      });
      const graphResult = await engine.run({ workflowRunId, graph, input: {}, signal });
      return { decision, graphResult, acceptance: "unverified" };
    } finally {
      release();
    }
  }

  private buildGraph(assignments: z.infer<typeof AssignmentSchema>[]): AgentGraphDefinition {
    return {
      parallelism: this.concurrency,
      failurePolicy: "continue-independent",
      nodes: assignments.map((assignment) => {
        const profile = getAgentProfile(assignment.profile);
        const mutationCapable = [
          "debug",
          "refactor",
          "test",
          "tdd",
          "e2e",
          "docs",
          "database",
        ].includes(profile.id);
        if (!mutationCapable && assignment.resources.writes.length)
          throw new Error(`Read-only specialist '${assignment.id}' cannot own writes.`);
        if (mutationCapable && !assignment.resources.writes.length)
          throw new Error(
            `Mutation-capable specialist '${assignment.id}' needs explicit write resources.`,
          );
        return {
          id: assignment.id,
          agentDefinitionId: profile.id,
          agentRole: profile.role,
          description: assignment.objective,
          dependsOn: assignment.dependsOn,
          risk:
            profile.id === "database"
              ? "secrets-sensitive"
              : ["test", "tdd", "e2e"].includes(profile.id)
                ? "destructive"
                : mutationCapable
                  ? "write"
                  : "read-only",
        };
      }),
    };
  }
}

/** Create one host-scoped coordinator; do not create one per concurrent work item. */
export function createSpecialistCoordinator(
  options: SpecialistCoordinatorOptions,
): SpecialistCoordinator {
  return new SpecialistCoordinator(options);
}

function resourcesCompatible(assignments: z.infer<typeof AssignmentSchema>[]): boolean {
  return assignments.every((task, index) =>
    assignments
      .slice(index + 1)
      .every(
        (other) =>
          !task.resources.writes.some((path) =>
            [...other.resources.reads, ...other.resources.writes].some((otherPath) =>
              overlaps(path, otherPath),
            ),
          ) &&
          !other.resources.writes.some((path) =>
            task.resources.reads.some((otherPath) => overlaps(path, otherPath)),
          ),
      ),
  );
}

function overlaps(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
