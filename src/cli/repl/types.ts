/**
 * REPL types for Corbat-Coco
 */

import type { Message, ToolCall, StreamChunk } from "../../providers/types.js";

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
}

/**
 * REPL configuration
 */
export interface ReplConfig {
  provider: {
    type: "anthropic" | "openai" | "gemini" | "kimi";
    model: string;
    maxTokens: number;
  };
  ui: {
    theme: "dark" | "light" | "auto";
    showTimestamps: boolean;
    maxHistorySize: number;
  };
  agent: {
    systemPrompt: string;
    maxToolIterations: number;
    confirmDestructive: boolean;
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
  aborted: boolean;
  /** Partial content preserved if aborted mid-stream */
  partialContent?: string;
  /** Reason for abort if applicable */
  abortReason?: "user_cancel" | "timeout" | "error";
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
