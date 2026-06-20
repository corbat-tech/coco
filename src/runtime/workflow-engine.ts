import { createEventLog } from "./event-log.js";
import type { EventLog } from "./types.js";
import {
  AgentGraphEngine,
  InMemorySharedWorkspaceStore,
  createAgentTraceContext,
  type AgentGraphNodeExecutor,
  type AgentGraphRunResult,
  type AgentTraceContext,
  type SharedWorkspaceStore,
} from "./multi-agent.js";
import {
  createWorkflowCatalog,
  type WorkflowCatalog,
  type WorkflowDefinition,
  type WorkflowPlan,
  workflowToAgentGraph,
} from "./workflow-registry.js";

export type WorkflowRunStatus = "completed" | "failed";

export interface WorkflowRunInput {
  workflowId: string;
  input: Record<string, unknown>;
  plan?: WorkflowPlan;
}

export interface WorkflowRunResult {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  output: unknown;
  startedAt: string;
  completedAt: string;
  error?: string;
  graphResult?: AgentGraphRunResult;
  trace?: AgentTraceContext;
}

export interface WorkflowRunContext {
  workflow: WorkflowDefinition;
  plan: WorkflowPlan;
  eventLog: EventLog;
}

export type WorkflowHandler = (
  input: Record<string, unknown>,
  context: WorkflowRunContext,
) => Promise<unknown>;

export interface WorkflowEngineOptions {
  catalog?: WorkflowCatalog;
  eventLog?: EventLog;
  sharedState?: SharedWorkspaceStore;
  nodeExecutor?: AgentGraphNodeExecutor;
}

export class WorkflowEngine {
  private handlers = new Map<string, WorkflowHandler>();
  private readonly sharedState: SharedWorkspaceStore;
  private nodeExecutor?: AgentGraphNodeExecutor;

  constructor(
    private readonly catalog: WorkflowCatalog = createWorkflowCatalog(),
    private readonly eventLog: EventLog = createEventLog(),
    options: Omit<WorkflowEngineOptions, "catalog" | "eventLog"> = {},
  ) {
    this.sharedState = options.sharedState ?? new InMemorySharedWorkspaceStore();
    this.nodeExecutor = options.nodeExecutor;
  }

  registerHandler(workflowId: string, handler: WorkflowHandler): void {
    if (!this.catalog.get(workflowId)) {
      throw new Error(`Unknown workflow: ${workflowId}`);
    }
    this.handlers.set(workflowId, handler);
  }

  registerNodeExecutor(executor: AgentGraphNodeExecutor): void {
    this.nodeExecutor = executor;
  }

  createPlan(workflowId: string, input: Record<string, unknown>): WorkflowPlan {
    return this.catalog.createPlan(workflowId, input, this.eventLog);
  }

  async run(request: WorkflowRunInput): Promise<WorkflowRunResult> {
    const workflow = this.catalog.get(request.workflowId);
    if (!workflow) {
      throw new Error(`Unknown workflow: ${request.workflowId}`);
    }
    const handler = this.handlers.get(request.workflowId);

    const plan = request.plan ?? this.createPlan(request.workflowId, request.input);
    const startedAt = new Date().toISOString();
    const runId = `${request.workflowId}-run-${Date.now().toString(36)}`;
    const trace = createAgentTraceContext({ workflowRunId: runId });
    this.eventLog.record("workflow.started", {
      workflowId: request.workflowId,
      planId: plan.id,
      runId,
      trace,
    });

    try {
      const graphResult = handler
        ? undefined
        : await new AgentGraphEngine({
            eventLog: this.eventLog,
            sharedState: this.sharedState,
            nodeExecutor: this.nodeExecutor,
            trace,
          }).run({
            workflowRunId: runId,
            graph: workflowToAgentGraph(workflow),
            input: request.input,
          });
      const output =
        graphResult ??
        (await handler!(request.input, {
          workflow,
          plan,
          eventLog: this.eventLog,
        }));
      if (graphResult?.status === "failed") {
        throw new Error(graphResult.error ?? "Workflow graph failed");
      }
      const completedAt = new Date().toISOString();
      const result: WorkflowRunResult = {
        id: runId,
        workflowId: request.workflowId,
        status: "completed",
        output,
        startedAt,
        completedAt,
        graphResult,
        trace,
      };
      this.eventLog.record("workflow.completed", {
        workflowId: request.workflowId,
        planId: plan.id,
        runId,
        trace,
      });
      return result;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      this.eventLog.record("workflow.failed", {
        workflowId: request.workflowId,
        planId: plan.id,
        runId,
        error: message,
        trace,
      });
      return {
        id: runId,
        workflowId: request.workflowId,
        status: "failed",
        output: null,
        startedAt,
        completedAt,
        error: message,
        trace,
      };
    }
  }
}

export function createWorkflowEngine(
  catalog?: WorkflowCatalog,
  eventLog?: EventLog,
  options?: Omit<WorkflowEngineOptions, "catalog" | "eventLog">,
): WorkflowEngine {
  return new WorkflowEngine(catalog, eventLog, options);
}
