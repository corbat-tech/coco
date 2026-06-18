import type { AgentModeDefinition, AgentModeId } from "../cli/repl/modes.js";
import type { SessionStore } from "../cli/repl/sessions/storage.js";
import type { ProviderType } from "../providers/index.js";
import type { ChatOptions, LLMProvider, Message, ProviderConfig } from "../providers/types.js";
import type { ProviderRuntimeCapability } from "../providers/runtime-capabilities.js";
import type { ToolDefinition, ToolRegistry } from "../tools/registry.js";
import type { ThinkingMode } from "../providers/thinking.js";
import type { WorkflowEngine } from "./workflow-engine.js";

export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "max";

export type RuntimeMode = AgentModeId;

export interface AgentRuntimeOptions {
  providerType: ProviderType;
  model?: string;
  providerConfig?: ProviderConfig;
  provider?: LLMProvider;
  toolRegistry?: ToolRegistry;
  sessionStore?: SessionStore;
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
}

export type RuntimeEventType =
  | "runtime.initialized"
  | "provider.attached"
  | "provider.created"
  | "provider.updated"
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.allowed"
  | "tool.blocked"
  | "tool.skipped"
  | "workflow.planned"
  | "workflow.started"
  | "workflow.completed"
  | "workflow.failed"
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
}

export interface RuntimeTurnResult {
  sessionId: string;
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  mode: RuntimeMode;
}

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
