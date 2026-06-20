import { getDefaultModel } from "../config/env.js";
import type { ProviderType } from "../providers/index.js";
import type { LLMProvider } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { listAgentModes } from "./agent-modes.js";
import {
  assertRuntimeUsageWithinPolicy,
  createRuntimeRequestContext,
  evaluateRuntimeToolPolicy,
  mergeRuntimePolicy,
  runtimeContextToMetadata,
  type RuntimePolicy,
  type RuntimeRequestContext,
} from "./context.js";
import { createDefaultRuntimeTurnRunner } from "./default-turn-runner.js";
import { createEventLog, createFileEventLog } from "./event-log.js";
import { createPermissionPolicy } from "./permission-policy.js";
import { createProviderRegistry, ProviderRegistry } from "./provider-registry.js";
import { createRuntimeSessionStore } from "./runtime-session-store.js";
import { createWorkflowEngine, type WorkflowEngine } from "./workflow-engine.js";
import type {
  AgentRuntimeOptions,
  AgentRuntimeSnapshot,
  EventLog,
  PermissionPolicy,
  RuntimeSession,
  RuntimeSessionCreateOptions,
  RuntimeSessionStore,
  RuntimeToolExecutionInput,
  RuntimeToolExecutionResult,
  RuntimeTurnInput,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent,
  RuntimeTurnRunner,
  RuntimeMode,
} from "./types.js";

/**
 * Reusable runtime facade for wiring providers, tools, permissions, sessions,
 * and observability. It does not own the CLI loop; CLI/headless are adapters on
 * top of this boundary.
 */
export class AgentRuntime {
  readonly providerRegistry: ProviderRegistry;
  readonly toolRegistry: ToolRegistry;
  readonly sessionStore: unknown;
  readonly runtimeSessionStore: RuntimeSessionStore;
  readonly workflowEngine: WorkflowEngine;
  readonly permissionPolicy: PermissionPolicy;
  readonly eventLog: EventLog;
  readonly turnRunner: RuntimeTurnRunner;
  private providerType: ProviderType;
  private model: string;
  private provider?: LLMProvider;
  private readonly runtimeContext?: RuntimeRequestContext;
  private readonly runtimePolicy?: RuntimePolicy;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.providerRegistry = createProviderRegistry();
    this.toolRegistry = options.toolRegistry ?? new ToolRegistry();
    this.sessionStore = options.sessionStore;
    this.runtimeSessionStore = options.runtimeSessionStore ?? createRuntimeSessionStore();
    this.eventLog =
      options.eventLog ??
      (options.eventLogPath ? createFileEventLog(options.eventLogPath) : createEventLog());
    this.permissionPolicy = options.permissionPolicy ?? createPermissionPolicy();
    this.turnRunner = options.turnRunner ?? createDefaultRuntimeTurnRunner();
    this.providerType = options.providerType;
    this.model =
      options.model ?? options.providerConfig?.model ?? getDefaultModel(options.providerType);
    this.runtimeContext = options.runtimeContext
      ? createRuntimeRequestContext(options.runtimeContext)
      : undefined;
    this.runtimePolicy = mergeRuntimePolicy(this.runtimeContext?.policy, options.runtimePolicy);
    this.workflowEngine =
      options.workflowEngine ??
      createWorkflowEngine(undefined, this.eventLog, { runtimePolicy: this.runtimePolicy });
  }

  async initialize(): Promise<void> {
    const providerInjected = Boolean(this.options.provider);
    const provider =
      this.options.provider ??
      (await this.providerRegistry.createProvider(this.providerType, {
        ...this.options.providerConfig,
        model: this.getModel(),
      }));
    this.provider = provider;

    this.publishToGlobalBridge(provider);

    this.eventLog.record(providerInjected ? "provider.attached" : "provider.created", {
      provider: this.providerType,
      model: this.getModel(),
      createdByRuntime: !providerInjected,
    });
    this.eventLog.record("runtime.initialized", { snapshot: this.snapshot() });
  }

  getModel(): string {
    return this.model;
  }

  updateProvider(
    providerType: ProviderType,
    model: string | undefined,
    provider: LLMProvider,
  ): void {
    this.providerType = providerType;
    this.model = model ?? getDefaultModel(providerType);
    this.provider = provider;
    this.publishToGlobalBridge(provider);
    this.eventLog.record("provider.updated", {
      provider: this.providerType,
      model: this.model,
    });
  }

  private publishToGlobalBridge(provider: LLMProvider): void {
    if (this.options.publishToGlobalBridge !== true) return;
    this.options.legacyAgentBridge?.setAgentProvider(provider);
    this.options.legacyAgentBridge?.setAgentToolRegistry(this.toolRegistry);
  }

  snapshot(): AgentRuntimeSnapshot {
    const capability = this.providerRegistry.getCapability(this.providerType, this.getModel());
    const toolNames = this.toolRegistry
      .getAll()
      .map((tool) => tool.name)
      .sort();

    return {
      provider: {
        type: this.providerType,
        model: this.getModel(),
        capability,
      },
      tools: {
        count: toolNames.length,
        names: toolNames,
      },
      modes: listAgentModes(),
      context: this.runtimeContext,
      policy: this.runtimePolicy,
    };
  }

  createSession(options: RuntimeSessionCreateOptions = {}): RuntimeSession {
    const session = this.runtimeSessionStore.create({
      ...options,
      metadata: {
        ...runtimeContextToMetadata(this.runtimeContext),
        ...options.metadata,
      },
    });
    this.eventLog.record("session.created", {
      sessionId: session.id,
      mode: session.mode,
      ...(session.metadata["tenantId"] ? { tenantId: session.metadata["tenantId"] } : {}),
      ...(session.metadata["surface"] ? { surface: session.metadata["surface"] } : {}),
      ...(session.metadata["correlationId"]
        ? { correlationId: session.metadata["correlationId"] }
        : {}),
      metadataKeys: Object.keys(session.metadata).sort(),
    });
    return session;
  }

  getSession(sessionId: string): RuntimeSession | undefined {
    return this.runtimeSessionStore.get(sessionId);
  }

  listSessions(): RuntimeSession[] {
    return this.runtimeSessionStore.list();
  }

  async runTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
    const provider = this.provider;
    if (!provider) {
      throw new Error("Runtime provider is not initialized.");
    }

    const session = input.sessionId
      ? this.runtimeSessionStore.get(input.sessionId)
      : this.createSession({ mode: input.mode, metadata: input.metadata });
    if (!session) {
      throw new Error(`Runtime session not found: ${input.sessionId}`);
    }
    const effectiveSession =
      input.mode && input.mode !== session.mode ? { ...session, mode: input.mode } : session;

    this.eventLog.record("turn.started", {
      sessionId: effectiveSession.id,
      provider: this.providerType,
      model: this.getModel(),
      mode: effectiveSession.mode,
      runtimeApi: true,
    });

    try {
      const result = await this.turnRunner.run(input, {
        runtime: this,
        session: effectiveSession,
        provider,
        toolRegistry: this.toolRegistry,
        permissionPolicy: this.permissionPolicy,
        eventLog: this.eventLog,
      });
      assertRuntimeUsageWithinPolicy(this.runtimePolicy, result.usage);

      const updatedSession = this.runtimeSessionStore.update({
        ...effectiveSession,
        messages: [
          ...effectiveSession.messages,
          { role: "user", content: input.content },
          { role: "assistant", content: result.content },
        ],
      });

      this.eventLog.record("session.updated", {
        sessionId: updatedSession.id,
        messages: updatedSession.messages.length,
      });
      this.eventLog.record("turn.completed", {
        sessionId: updatedSession.id,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        model: result.model,
        runtimeApi: true,
      });

      return { ...result, sessionId: updatedSession.id, mode: updatedSession.mode };
    } catch (error) {
      this.eventLog.record("turn.failed", {
        sessionId: effectiveSession.id,
        error: error instanceof Error ? error.message : String(error),
        runtimeApi: true,
      });
      throw error;
    }
  }

  async *streamTurn(input: RuntimeTurnInput): AsyncIterable<RuntimeTurnStreamEvent> {
    const provider = this.provider;
    if (!provider) {
      throw new Error("Runtime provider is not initialized.");
    }

    const session = input.sessionId
      ? this.runtimeSessionStore.get(input.sessionId)
      : this.createSession({ mode: input.mode, metadata: input.metadata });
    if (!session) {
      throw new Error(`Runtime session not found: ${input.sessionId}`);
    }
    const effectiveSession =
      input.mode && input.mode !== session.mode ? { ...session, mode: input.mode } : session;
    const messages = [
      ...effectiveSession.messages,
      {
        role: "user" as const,
        content: input.content,
      },
    ];

    this.eventLog.record("turn.started", {
      sessionId: effectiveSession.id,
      provider: this.providerType,
      model: this.getModel(),
      mode: effectiveSession.mode,
      streaming: true,
      runtimeApi: true,
    });

    let content = "";
    let completed = false;
    let failed = false;
    try {
      for await (const chunk of provider.stream(messages, {
        model: input.options?.model,
        maxTokens: input.options?.maxTokens,
        temperature: input.options?.temperature,
        stopSequences: input.options?.stopSequences,
        system: effectiveSession.instructions ?? input.options?.system,
        timeout: input.options?.timeout,
        signal: input.options?.signal,
        thinking: input.options?.thinking,
      })) {
        if (chunk.type === "text" && chunk.text) {
          content += chunk.text;
          yield {
            type: "text",
            sessionId: effectiveSession.id,
            text: chunk.text,
          };
        }
      }

      const updatedSession = this.runtimeSessionStore.update({
        ...effectiveSession,
        messages: [
          ...effectiveSession.messages,
          { role: "user", content: input.content },
          { role: "assistant", content },
        ],
      });
      const result: RuntimeTurnResult = {
        sessionId: updatedSession.id,
        content,
        usage: {
          inputTokens: provider.countTokens(input.content),
          outputTokens: provider.countTokens(content),
          estimated: true,
        },
        model: input.options?.model ?? this.getModel(),
        mode: updatedSession.mode,
      };
      assertRuntimeUsageWithinPolicy(this.runtimePolicy, result.usage);

      this.eventLog.record("session.updated", {
        sessionId: updatedSession.id,
        messages: updatedSession.messages.length,
      });
      this.eventLog.record("turn.completed", {
        sessionId: updatedSession.id,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        model: result.model,
        streaming: true,
        runtimeApi: true,
      });
      completed = true;
      yield { type: "done", sessionId: updatedSession.id, result };
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      this.eventLog.record("turn.failed", {
        sessionId: effectiveSession.id,
        error: message,
        streaming: true,
        runtimeApi: true,
      });
      yield {
        type: "error",
        sessionId: effectiveSession.id,
        error: message,
      };
    } finally {
      if (!completed && !failed) {
        this.eventLog.record("turn.cancelled", {
          sessionId: effectiveSession.id,
          outputTokens: provider.countTokens(content),
          streaming: true,
          runtimeApi: true,
        });
      }
    }
  }

  async executeTool(input: RuntimeToolExecutionInput): Promise<RuntimeToolExecutionResult> {
    const startedAt = performance.now();
    const session = input.sessionId ? this.getSession(input.sessionId) : undefined;

    if (input.sessionId && !session) {
      const decision = {
        allowed: false,
        reason: `Runtime session not found: ${input.sessionId}`,
        risk: "read-only" as const,
      };
      this.eventLog.record("tool.blocked", {
        sessionId: input.sessionId,
        mode: input.mode ?? "ask",
        tool: input.toolName,
        reason: decision.reason,
        runtimeApi: true,
      });
      return {
        toolName: input.toolName,
        success: false,
        error: decision.reason,
        duration: performance.now() - startedAt,
        decision,
      };
    }

    const mode = input.mode ?? session?.mode ?? "ask";
    const tool = this.toolRegistry.get(input.toolName);

    if (!tool) {
      const decision = {
        allowed: false,
        reason: "Tool not registered.",
        risk: "read-only" as const,
      };
      this.eventLog.record("tool.blocked", {
        sessionId: input.sessionId,
        mode,
        tool: input.toolName,
        reason: decision.reason,
        runtimeApi: true,
      });
      return {
        toolName: input.toolName,
        success: false,
        error: decision.reason,
        duration: performance.now() - startedAt,
        decision,
      };
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
    const effectiveDecision = runtimeDecision ?? decision;

    if (
      !decision.allowed ||
      !effectiveDecision.allowed ||
      (decision.requiresConfirmation && input.confirmed !== true)
    ) {
      const reason =
        effectiveDecision.reason ??
        decision.reason ??
        (decision.requiresConfirmation
          ? "Tool requires explicit runtime confirmation."
          : "Tool is not allowed.");
      this.eventLog.record("tool.blocked", {
        sessionId: input.sessionId,
        mode,
        tool: input.toolName,
        reason,
        risk: effectiveDecision.risk,
        requiresConfirmation:
          effectiveDecision.requiresConfirmation ?? decision.requiresConfirmation,
        runtimePolicyBlocked: runtimeDecision ? !runtimeDecision.allowed : false,
        runtimeApi: true,
      });
      return {
        toolName: input.toolName,
        success: false,
        error: reason,
        duration: performance.now() - startedAt,
        decision: {
          ...decision,
          allowed: false,
          reason,
          requiresConfirmation:
            effectiveDecision.requiresConfirmation ?? decision.requiresConfirmation,
          risk: effectiveDecision.risk,
        },
      };
    }

    this.eventLog.record("tool.started", {
      sessionId: input.sessionId,
      mode,
      tool: input.toolName,
      risk: effectiveDecision.risk,
      runtimeApi: true,
      metadataKeys: Object.keys(input.metadata ?? {}).sort(),
    });
    const result = await this.toolRegistry.execute(input.toolName, input.input);
    this.eventLog.record("tool.completed", {
      sessionId: input.sessionId,
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
      decision: {
        ...decision,
        risk: effectiveDecision.risk,
        requiresConfirmation: decision.requiresConfirmation,
      },
    };
  }

  assertToolAllowed(mode: RuntimeMode, toolName: string, input?: Record<string, unknown>): boolean {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      this.eventLog.record("tool.blocked", {
        mode,
        tool: toolName,
        reason: "Tool not registered.",
      });
      return false;
    }

    const decision =
      input && this.permissionPolicy.canExecuteToolInput
        ? this.permissionPolicy.canExecuteToolInput(mode, tool, input)
        : this.permissionPolicy.canExecuteTool(mode, tool);
    const runtimeDecision = decision.allowed
      ? evaluateRuntimeToolPolicy(this.runtimePolicy, {
          toolName,
          risk: decision.risk,
          confirmed: false,
        })
      : undefined;
    const allowed = decision.allowed && runtimeDecision?.allowed !== false;
    this.eventLog.record(allowed ? "tool.allowed" : "tool.blocked", {
      mode,
      tool: toolName,
      ...decision,
      ...(runtimeDecision && !runtimeDecision.allowed
        ? {
            allowed: false,
            reason: runtimeDecision.reason,
            requiresConfirmation: runtimeDecision.requiresConfirmation,
            runtimePolicyBlocked: true,
          }
        : {}),
    });
    return allowed;
  }
}

export async function createAgentRuntime(options: AgentRuntimeOptions): Promise<AgentRuntime> {
  const runtime = new AgentRuntime(options);
  await runtime.initialize();
  return runtime;
}
