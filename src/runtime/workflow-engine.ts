import { createEventLog } from "./event-log.js";
import type { EventLog } from "./types.js";
import {
  createWorkflowCatalog,
  type WorkflowCatalog,
  type WorkflowDefinition,
  type WorkflowPlan,
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

export class WorkflowEngine {
  private handlers = new Map<string, WorkflowHandler>();

  constructor(
    private readonly catalog: WorkflowCatalog = createWorkflowCatalog(),
    private readonly eventLog: EventLog = createEventLog(),
  ) {}

  registerHandler(workflowId: string, handler: WorkflowHandler): void {
    if (!this.catalog.get(workflowId)) {
      throw new Error(`Unknown workflow: ${workflowId}`);
    }
    this.handlers.set(workflowId, handler);
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
    if (!handler) {
      throw new Error(`No handler registered for workflow: ${request.workflowId}`);
    }

    const plan = request.plan ?? this.createPlan(request.workflowId, request.input);
    const startedAt = new Date().toISOString();
    const runId = `${request.workflowId}-run-${Date.now().toString(36)}`;
    this.eventLog.record("workflow.started", {
      workflowId: request.workflowId,
      planId: plan.id,
      runId,
    });

    try {
      const output = await handler(request.input, {
        workflow,
        plan,
        eventLog: this.eventLog,
      });
      const completedAt = new Date().toISOString();
      const result: WorkflowRunResult = {
        id: runId,
        workflowId: request.workflowId,
        status: "completed",
        output,
        startedAt,
        completedAt,
      };
      this.eventLog.record("workflow.completed", {
        workflowId: request.workflowId,
        planId: plan.id,
        runId,
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
      });
      return {
        id: runId,
        workflowId: request.workflowId,
        status: "failed",
        output: null,
        startedAt,
        completedAt,
        error: message,
      };
    }
  }
}

export function createWorkflowEngine(
  catalog?: WorkflowCatalog,
  eventLog?: EventLog,
): WorkflowEngine {
  return new WorkflowEngine(catalog, eventLog);
}
