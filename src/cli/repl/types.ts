/**
 * REPL types for Corbat-Coco
 */

import type { Message, ToolCall, StreamChunk } from "../../providers/types.js";
import type { ProviderType } from "../../providers/index.js";
import type { ThinkingMode } from "../../providers/thinking.js";
import type { ContextManager } from "./context/manager.js";
import type { ProgressTracker } from "./progress/tracker.js";
import type { MemoryContext } from "./memory/types.js";
import type { ProjectStackContext } from "./context/stack-detector.js";
import type { UnifiedSkillRegistry } from "../../skills/registry.js";

/**
 * REPL session state
 */
export interface ReplSession {
  id: string;
  startedAt: Date;
  messages: Message[];
  projectPath: string;
  config: ReplConfig;
  /** Tools trusted for this session (skip confirmation) */
  trustedTools: Set<string>;
  /** Context window manager for tracking token usage */
  contextManager?: ContextManager;
  /** Progress tracker for todo-like task tracking */
  progressTracker?: ProgressTracker;
  /** Memory context from COCO.md/CLAUDE.md files */
  memoryContext?: MemoryContext;
  /** Project stack context (detected at startup) */
  projectContext?: ProjectStackContext;
  /** Unified skill registry (markdown + native skills) */
  skillRegistry?: UnifiedSkillRegistry;
  /** Last arguments passed to a skill (for $ARGUMENTS substitution) */
  lastSkillArguments?: string;
  /** Plan mode: restricts agent to read-only tools for planning */
  planMode?: boolean;
  /** Pending plan text awaiting user approval */
  pendingPlan?: string | null;
}

/**
 * REPL configuration
 */
export interface ReplConfig {
  provider: {
    type: ProviderType;
    model: string;
    maxTokens: number;
    project?: string;
    location?: string;
    /** Active thinking/reasoning mode (undefined = not supported or use model default) */
    thinking?: ThinkingMode;
  };
  ui: {
    theme: "dark" | "light" | "auto";
    showTimestamps: boolean;
    maxHistorySize: number;
    /** When to show diff after file modifications */
    showDiff: "never" | "on_request" | "on_complete" | "always";
  };
  agent: {
    systemPrompt: string;
    maxToolIterations: number;
    confirmDestructive: boolean;
    /** If true, Coco may switch provider automatically after repeated provider failures */
    enableAutoSwitchProvider?: boolean;
    /** Enables bounded stream/provider recovery retries inside the agent loop */
    recoveryV2?: boolean;
    /** Enforces stricter read-only guarantees while plan mode is active */
    planModeStrict?: boolean;
    /** Enables the expanded read-only doctor diagnostics command */
    doctorV2?: boolean;
    /** Enables output offload instrumentation without changing context behavior */
    outputOffload?: boolean;
  };
}

/**
 * Agent turn result
 */
export interface AgentTurnResult {
  content: string;
  toolCalls: ExecutedToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Heuristic quality score and execution metrics for this turn */
  quality?: AgentTurnQuality;
  aborted: boolean;
  /** Partial content preserved if aborted mid-stream */
  partialContent?: string;
  /** Reason for abort if applicable */
  abortReason?: "user_cancel" | "timeout" | "error";
  /** Error message if the turn failed */
  error?: string;
}

export interface AgentTurnQuality {
  score: number;
  iterationsUsed: number;
  maxIterations: number;
  executedToolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  hadError: boolean;
  repeatedOutputsSuppressed: number;
  observedLargeOutputs?: number;
  observedLargeOutputChars?: number;
}

/**
 * Executed tool call with result
 */
export interface ExecutedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: ToolCallResult;
  duration: number;
}

/**
 * Tool call result
 */
export interface ToolCallResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Slash command definition
 */
export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  execute: (args: string[], session: ReplSession) => Promise<boolean>;
}

/**
 * REPL events
 */
export interface ReplEvents {
  "turn:start": () => void;
  "turn:stream": (chunk: StreamChunk) => void;
  "turn:tool_start": (toolCall: ToolCall) => void;
  "turn:tool_end": (result: ExecutedToolCall) => void;
  "turn:end": (result: AgentTurnResult) => void;
  error: (error: Error) => void;
}
