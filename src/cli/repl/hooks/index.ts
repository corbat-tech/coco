/**
 * Hooks System for Corbat-Coco
 *
 * Provides lifecycle hooks for tool execution, similar to Claude Code's hooks system.
 * Supports PreToolUse, PostToolUse, SessionStart, SessionEnd, and other events.
 *
 * @module hooks
 */

// Types
export {
  type HookEvent,
  type HookType,
  type HookAction,
  type HookDefinition,
  type HookResult,
  type HookContext,
  type HooksConfig,
  type ToolCallResult,
  type HooksExecutor,
  type CreateHookContextOptions,
  HOOK_EVENTS,
  isHookEvent,
  isHookType,
  isHookAction,
} from "./types.js";

// Registry
export { HookRegistry, createHookRegistry } from "./registry.js";

// Executor
export {
  HookExecutor,
  createHookExecutor,
  type HookExecutorOptions,
  type HookExecutionResult,
  type HookRegistryInterface,
} from "./executor.js";
