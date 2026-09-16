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
  /** Preserve the public runtime API event contract when used by its facade. */
  eventProfile?: "agent" | "runtime-api";
}

export interface RuntimeToolExecutorInput {
  /** Provider call ID for correlating parallel tool attempts. */
  toolCallId?: string;
  /** Cancellation forwarded to the registry without changing tool authority. */
  signal?: AbortSignal;
  sessionId?: string;
  toolName: string;
  input: Record<string, unknown>;
  mode?: RuntimeMode;
  allowedTools?: string[];
  confirmed?: boolean;
  metadata?: Record<string, unknown>;
}

interface AuthorityCeiling {
  readonly mode: RuntimeMode;
  readonly allowedTools?: ReadonlySet<string>;
}

export class RuntimeToolExecutor {
  private readonly toolRegistry: ToolRegistry;
  private readonly eventLog: EventLog;
  private readonly permissionPolicy: PermissionPolicy;
  private readonly defaultMode: RuntimeMode;
  private readonly runtimePolicy?: RuntimePolicy;
  private readonly eventProfile: "agent" | "runtime-api";

  constructor(options: RuntimeToolExecutorOptions) {
    this.toolRegistry = options.toolRegistry;
    this.eventLog = options.eventLog ?? createEventLog();
    this.permissionPolicy = options.permissionPolicy ?? createPermissionPolicy();
    this.defaultMode = options.mode ?? "ask";
    this.runtimePolicy = options.runtimePolicy ? structuredClone(options.runtimePolicy) : undefined;
    this.eventProfile = options.eventProfile ?? "agent";
  }

  async execute(input: RuntimeToolExecutorInput): Promise<RuntimeToolExecutionResult> {
    return this.executeScoped(input, []);
  }

  private async executeScoped(
    input: RuntimeToolExecutorInput,
    ancestors: readonly AuthorityCeiling[],
  ): Promise<RuntimeToolExecutionResult> {
    // Capture authority before any tool/provider awaits or caller mutations.
    input = { ...input, allowedTools: input.allowedTools ? [...input.allowedTools] : undefined };
    const startedAt = performance.now();
    const mode = input.mode ?? this.defaultMode;
    const sessionContext = {
      ...(this.eventProfile === "runtime-api" ? { sessionId: input.sessionId } : {}),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    };
    const allowedTools = input.allowedTools ? new Set(input.allowedTools) : undefined;

    if (
      (allowedTools && !allowedTools.has(input.toolName)) ||
      ancestors.some((ceiling) => ceiling.allowedTools && !ceiling.allowedTools.has(input.toolName))
    ) {
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
      return this.block(input, mode, decision, startedAt, {}, true);
    }

    const decisions = [mode, ...ancestors.map((ceiling) => ceiling.mode)].map((scopeMode) =>
      this.permissionPolicy.canExecuteToolInput
        ? this.permissionPolicy.canExecuteToolInput(scopeMode, tool, input.input)
        : this.permissionPolicy.canExecuteTool(scopeMode, tool),
    );
    const decision = decisions[0]!;
    const runtimeDecision = evaluateRuntimeToolPolicy(this.runtimePolicy, {
      toolName: input.toolName,
      risk: decision.risk,
      confirmed: input.confirmed,
    });

    for (const scopedDecision of decisions) {
      const scopedRuntimeDecision = scopedDecision.allowed
        ? evaluateRuntimeToolPolicy(this.runtimePolicy, {
            toolName: input.toolName,
            risk: scopedDecision.risk,
            confirmed: input.confirmed,
          })
        : undefined;
      if (
        !scopedDecision.allowed ||
        scopedRuntimeDecision?.allowed === false ||
        (scopedDecision.requiresConfirmation && input.confirmed !== true)
      ) {
        const reason =
          scopedRuntimeDecision?.reason ??
          scopedDecision.reason ??
          (scopedDecision.requiresConfirmation
            ? "Tool requires explicit runtime confirmation."
            : "Tool is not allowed.");
        return this.block(
          input,
          mode,
          {
            ...scopedDecision,
            allowed: false,
            reason,
            requiresConfirmation:
              scopedRuntimeDecision?.requiresConfirmation ?? scopedDecision.requiresConfirmation,
            risk: scopedRuntimeDecision?.risk ?? scopedDecision.risk,
          },
          startedAt,
          { runtimePolicyBlocked: scopedRuntimeDecision ? !scopedRuntimeDecision.allowed : false },
        );
      }
    }

    if (this.eventProfile === "agent") {
      this.eventLog.record("agent.tool.called", {
        mode,
        tool: input.toolName,
        risk: decision.risk,
        metadata: input.metadata,
      });
    }
    this.eventLog.record("tool.started", {
      ...sessionContext,
      mode,
      tool: input.toolName,
      risk: decision.risk,
      runtimeApi: true,
      metadataKeys: Object.keys(input.metadata ?? {}).sort(),
    });
    const result = await this.toolRegistry.execute(input.toolName, input.input, {
      signal: input.signal,
      context: {
        executeDelegatedTool: (call) => {
          const signals = [input.signal, call.signal].filter(
            (signal): signal is AbortSignal => signal !== undefined,
          );
          return this.executeScoped(
            {
              toolName: call.toolName,
              input: call.input,
              mode: call.mode,
              allowedTools: [...call.allowedTools],
              toolCallId: call.toolCallId,
              sessionId: input.sessionId,
              signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
              confirmed: false,
            },
            [...ancestors, { mode, allowedTools }],
          );
        },
      },
    });
    this.eventLog.record("tool.completed", {
      ...sessionContext,
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
      decision:
        this.eventProfile === "runtime-api"
          ? {
              ...decision,
              risk: runtimeDecision?.risk ?? decision.risk,
              requiresConfirmation: decision.requiresConfirmation,
            }
          : decision,
    };
  }

  private block(
    input: RuntimeToolExecutorInput,
    mode: RuntimeMode,
    decision: PermissionDecision,
    startedAt: number,
    extraData: Record<string, unknown> = {},
    unregistered = false,
  ): RuntimeToolExecutionResult {
    const runtimeApi = this.eventProfile === "runtime-api";
    this.eventLog.record("tool.blocked", {
      ...(runtimeApi ? { sessionId: input.sessionId } : {}),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      mode,
      tool: input.toolName,
      reason: decision.reason,
      ...(!runtimeApi || !unregistered
        ? { risk: decision.risk, requiresConfirmation: decision.requiresConfirmation }
        : {}),
      runtimeApi: true,
      ...(!runtimeApi ? { metadata: input.metadata } : {}),
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
