import type { AgentModeDefinition, AgentModeId } from "../cli/repl/modes.js";
import type { SessionStore } from "../cli/repl/sessions/storage.js";
import type { ProviderType } from "../providers/index.js";
import type { LLMProvider, ProviderConfig } from "../providers/types.js";
import type { ProviderRuntimeCapability } from "../providers/runtime-capabilities.js";
import type { ToolDefinition, ToolRegistry } from "../tools/registry.js";
import type { ThinkingMode } from "../providers/thinking.js";

export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "max";

export type RuntimeMode = AgentModeId;

export interface AgentRuntimeOptions {
  providerType: ProviderType;
  model?: string;
  providerConfig?: ProviderConfig;
  provider?: LLMProvider;
  toolRegistry?: ToolRegistry;
  sessionStore?: SessionStore;
  permissionPolicy?: PermissionPolicy;
  eventLog?: EventLog;
  eventLogPath?: string;
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
}

export interface ProviderRuntimeSelection {
  provider: ProviderType;
  model: string;
  thinking?: ThinkingMode;
}
