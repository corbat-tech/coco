import { createEventLog } from "./event-log.js";
import type { EventLog } from "./types.js";
import {
  assertRuntimeTenantBoundary,
  evaluateRuntimeRiskPolicy,
  evaluateRuntimeToolPolicy,
  type RuntimeHostMode,
  type RuntimePolicy,
  type RuntimeRequestContext,
} from "./context.js";
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
  createRuntimeAgentNodeExecutor,
  type AgentDefinitionRegistry,
  type RuntimeAgentNodeExecutorOptions,
} from "./runtime-agent-node-executor.js";
import {
  createWorkflowCatalog,
  type WorkflowCatalog,
  type WorkflowDefinition,
  type WorkflowPlan,
  type WorkflowRisk,
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
  agentDefinitionRegistry?: AgentDefinitionRegistry;
  agentNodeExecutorOptions?: Omit<RuntimeAgentNodeExecutorOptions, "registry" | "runtimePolicy">;
  runtimePolicy?: RuntimePolicy;
  runtimeContext?: RuntimeRequestContext;
  runtimeHostMode?: RuntimeHostMode;
}

export class WorkflowEngine {
  private handlers = new Map<string, WorkflowHandler>();
  private readonly sharedState: SharedWorkspaceStore;
  private readonly runtimePolicy?: RuntimePolicy;
  private readonly runtimeContext?: RuntimeRequestContext;
  private readonly runtimeHostMode: RuntimeHostMode;
  private nodeExecutor?: AgentGraphNodeExecutor;

  constructor(
    private readonly catalog: WorkflowCatalog = createWorkflowCatalog(),
    private readonly eventLog: EventLog = createEventLog(),
    options: Omit<WorkflowEngineOptions, "catalog" | "eventLog"> = {},
  ) {
    this.sharedState = options.sharedState ?? new InMemorySharedWorkspaceStore();
    this.runtimePolicy = options.runtimePolicy;
    this.runtimeContext = options.runtimeContext;
    this.runtimeHostMode = options.runtimeHostMode ?? "local";
    this.nodeExecutor =
      options.nodeExecutor ??
      (options.agentDefinitionRegistry
        ? createRuntimeAgentNodeExecutor({
            ...options.agentNodeExecutorOptions,
            registry: options.agentDefinitionRegistry,
            runtimePolicy: options.runtimePolicy,
          })
        : undefined);
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
    assertRuntimeTenantBoundary(this.runtimeContext, this.runtimeHostMode, "workflow.run");
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
      const graph = workflowToAgentGraph(workflow);
      assertWorkflowAllowedByRuntimePolicy(graph, this.runtimePolicy);
      const graphResult = handler
        ? undefined
        : await new AgentGraphEngine({
            eventLog: this.eventLog,
            sharedState: this.sharedState,
            nodeExecutor: this.nodeExecutor,
            trace,
          }).run({
            workflowRunId: runId,
            graph,
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

function assertWorkflowAllowedByRuntimePolicy(
  graph: ReturnType<typeof workflowToAgentGraph>,
  policy: RuntimePolicy | undefined,
): void {
  if (!policy) return;
  for (const node of graph.nodes) {
    const risk = (node.risk ?? "read-only") as WorkflowRisk;
    const riskDecision = evaluateRuntimeRiskPolicy(policy, {
      subject: `workflow node ${node.id}`,
      risk,
    });
    if (!riskDecision.allowed) {
      throw new Error(
        `Workflow node ${node.id} is blocked by runtime policy: ${riskDecision.reason}`,
      );
    }
    for (const toolName of node.requiredTools ?? []) {
      const decision = evaluateRuntimeToolPolicy(policy, { toolName, risk });
      if (!decision.allowed) {
        throw new Error(
          `Workflow node ${node.id} is blocked by runtime policy: ${decision.reason}`,
        );
      }
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
