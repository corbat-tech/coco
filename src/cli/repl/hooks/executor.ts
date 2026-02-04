/**
 * Hook Executor for Corbat-Coco
 *
 * This module provides the HookExecutor class which is responsible for executing
 * hooks when events occur. It supports both command hooks (executed via shell)
 * and prompt hooks (evaluated by LLM - simplified for now).
 */

import { execa, type Options as ExecaOptions } from "execa";
import type {
  HookDefinition,
  HookEvent,
  HookContext,
  HookResult,
  HookAction,
} from "./types.js";

/**
 * Options for configuring the HookExecutor
 */
export interface HookExecutorOptions {
  /** Default timeout in milliseconds for hook execution. @default 30000 */
  defaultTimeout?: number;
  /** Shell to use for command execution. @default '/bin/bash' on Unix, 'cmd.exe' on Windows */
  shell?: string;
  /** Working directory for hook execution. @default process.cwd() */
  cwd?: string;
}

/**
 * Result of executing all hooks for a single event
 */
export interface HookExecutionResult {
  /** The event that triggered the hooks */
  event: HookEvent;
  /** Results from each individual hook execution */
  results: HookResult[];
  /** Whether all hooks succeeded */
  allSucceeded: boolean;
  /** Whether to continue with the tool/action (false if any hook denied) */
  shouldContinue: boolean;
  /** Modified input if any hook modified it (for PreToolUse) */
  modifiedInput?: Record<string, unknown>;
  /** Total duration of all hook executions in milliseconds */
  duration: number;
}

/**
 * Interface for a hook registry that the executor can query
 */
export interface HookRegistryInterface {
  /** Get all hooks for a specific event */
  getHooksForEvent(event: HookEvent): HookDefinition[];
  /** Check if any hooks are registered for an event */
  hasHooksForEvent(event: HookEvent): boolean;
}

/**
 * Default timeout for hooks (30 seconds)
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Maximum output size for command hooks (64KB)
 */
const MAX_OUTPUT_SIZE = 64 * 1024;

/**
 * HookExecutor class for executing hooks when events occur.
 *
 * Supports both command hooks (executed via shell) and prompt hooks
 * (evaluated by LLM). Handles timeouts, error collection, and result aggregation.
 *
 * @example
 * ```typescript
 * const executor = new HookExecutor({ defaultTimeout: 10000 });
 *
 * const result = await executor.executeHooks(registry, {
 *   event: 'PreToolUse',
 *   toolName: 'Bash',
 *   toolInput: { command: 'ls -la' },
 *   sessionId: 'session-123',
 *   projectPath: '/path/to/project',
 *   timestamp: new Date(),
 * });
 *
 * if (!result.shouldContinue) {
 *   console.log('Hook blocked the operation');
 * }
 * ```
 */
export class HookExecutor {
  private readonly defaultTimeout: number;
  private readonly shell: string;
  private readonly cwd: string;

  /**
   * Create a new HookExecutor
   *
   * @param options - Configuration options for the executor
   */
  constructor(options?: HookExecutorOptions) {
    this.defaultTimeout = options?.defaultTimeout ?? DEFAULT_TIMEOUT_MS;
    this.shell =
      options?.shell ??
      (process.platform === "win32" ? "cmd.exe" : "/bin/bash");
    this.cwd = options?.cwd ?? process.cwd();
  }

  /**
   * Execute all hooks for an event from the registry
   *
   * @description Retrieves hooks from the registry that match the event and context,
   * executes them in order, and aggregates the results. Execution stops early if
   * a hook denies the operation (for PreToolUse events).
   *
   * @param registry - The hook registry to query for hooks
   * @param context - The execution context with event details
   * @returns Aggregated results from all hook executions
   *
   * @example
   * ```typescript
   * const result = await executor.executeHooks(registry, context);
   * console.log(`Executed ${result.results.length} hooks in ${result.duration}ms`);
   * ```
   */
  async executeHooks(
    registry: HookRegistryInterface,
    context: HookContext
  ): Promise<HookExecutionResult> {
    const startTime = performance.now();
    const hooks = registry.getHooksForEvent(context.event);

    // Filter hooks by matcher if applicable
    const matchingHooks = hooks.filter((hook) =>
      this.matchesContext(hook, context)
    );

    // Filter out disabled hooks
    const enabledHooks = matchingHooks.filter(
      (hook) => hook.enabled !== false
    );

    if (enabledHooks.length === 0) {
      return {
        event: context.event,
        results: [],
        allSucceeded: true,
        shouldContinue: true,
        duration: performance.now() - startTime,
      };
    }

    const results: HookResult[] = [];
    let shouldContinue = true;
    let modifiedInput: Record<string, unknown> | undefined;
    let allSucceeded = true;

    for (const hook of enabledHooks) {
      // Stop if a previous hook denied the operation
      if (!shouldContinue) {
        break;
      }

      let result: HookResult;

      try {
        if (hook.type === "command") {
          result = await this.executeCommandHook(hook, context);
        } else {
          result = await this.executePromptHook(hook, context);
        }
      } catch (error) {
        result = {
          hookId: hook.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: 0,
        };
      }

      results.push(result);

      if (!result.success) {
        allSucceeded = false;
        // Stop execution if hook failed and continueOnError is not true
        if (!hook.continueOnError) {
          shouldContinue = false;
        }
      }

      // Handle action from prompt hooks
      if (result.action === "deny") {
        shouldContinue = false;
      } else if (result.action === "modify" && result.modifiedInput) {
        modifiedInput = result.modifiedInput;
      }

      // For command hooks, non-zero exit code might indicate denial
      // (convention: exit code 1 = deny, exit code 2 = error)
      if (
        hook.type === "command" &&
        result.exitCode === 1 &&
        context.event === "PreToolUse"
      ) {
        shouldContinue = false;
      }
    }

    return {
      event: context.event,
      results,
      allSucceeded,
      shouldContinue,
      modifiedInput,
      duration: performance.now() - startTime,
    };
  }

  /**
   * Execute a single command hook via shell
   *
   * @description Runs the hook's command in a shell subprocess with environment
   * variables set based on the hook context. Handles timeouts and captures
   * stdout/stderr.
   *
   * @param hook - The hook definition containing the command to execute
   * @param context - The execution context
   * @returns Result of the command execution
   */
  private async executeCommandHook(
    hook: HookDefinition,
    context: HookContext
  ): Promise<HookResult> {
    const startTime = performance.now();

    if (!hook.command) {
      return {
        hookId: hook.id,
        success: false,
        error: "Command hook has no command defined",
        duration: performance.now() - startTime,
      };
    }

    const timeoutMs = hook.timeout ?? this.defaultTimeout;
    const env = this.buildEnvironment(context);

    try {
      const options: ExecaOptions = {
        cwd: this.cwd,
        timeout: timeoutMs,
        env: { ...process.env, ...env },
        shell: this.shell,
        reject: false,
        maxBuffer: MAX_OUTPUT_SIZE,
      };

      const result = await execa(hook.command, options);

      const stdout =
        typeof result.stdout === "string"
          ? result.stdout
          : String(result.stdout ?? "");
      const stderr =
        typeof result.stderr === "string"
          ? result.stderr
          : String(result.stderr ?? "");

      const exitCode = result.exitCode ?? 0;
      const success = exitCode === 0;

      // Combine stdout and stderr for output
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();

      return {
        hookId: hook.id,
        success,
        output: output || undefined,
        error: !success && stderr ? stderr : undefined,
        duration: performance.now() - startTime,
        exitCode,
      };
    } catch (error) {
      // Handle timeout specifically
      if ((error as { timedOut?: boolean }).timedOut) {
        return {
          hookId: hook.id,
          success: false,
          error: `Hook timed out after ${timeoutMs}ms`,
          duration: performance.now() - startTime,
        };
      }

      return {
        hookId: hook.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: performance.now() - startTime,
      };
    }
  }

  /**
   * Execute a single prompt hook via LLM
   *
   * @description Evaluates the hook's prompt using an LLM to determine the action
   * to take. Currently simplified - returns "allow" by default. Full implementation
   * would require LLM provider integration.
   *
   * @param hook - The hook definition containing the prompt to evaluate
   * @param context - The execution context
   * @returns Result of the prompt evaluation with action
   *
   * @remarks
   * This is a simplified implementation. A full implementation would:
   * 1. Format the prompt with context variables
   * 2. Send the prompt to an LLM provider
   * 3. Parse the response for action (allow/deny/modify)
   * 4. Extract any modified input if action is "modify"
   */
  private async executePromptHook(
    hook: HookDefinition,
    context: HookContext
  ): Promise<HookResult> {
    const startTime = performance.now();

    if (!hook.prompt) {
      return {
        hookId: hook.id,
        success: false,
        error: "Prompt hook has no prompt defined",
        duration: performance.now() - startTime,
      };
    }

    // TODO: Full implementation would integrate with LLM provider
    // For now, return a placeholder implementation that logs and allows
    const formattedPrompt = this.formatPrompt(hook.prompt, context);

    // Simplified: Always allow for now
    // A real implementation would:
    // 1. Call LLM provider with formattedPrompt
    // 2. Parse response for action
    // 3. Extract modifiedInput if action is "modify"
    const action: HookAction = "allow";

    return {
      hookId: hook.id,
      success: true,
      output: `Prompt evaluated: ${formattedPrompt.slice(0, 100)}...`,
      duration: performance.now() - startTime,
      action,
    };
  }

  /**
   * Build environment variables for hook execution
   *
   * @description Creates a set of environment variables that provide context
   * to command hooks. Variables include event type, tool information, session ID,
   * and project path.
   *
   * @param context - The hook execution context
   * @returns Record of environment variable names to values
   */
  private buildEnvironment(context: HookContext): Record<string, string> {
    const env: Record<string, string> = {
      COCO_HOOK_EVENT: context.event,
      COCO_SESSION_ID: context.sessionId,
      COCO_PROJECT_PATH: context.projectPath,
      COCO_HOOK_TIMESTAMP: context.timestamp.toISOString(),
    };

    // Add tool-specific variables if present
    if (context.toolName) {
      env.COCO_TOOL_NAME = context.toolName;
    }

    if (context.toolInput) {
      try {
        env.COCO_TOOL_INPUT = JSON.stringify(context.toolInput);
      } catch {
        // If JSON serialization fails, stringify as best we can
        env.COCO_TOOL_INPUT = String(context.toolInput);
      }
    }

    if (context.toolResult) {
      try {
        env.COCO_TOOL_RESULT = JSON.stringify(context.toolResult);
      } catch {
        env.COCO_TOOL_RESULT = String(context.toolResult);
      }
    }

    // Add any metadata as individual variables
    if (context.metadata) {
      for (const [key, value] of Object.entries(context.metadata)) {
        const envKey = `COCO_META_${key.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
        try {
          env[envKey] =
            typeof value === "string" ? value : JSON.stringify(value);
        } catch {
          env[envKey] = String(value);
        }
      }
    }

    return env;
  }

  /**
   * Check if a hook matches the given context
   *
   * @description Evaluates whether a hook should be executed based on its
   * matcher pattern and the context's tool name. Supports glob-like patterns.
   *
   * @param hook - The hook definition to check
   * @param context - The execution context
   * @returns true if the hook should be executed
   */
  private matchesContext(hook: HookDefinition, context: HookContext): boolean {
    // If no matcher specified, match all
    if (!hook.matcher) {
      return true;
    }

    // Matcher only applies to tool events
    if (!context.toolName) {
      return true;
    }

    return this.matchPattern(hook.matcher, context.toolName);
  }

  /**
   * Match a glob-like pattern against a string
   *
   * @description Supports simple glob patterns:
   * - "*" matches any sequence of characters
   * - "?" matches any single character
   * - Exact match otherwise
   *
   * @param pattern - The pattern to match
   * @param value - The value to match against
   * @returns true if the value matches the pattern
   */
  private matchPattern(pattern: string, value: string): boolean {
    // Handle exact match
    if (!pattern.includes("*") && !pattern.includes("?")) {
      return pattern === value;
    }

    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
      .replace(/\*/g, ".*") // * matches anything
      .replace(/\?/g, "."); // ? matches single char

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(value);
  }

  /**
   * Format a prompt template with context values
   *
   * @description Replaces template variables in the prompt with values from
   * the context. Variables are in the format {{variableName}}.
   *
   * Supported variables:
   * - {{event}} - The hook event type
   * - {{toolName}} - Name of the tool (if applicable)
   * - {{toolInput}} - JSON string of tool input
   * - {{toolResult}} - JSON string of tool result
   * - {{sessionId}} - Session ID
   * - {{projectPath}} - Project path
   *
   * @param prompt - The prompt template
   * @param context - The execution context
   * @returns Formatted prompt with variables replaced
   */
  private formatPrompt(prompt: string, context: HookContext): string {
    let formatted = prompt;

    // Replace template variables
    formatted = formatted.replace(/\{\{event\}\}/g, context.event);
    formatted = formatted.replace(
      /\{\{toolName\}\}/g,
      context.toolName ?? "N/A"
    );
    formatted = formatted.replace(/\{\{sessionId\}\}/g, context.sessionId);
    formatted = formatted.replace(/\{\{projectPath\}\}/g, context.projectPath);

    if (context.toolInput) {
      try {
        formatted = formatted.replace(
          /\{\{toolInput\}\}/g,
          JSON.stringify(context.toolInput, null, 2)
        );
      } catch {
        formatted = formatted.replace(
          /\{\{toolInput\}\}/g,
          String(context.toolInput)
        );
      }
    } else {
      formatted = formatted.replace(/\{\{toolInput\}\}/g, "N/A");
    }

    if (context.toolResult) {
      try {
        formatted = formatted.replace(
          /\{\{toolResult\}\}/g,
          JSON.stringify(context.toolResult, null, 2)
        );
      } catch {
        formatted = formatted.replace(
          /\{\{toolResult\}\}/g,
          String(context.toolResult)
        );
      }
    } else {
      formatted = formatted.replace(/\{\{toolResult\}\}/g, "N/A");
    }

    return formatted;
  }
}

/**
 * Create a new HookExecutor instance
 *
 * @description Factory function for creating a HookExecutor with optional configuration.
 *
 * @param options - Configuration options
 * @returns New HookExecutor instance
 *
 * @example
 * ```typescript
 * const executor = createHookExecutor({ defaultTimeout: 5000 });
 * ```
 */
export function createHookExecutor(
  options?: HookExecutorOptions
): HookExecutor {
  return new HookExecutor(options);
}
