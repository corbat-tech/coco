import { getDefaultModel } from "../config/env.js";
import type { ProviderType } from "../providers/index.js";
import { estimateCost } from "../providers/pricing.js";
import type { LLMProvider } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { listAgentModes } from "./agent-modes.js";
import {
  assertRuntimeTenantBoundary,
  assertRuntimeTurnWithinPolicy,
  assertRuntimeUsageWithinPolicy,
  createRetentionCutoffs,
  createRuntimeRequestContext,
  evaluateRuntimeToolPolicy,
  mergeRuntimePolicy,
  RuntimePolicyViolation,
  runtimeContextToMetadata,
  type RuntimeHostMode,
  type RuntimePolicy,
  type RuntimeRequestContext,
} from "./context.js";
import { createDefaultRuntimeTurnRunner } from "./default-turn-runner.js";
import { createEventLog, createFileEventLog } from "./event-log.js";
import { createPermissionPolicy } from "./permission-policy.js";
import { createProviderRegistry, ProviderRegistry } from "./provider-registry.js";
import { createRuntimeSessionStore } from "./runtime-session-store.js";
import { RuntimeToolExecutor } from "./runtime-tool-executor.js";
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

export interface RuntimeRetentionCleanupOptions {
  dryRun?: boolean;
  now?: Date;
}

export interface RuntimeRetentionCleanupResult {
  dryRun: boolean;
  cutoffs: ReturnType<typeof createRetentionCutoffs>;
  expiredSessionIds: string[];
  deletedSessionIds: string[];
}

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
  private readonly runtimeHostMode: RuntimeHostMode;
  private readonly requestTimestampsBySubject = new Map<string, number[]>();
  private activeRuns = 0;
  private readonly toolExecutor: RuntimeToolExecutor;

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
    this.runtimeHostMode = options.runtimeHostMode ?? "local";
    this.toolExecutor = new RuntimeToolExecutor({
      toolRegistry: this.toolRegistry,
      eventLog: this.eventLog,
      permissionPolicy: this.permissionPolicy,
      runtimePolicy: this.runtimePolicy,
      eventProfile: "runtime-api",
    });
    assertRuntimeTenantBoundary(this.runtimeContext, this.runtimeHostMode, "runtime.initialize");
    this.workflowEngine =
      options.workflowEngine ??
      createWorkflowEngine(undefined, this.eventLog, {
        runtimePolicy: this.runtimePolicy,
        runtimeContext: this.runtimeContext,
        runtimeHostMode: this.runtimeHostMode,
        agentDefinitionRegistry: options.agentDefinitionRegistry,
      });
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
      hostMode: this.runtimeHostMode,
    };
  }

  createSession(options: RuntimeSessionCreateOptions = {}): RuntimeSession {
    assertRuntimeTenantBoundary(this.runtimeContext, this.runtimeHostMode, "session.create");
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

  cleanupRetention(options: RuntimeRetentionCleanupOptions = {}): RuntimeRetentionCleanupResult {
    assertRuntimeTenantBoundary(this.runtimeContext, this.runtimeHostMode, "retention.cleanup");
    const dryRun = options.dryRun ?? true;
    const cutoffs = createRetentionCutoffs(this.runtimePolicy, options.now);
    const expiredSessionIds = cutoffs.conversationBefore
      ? this.runtimeSessionStore
          .list()
          .filter((session) => session.updatedAt < cutoffs.conversationBefore!)
          .map((session) => session.id)
      : [];
    const deletedSessionIds = dryRun
      ? []
      : expiredSessionIds.filter((id) => this.runtimeSessionStore.delete(id));

    this.eventLog.record("retention.cleanup", {
      dryRun,
      cutoffs,
      expiredSessionIds,
      deletedSessionIds,
      tenantId: this.runtimeContext?.tenant?.id,
      runtimeApi: true,
    });

    return {
      dryRun,
      cutoffs,
      expiredSessionIds,
      deletedSessionIds,
    };
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
    assertRuntimeTurnWithinPolicy(this.runtimePolicy, {
      subject: "turn.run",
      currentTurns: countUserTurns(effectiveSession),
      tenantId: this.runtimeContext?.tenant?.id,
    });
    const releaseRuntimeRequest = this.beginRuntimeRequest("turn.run");

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
      const estimatedCostUsd = this.estimateTurnCost(result);
      assertRuntimeUsageWithinPolicy(this.runtimePolicy, {
        ...result.usage,
        estimatedCostUsd,
        tenantId: this.runtimeContext?.tenant?.id,
        subject: "turn.run",
      });

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
        estimatedCostUsd,
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
    } finally {
      releaseRuntimeRequest();
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
    assertRuntimeTurnWithinPolicy(this.runtimePolicy, {
      subject: "turn.stream",
      currentTurns: countUserTurns(effectiveSession),
      tenantId: this.runtimeContext?.tenant?.id,
    });
    const releaseRuntimeRequest = this.beginRuntimeRequest("turn.stream");
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
    let terminal = false;
    try {
      input.options?.signal?.throwIfAborted();
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
        input.options?.signal?.throwIfAborted();
        if (chunk.type !== "text" && chunk.type !== "done") {
          throw new Error("Runtime turn incomplete: text-only stream requested tool execution.");
        }
        if (terminal) {
          throw new Error(
            "Runtime turn incomplete: provider emitted content after its terminal event.",
          );
        }
        if (chunk.type === "done") {
          if (chunk.stopReason !== "end_turn" && chunk.stopReason !== "stop_sequence") {
            throw new Error(
              `Runtime turn incomplete: provider stopped with ${chunk.stopReason ?? "unknown"}.`,
            );
          }
          terminal = true;
        }
        if (chunk.type === "text" && chunk.text) {
          content += chunk.text;
          yield {
            type: "text",
            sessionId: effectiveSession.id,
            text: chunk.text,
          };
        }
      }

      input.options?.signal?.throwIfAborted();
      if (!terminal)
        throw new Error("Runtime turn incomplete: provider stream ended without a terminal event.");
      const result: RuntimeTurnResult = {
        sessionId: effectiveSession.id,
        content,
        usage: {
          inputTokens: provider.countTokens(input.content),
          outputTokens: provider.countTokens(content),
          estimated: true,
        },
        model: input.options?.model ?? this.getModel(),
        mode: effectiveSession.mode,
      };
      const estimatedCostUsd = this.estimateTurnCost(result);
      assertRuntimeUsageWithinPolicy(this.runtimePolicy, {
        ...result.usage,
        estimatedCostUsd,
        tenantId: this.runtimeContext?.tenant?.id,
        subject: "turn.stream",
      });

      const updatedSession = this.runtimeSessionStore.update({
        ...effectiveSession,
        messages: [
          ...effectiveSession.messages,
          { role: "user", content: input.content },
          { role: "assistant", content },
        ],
      });
      result.sessionId = updatedSession.id;
      result.mode = updatedSession.mode;

      this.eventLog.record("session.updated", {
        sessionId: updatedSession.id,
        messages: updatedSession.messages.length,
      });
      this.eventLog.record("turn.completed", {
        sessionId: updatedSession.id,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostUsd,
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
      releaseRuntimeRequest();
    }
  }

  /** Enable session-owned background jobs only from a host with a close lifecycle. */
  enableBackgroundJobs(sessionId: string, projectRoot: string): void {
    assertRuntimeTenantBoundary(this.runtimeContext, this.runtimeHostMode, "tool.execute");
    if (!this.getSession(sessionId)) throw new Error(`Runtime session not found: ${sessionId}`);
    this.toolExecutor.enableBackgroundJobs(sessionId, projectRoot);
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.toolExecutor.closeSession(sessionId);
  }

  async close(): Promise<void> {
    await this.toolExecutor.close();
  }

  async executeTool(input: RuntimeToolExecutionInput): Promise<RuntimeToolExecutionResult> {
    assertRuntimeTenantBoundary(this.runtimeContext, this.runtimeHostMode, "tool.execute");
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
        ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
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

    return this.toolExecutor.execute({
      ...input,
      mode: input.mode ?? session?.mode ?? "ask",
    });
  }

  assertToolAllowed(mode: RuntimeMode, toolName: string, input?: Record<string, unknown>): boolean {
    assertRuntimeTenantBoundary(this.runtimeContext, this.runtimeHostMode, "tool.assertAllowed");
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

  private beginRuntimeRequest(subject: string): () => void {
    assertRuntimeTenantBoundary(this.runtimeContext, this.runtimeHostMode, subject);
    this.assertWithinRateLimit(subject);
    this.assertWithinConcurrencyLimit(subject);
    this.activeRuns += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeRuns = Math.max(0, this.activeRuns - 1);
    };
  }

  private assertWithinRateLimit(subject: string): void {
    const maxRequestsPerMinute = this.runtimePolicy?.rateLimit?.maxRequestsPerMinute;
    if (maxRequestsPerMinute === undefined) return;
    const now = Date.now();
    const windowStart = now - 60_000;
    const key = `${this.runtimeContext?.tenant?.id ?? "global"}:${subject}`;
    const recent = (this.requestTimestampsBySubject.get(key) ?? []).filter(
      (timestamp) => timestamp > windowStart,
    );
    if (recent.length >= maxRequestsPerMinute) {
      this.requestTimestampsBySubject.set(key, recent);
      throw new RuntimePolicyViolation({
        code: "rate_limit_exceeded",
        subject,
        tenantId: this.runtimeContext?.tenant?.id,
        policyPath: "runtimePolicy.rateLimit.maxRequestsPerMinute",
        message: `Runtime policy rate limit exceeded: ${recent.length}/${maxRequestsPerMinute} requests per minute.`,
      });
    }
    recent.push(now);
    this.requestTimestampsBySubject.set(key, recent);
  }

  private assertWithinConcurrencyLimit(subject: string): void {
    const maxConcurrentRuns = this.runtimePolicy?.rateLimit?.maxConcurrentRuns;
    if (maxConcurrentRuns === undefined) return;
    if (this.activeRuns >= maxConcurrentRuns) {
      throw new RuntimePolicyViolation({
        code: "concurrency_limit_exceeded",
        subject,
        tenantId: this.runtimeContext?.tenant?.id,
        policyPath: "runtimePolicy.rateLimit.maxConcurrentRuns",
        message: `Runtime policy concurrency limit exceeded: ${this.activeRuns}/${maxConcurrentRuns} active runs.`,
      });
    }
  }

  private estimateTurnCost(result: RuntimeTurnResult): number {
    return estimateCost(
      result.model,
      result.usage.inputTokens,
      result.usage.outputTokens,
      this.providerType,
    ).totalCost;
  }
}

function countUserTurns(session: RuntimeSession): number {
  return session.messages.filter((message) => message.role === "user").length;
}

export async function createAgentRuntime(options: AgentRuntimeOptions): Promise<AgentRuntime> {
  const runtime = new AgentRuntime(options);
  await runtime.initialize();
  return runtime;
}
