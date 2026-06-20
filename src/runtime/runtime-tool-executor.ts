import type { ToolRegistry } from "../tools/registry.js";
import { evaluateRuntimeToolPolicy, type RuntimePolicy } from "./context.js";
import { createEventLog } from "./event-log.js";
import { createPermissionPolicy } from "./permission-policy.js";
import type {
  EventLog,
  PermissionDecision,
  PermissionPolicy,
  RuntimeMode,
  RuntimeToolExecutionResult,
} from "./types.js";

export interface RuntimeToolExecutorOptions {
  toolRegistry: ToolRegistry;
  eventLog?: EventLog;
  permissionPolicy?: PermissionPolicy;
  mode?: RuntimeMode;
  runtimePolicy?: RuntimePolicy;
}

export interface RuntimeToolExecutorInput {
  toolName: string;
  input: Record<string, unknown>;
  mode?: RuntimeMode;
  allowedTools?: string[];
  confirmed?: boolean;
  metadata?: Record<string, unknown>;
}

export class RuntimeToolExecutor {
  private readonly toolRegistry: ToolRegistry;
  private readonly eventLog: EventLog;
  private readonly permissionPolicy: PermissionPolicy;
  private readonly defaultMode: RuntimeMode;
  private readonly runtimePolicy?: RuntimePolicy;

  constructor(options: RuntimeToolExecutorOptions) {
    this.toolRegistry = options.toolRegistry;
    this.eventLog = options.eventLog ?? createEventLog();
    this.permissionPolicy = options.permissionPolicy ?? createPermissionPolicy();
    this.defaultMode = options.mode ?? "ask";
    this.runtimePolicy = options.runtimePolicy;
  }

  async execute(input: RuntimeToolExecutorInput): Promise<RuntimeToolExecutionResult> {
    const startedAt = performance.now();
    const mode = input.mode ?? this.defaultMode;
    const allowedTools = input.allowedTools ? new Set(input.allowedTools) : undefined;

    if (allowedTools && !allowedTools.has(input.toolName)) {
      const decision: PermissionDecision = {
        allowed: false,
        reason: `Tool '${input.toolName}' is not available to this agent.`,
        risk: "read-only",
      };
      return this.block(input, mode, decision, startedAt);
    }

    const tool = this.toolRegistry.get(input.toolName);
    if (!tool) {
      const decision: PermissionDecision = {
        allowed: false,
        reason: "Tool not registered.",
        risk: "read-only",
      };
      return this.block(input, mode, decision, startedAt);
    }

    const decision = this.permissionPolicy.canExecuteToolInput
      ? this.permissionPolicy.canExecuteToolInput(mode, tool, input.input)
      : this.permissionPolicy.canExecuteTool(mode, tool);
    const runtimeDecision = decision.allowed
      ? evaluateRuntimeToolPolicy(this.runtimePolicy, {
          toolName: input.toolName,
          risk: decision.risk,
          confirmed: input.confirmed,
        })
      : undefined;

    if (
      !decision.allowed ||
      runtimeDecision?.allowed === false ||
      (decision.requiresConfirmation && input.confirmed !== true)
    ) {
      const reason =
        runtimeDecision?.reason ??
        decision.reason ??
        (decision.requiresConfirmation
          ? "Tool requires explicit runtime confirmation."
          : "Tool is not allowed.");
      return this.block(
        input,
        mode,
        {
          ...decision,
          allowed: false,
          reason,
          requiresConfirmation:
            runtimeDecision?.requiresConfirmation ?? decision.requiresConfirmation,
          risk: runtimeDecision?.risk ?? decision.risk,
        },
        startedAt,
        { runtimePolicyBlocked: runtimeDecision ? !runtimeDecision.allowed : false },
      );
    }

    this.eventLog.record("agent.tool.called", {
      mode,
      tool: input.toolName,
      risk: decision.risk,
      metadata: input.metadata,
    });
    this.eventLog.record("tool.started", {
      mode,
      tool: input.toolName,
      risk: decision.risk,
      runtimeApi: true,
      metadataKeys: Object.keys(input.metadata ?? {}).sort(),
    });
    const result = await this.toolRegistry.execute(input.toolName, input.input);
    this.eventLog.record("tool.completed", {
      mode,
      tool: input.toolName,
      success: result.success,
      duration: result.duration,
      runtimeApi: true,
    });

    return {
      toolName: input.toolName,
      success: result.success,
      output: result.data,
      error: result.error,
      duration: result.duration,
      decision,
    };
  }

  private block(
    input: RuntimeToolExecutorInput,
    mode: RuntimeMode,
    decision: PermissionDecision,
    startedAt: number,
    extraData: Record<string, unknown> = {},
  ): RuntimeToolExecutionResult {
    this.eventLog.record("tool.blocked", {
      mode,
      tool: input.toolName,
      reason: decision.reason,
      risk: decision.risk,
      requiresConfirmation: decision.requiresConfirmation,
      runtimeApi: true,
      metadata: input.metadata,
      ...extraData,
    });
    return {
      toolName: input.toolName,
      success: false,
      error: decision.reason ?? "Tool is not allowed.",
      duration: performance.now() - startedAt,
      decision,
    };
  }
}

export function createRuntimeToolExecutor(
  options: RuntimeToolExecutorOptions,
): RuntimeToolExecutor {
  return new RuntimeToolExecutor(options);
}
