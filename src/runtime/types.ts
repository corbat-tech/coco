import type { ProviderType } from "../providers/index.js";
import type { ChatOptions, LLMProvider, Message, ProviderConfig } from "../providers/types.js";
import type { ProviderRuntimeCapability } from "../providers/runtime-capabilities.js";
import type { ToolDefinition, ToolRegistry } from "../tools/registry.js";
import type { ThinkingMode } from "../providers/thinking.js";
import type { AgentModeDefinition, AgentModeId } from "./agent-modes.js";
import type { RuntimePolicy, RuntimeRequestContext } from "./context.js";
import type { WorkflowEngine } from "./workflow-engine.js";

export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "max";

export type RuntimeMode = AgentModeId;

export interface AgentRuntimeOptions {
  providerType: ProviderType;
  model?: string;
  providerConfig?: ProviderConfig;
  provider?: LLMProvider;
  toolRegistry?: ToolRegistry;
  /** Legacy CLI session store passthrough. Runtime APIs use runtimeSessionStore. */
  sessionStore?: unknown;
  runtimeSessionStore?: RuntimeSessionStore;
  workflowEngine?: WorkflowEngine;
  permissionPolicy?: PermissionPolicy;
  eventLog?: EventLog;
  eventLogPath?: string;
  turnRunner?: RuntimeTurnRunner;
  /**
   * Publish provider/tools into Coco's legacy process-global subagent bridge.
   * CLI/headless use this for compatibility; embedders should leave it false.
   */
  publishToGlobalBridge?: boolean;
  legacyAgentBridge?: {
    setAgentProvider(provider: LLMProvider): void;
    setAgentToolRegistry(registry: ToolRegistry): void;
  };
  runtimeContext?: RuntimeRequestContext;
  runtimePolicy?: RuntimePolicy;
}

export interface AgentRuntimeSnapshot {
  provider: {
    type: ProviderType;
    model: string;
    capability: ProviderRuntimeCapability;
  };
  tools: {
    count: number;
    names: string[];
  };
  modes: AgentModeDefinition[];
  context?: RuntimeRequestContext;
  policy?: RuntimePolicy;
}

export type RuntimeEventType =
  | "runtime.initialized"
  | "provider.attached"
  | "provider.created"
  | "provider.updated"
  | "turn.started"
  | "turn.completed"
  | "turn.cancelled"
  | "turn.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.allowed"
  | "tool.blocked"
  | "tool.skipped"
  | "agent.started"
  | "agent.graph.started"
  | "agent.graph.completed"
  | "agent.graph.failed"
  | "agent.tool.called"
  | "agent.handoff.created"
  | "agent.artifact.created"
  | "agent.completed"
  | "agent.failed"
  | "guardrail.input"
  | "guardrail.output"
  | "guardrail.tool"
  | "workflow.planned"
  | "workflow.started"
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.gate.passed"
  | "workflow.gate.failed"
  | "shared_state.updated"
  | "session.created"
  | "session.updated"
  | "checkpoint.created"
  | "error";

export interface RuntimeEvent {
  id: string;
  type: RuntimeEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface EventLog {
  record(type: RuntimeEventType, data?: Record<string, unknown>): RuntimeEvent;
  list(): RuntimeEvent[];
  count(): number;
  clear(): void;
}

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  risk: "read-only" | "write" | "network" | "destructive" | "secrets-sensitive";
}

export interface PermissionPolicy {
  canExecuteTool(mode: RuntimeMode, tool: ToolDefinition): PermissionDecision;
  canExecuteToolInput?(
    mode: RuntimeMode,
    tool: ToolDefinition,
    input: Record<string, unknown>,
  ): PermissionDecision;
}

export interface ProviderRuntimeSelection {
  provider: ProviderType;
  model: string;
  thinking?: ThinkingMode;
}

export interface RuntimeSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  mode: RuntimeMode;
  messages: Message[];
  instructions?: string;
  metadata: Record<string, unknown>;
}

export interface RuntimeSessionCreateOptions {
  id?: string;
  mode?: RuntimeMode;
  instructions?: string;
  metadata?: Record<string, unknown>;
  messages?: Message[];
}

export interface RuntimeSessionStore {
  create(options?: RuntimeSessionCreateOptions): RuntimeSession;
  get(id: string): RuntimeSession | undefined;
  update(session: RuntimeSession): RuntimeSession;
  list(): RuntimeSession[];
  delete(id: string): boolean;
}

export interface RuntimeTurnInput {
  content: string;
  sessionId?: string;
  mode?: RuntimeMode;
  options?: ChatOptions;
  metadata?: Record<string, unknown>;
  /**
   * Tool names that the embedding product has explicitly confirmed for this
   * turn. Destructive tools are still blocked unless listed here.
   */
  confirmedTools?: string[];
}

export interface RuntimeTurnResult {
  sessionId: string;
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
  };
  model: string;
  mode: RuntimeMode;
}

export type RuntimeTurnStreamEvent =
  | {
      type: "text";
      sessionId: string;
      text: string;
    }
  | {
      type: "done";
      sessionId: string;
      result: RuntimeTurnResult;
    }
  | {
      type: "error";
      sessionId: string;
      error: string;
    };

export interface RuntimeTurnContext {
  runtime: unknown;
  session: RuntimeSession;
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  permissionPolicy: PermissionPolicy;
  eventLog: EventLog;
}

export interface RuntimeTurnRunner {
  run(input: RuntimeTurnInput, context: RuntimeTurnContext): Promise<RuntimeTurnResult>;
}

export interface RuntimeToolExecutionInput {
  sessionId?: string;
  mode?: RuntimeMode;
  toolName: string;
  input: Record<string, unknown>;
  confirmed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RuntimeToolExecutionResult {
  toolName: string;
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
  decision: PermissionDecision;
}
