import {
  createAgentTraceContext,
  evaluateAgentToolPolicy,
  normalizeAgentRunResult,
  type AgentCapability,
  type AgentRunResult,
  type AgentTask,
  type AgentTraceContext,
  type ToolRiskManifest,
} from "./multi-agent.js";
import type { EventLog } from "./types.js";

export interface AgentRunnerExecutionInput {
  task: AgentTask;
  capability: AgentCapability;
  trace?: AgentTraceContext;
  toolRiskManifest?: ToolRiskManifest;
}

export interface AgentRunnerExecutionContext {
  task: AgentTask;
  capability: AgentCapability;
  trace: AgentTraceContext;
  assertToolAllowed(toolName: string): void;
}

export type AgentRunnerExecutor = (
  context: AgentRunnerExecutionContext,
) => Promise<AgentRunnerRawResult>;

export interface AgentRunnerRawResult {
  output: string;
  success?: boolean;
  turns?: number;
  toolsUsed?: string[];
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunnerOptions {
  eventLog?: EventLog;
  executor?: AgentRunnerExecutor;
}

export class AgentRunner {
  constructor(private readonly options: AgentRunnerOptions = {}) {}

  async run(input: AgentRunnerExecutionInput): Promise<AgentRunResult> {
    const startedAt = new Date().toISOString();
    const trace = input.trace ?? createAgentTraceContext({ taskId: input.task.id });
    this.options.eventLog?.record("agent.started", {
      taskId: input.task.id,
      role: input.task.role,
      trace,
    });

    try {
      const raw = await (this.options.executor ?? defaultExecutor)({
        task: input.task,
        capability: input.capability,
        trace,
        assertToolAllowed: (toolName) => {
          const decision = evaluateAgentToolPolicy({
            capability: input.capability,
            toolName,
            manifest: input.toolRiskManifest,
          });
          this.options.eventLog?.record("agent.tool.called", {
            taskId: input.task.id,
            role: input.task.role,
            toolName,
            decision,
            trace,
          });
          if (!decision.allowed) {
            throw new Error(decision.reason ?? `Tool '${toolName}' is not allowed.`);
          }
        },
      });
      const result = normalizeAgentRunResult({
        id: `${input.task.id}-run-${Date.now().toString(36)}`,
        taskId: input.task.id,
        role: input.task.role,
        success: raw.success ?? true,
        output: raw.output,
        turns: raw.turns,
        toolsUsed: raw.toolsUsed,
        usage: {
          inputTokens: raw.inputTokens ?? 0,
          outputTokens: raw.outputTokens ?? 0,
          estimated: raw.inputTokens === undefined || raw.outputTokens === undefined,
        },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - Date.parse(startedAt),
        error: raw.error,
        metadata: { ...raw.metadata, trace },
      });

      this.options.eventLog?.record(result.success ? "agent.completed" : "agent.failed", {
        taskId: input.task.id,
        role: input.task.role,
        agentRunId: result.id,
        trace,
        error: result.error,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = normalizeAgentRunResult({
        id: `${input.task.id}-run-${Date.now().toString(36)}`,
        taskId: input.task.id,
        role: input.task.role,
        success: false,
        output: message,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - Date.parse(startedAt),
        error: message,
        metadata: { trace },
      });
      this.options.eventLog?.record("agent.failed", {
        taskId: input.task.id,
        role: input.task.role,
        agentRunId: result.id,
        trace,
        error: message,
      });
      return result;
    }
  }
}

export function createAgentRunner(options?: AgentRunnerOptions): AgentRunner {
  return new AgentRunner(options);
}

async function defaultExecutor(
  context: AgentRunnerExecutionContext,
): Promise<AgentRunnerRawResult> {
  return {
    output: `Agent ${context.capability.role} accepted task '${context.task.objective}'.`,
  };
}
