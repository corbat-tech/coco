/**
 * Hooks System Types for Corbat-Coco
 *
 * This module defines the types for the hooks system, which allows users to
 * execute custom commands or prompts at various points during agent execution.
 * The design mirrors Claude Code's hooks system.
 */

/**
 * Hook events that can trigger hook execution.
 * These represent key lifecycle points in the agent's execution.
 */
export type HookEvent =
  /** Fired before a tool is executed. Can be used to validate, modify, or block tool calls. */
  | "PreToolUse"
  /** Fired after a tool has been executed. Can be used to log, validate, or react to tool results. */
  | "PostToolUse"
  /** Fired when the main agent completes its task. */
  | "Stop"
  /** Fired when a subagent completes its delegated task. */
  | "SubagentStop"
  /** Fired before context compaction occurs. Can be used to save state or prepare for compaction. */
  | "PreCompact"
  /** Fired when a new session starts. Can be used for initialization or setup. */
  | "SessionStart"
  /** Fired when a session ends. Can be used for cleanup or logging. */
  | "SessionEnd";

/**
 * All available hook events as an array for iteration and validation.
 */
export const HOOK_EVENTS: readonly HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "SessionStart",
  "SessionEnd",
] as const;

/**
 * The type of hook to execute.
 */
export type HookType =
  /** A shell command that will be executed in the system shell. */
  | "command"
  /** A prompt that will be evaluated by an LLM to make decisions. */
  | "prompt";

/**
 * Action that a prompt hook can return to control execution flow.
 */
export type HookAction =
  /** Allow the operation to proceed normally. */
  | "allow"
  /** Deny/block the operation from proceeding. */
  | "deny"
  /** Allow the operation but with modified input. */
  | "modify";

/**
 * Represents a tool call result that may be passed to PostToolUse hooks.
 */
export interface ToolCallResult {
  /** The name of the tool that was called. */
  toolName: string;
  /** Whether the tool execution was successful. */
  success: boolean;
  /** The output/result from the tool execution. */
  output?: unknown;
  /** Error message if the tool execution failed. */
  error?: string;
  /** Duration of the tool execution in milliseconds. */
  duration?: number;
}

/**
 * Definition of a hook that can be registered in the system.
 * Hooks are executed when their associated event is triggered.
 */
export interface HookDefinition {
  /** Unique identifier for this hook. Used for logging and result tracking. */
  id: string;

  /** The event that triggers this hook. */
  event: HookEvent;

  /** The type of hook - either a shell command or an LLM prompt. */
  type: HookType;

  /**
   * Optional glob pattern to match tool names.
   * Only applicable for PreToolUse and PostToolUse events.
   * Examples: "Bash", "Edit*", "*" (matches all tools)
   * If not specified, the hook runs for all tools on that event.
   */
  matcher?: string;

  /**
   * The shell command to execute.
   * Required when type is 'command'.
   * The command receives hook context as environment variables.
   */
  command?: string;

  /**
   * The prompt to evaluate with an LLM.
   * Required when type is 'prompt'.
   * The prompt receives hook context as template variables.
   */
  prompt?: string;

  /**
   * Maximum time in milliseconds to wait for hook execution.
   * If not specified, uses the global timeout or a default value.
   */
  timeout?: number;

  /**
   * Whether to continue execution if this hook fails.
   * @default false
   */
  continueOnError?: boolean;

  /**
   * Optional description of what this hook does.
   * Useful for documentation and debugging.
   */
  description?: string;

  /**
   * Whether this hook is currently enabled.
   * Disabled hooks are skipped during execution.
   * @default true
   */
  enabled?: boolean;
}

/**
 * Result of executing a hook.
 * Contains information about the execution outcome and any modifications.
 */
export interface HookResult {
  /** The ID of the hook that was executed. */
  hookId: string;

  /** Whether the hook executed successfully. */
  success: boolean;

  /** Output from the hook execution (stdout for commands, response for prompts). */
  output?: string;

  /** Error message if the hook failed. */
  error?: string;

  /** Duration of the hook execution in milliseconds. */
  duration: number;

  /**
   * Action determined by a prompt hook.
   * Only present for prompt hooks on PreToolUse events.
   */
  action?: HookAction;

  /**
   * Modified input for the tool call.
   * Only present when action is 'modify' for PreToolUse hooks.
   */
  modifiedInput?: Record<string, unknown>;

  /**
   * Exit code from command hooks.
   * Only present for command hooks.
   */
  exitCode?: number;
}

/**
 * Context passed to hooks during execution.
 * Contains information about the current state and triggering event.
 */
export interface HookContext {
  /** The event that triggered this hook. */
  event: HookEvent;

  /**
   * Name of the tool being called.
   * Present for PreToolUse and PostToolUse events.
   */
  toolName?: string;

  /**
   * Input parameters being passed to the tool.
   * Present for PreToolUse events.
   */
  toolInput?: Record<string, unknown>;

  /**
   * Result from the tool execution.
   * Present for PostToolUse events.
   */
  toolResult?: ToolCallResult;

  /** Unique identifier for the current session. */
  sessionId: string;

  /** Absolute path to the project directory. */
  projectPath: string;

  /** Timestamp when the hook was triggered. */
  timestamp: Date;

  /**
   * Additional metadata that may be passed to hooks.
   * Can contain event-specific information.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for the hooks system.
 * Typically loaded from a configuration file or environment.
 */
export interface HooksConfig {
  /** Array of hook definitions to register. */
  hooks: HookDefinition[];

  /**
   * Global timeout in milliseconds for all hooks.
   * Individual hooks can override this with their own timeout.
   * @default 30000 (30 seconds)
   */
  globalTimeout?: number;

  /**
   * Whether the hooks system is enabled.
   * When disabled, no hooks will be executed.
   * @default true
   */
  enabled?: boolean;

  /**
   * Whether to run hooks in parallel when multiple hooks match an event.
   * When false, hooks run sequentially in order of definition.
   * @default false
   */
  parallel?: boolean;

  /**
   * Whether to stop executing remaining hooks if one fails.
   * Only applies when parallel is false.
   * @default true
   */
  stopOnFirstError?: boolean;
}

/**
 * Interface for the hooks executor that runs hooks.
 */
export interface HooksExecutor {
  /**
   * Execute all hooks matching the given event and context.
   * @param event - The hook event to trigger
   * @param context - Context information for the hooks
   * @returns Array of results from all executed hooks
   */
  execute(event: HookEvent, context: HookContext): Promise<HookResult[]>;

  /**
   * Register a new hook definition.
   * @param hook - The hook definition to register
   */
  register(hook: HookDefinition): void;

  /**
   * Unregister a hook by its ID.
   * @param hookId - The ID of the hook to remove
   * @returns true if the hook was found and removed
   */
  unregister(hookId: string): boolean;

  /**
   * Get all registered hooks, optionally filtered by event.
   * @param event - Optional event to filter by
   */
  getHooks(event?: HookEvent): HookDefinition[];

  /**
   * Check if any hooks are registered for a given event.
   * @param event - The event to check
   */
  hasHooks(event: HookEvent): boolean;
}

/**
 * Options for creating a hook context.
 */
export interface CreateHookContextOptions {
  event: HookEvent;
  sessionId: string;
  projectPath: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: ToolCallResult;
  metadata?: Record<string, unknown>;
}

/**
 * Factory function type for creating hook contexts.
 */
export type CreateHookContext = (
  options: CreateHookContextOptions
) => HookContext;

/**
 * Type guard to check if a value is a valid HookEvent.
 */
export function isHookEvent(value: unknown): value is HookEvent {
  return (
    typeof value === "string" &&
    HOOK_EVENTS.includes(value as HookEvent)
  );
}

/**
 * Type guard to check if a value is a valid HookType.
 */
export function isHookType(value: unknown): value is HookType {
  return value === "command" || value === "prompt";
}

/**
 * Type guard to check if a value is a valid HookAction.
 */
export function isHookAction(value: unknown): value is HookAction {
  return value === "allow" || value === "deny" || value === "modify";
}
