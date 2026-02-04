/**
 * Parallel Tool Executor for Corbat-Coco
 * Executes multiple tool calls concurrently with configurable concurrency
 */

import type { ToolCall } from "../../providers/types.js";
import type { ToolRegistry, ToolResult } from "../../tools/registry.js";
import type { ExecutedToolCall } from "./types.js";
import type {
  HookRegistryInterface,
  HookExecutor,
  HookContext,
  HookExecutionResult,
} from "./hooks/index.js";

/**
 * Options for parallel tool execution
 */
export interface ParallelExecutorOptions {
  /** Maximum concurrent tool executions (default: 5) */
  maxConcurrency?: number;
  /** Callback when a tool starts executing */
  onToolStart?: (toolCall: ToolCall, index: number, total: number) => void;
  /** Callback when a tool finishes executing */
  onToolEnd?: (result: ExecutedToolCall) => void;
  /** Callback when a tool is skipped */
  onToolSkipped?: (toolCall: ToolCall, reason: string) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Hook registry for lifecycle hooks */
  hookRegistry?: HookRegistryInterface;
  /** Hook executor for running hooks */
  hookExecutor?: HookExecutor;
  /** Session ID for hook context */
  sessionId?: string;
  /** Project path for hook context */
  projectPath?: string;
  /** Callback when a hook executes */
  onHookExecuted?: (event: string, result: HookExecutionResult) => void;
}

/**
 * Result of parallel execution including skipped tools
 */
export interface ParallelExecutionResult {
  /** Successfully executed tool calls (in order) */
  executed: ExecutedToolCall[];
  /** Tool calls that were skipped (e.g., due to abort) */
  skipped: Array<{ toolCall: ToolCall; reason: string }>;
  /** Whether execution was aborted */
  aborted: boolean;
}

/**
 * Internal type to track execution state
 */
interface ExecutionTask {
  toolCall: ToolCall;
  index: number;
  promise?: Promise<ExecutedToolCall | null>;
  result?: ExecutedToolCall | null;
  completed: boolean;
}

/**
 * Parallel Tool Executor
 * Executes tool calls concurrently while respecting maxConcurrency
 */
export class ParallelToolExecutor {
  private readonly defaultMaxConcurrency = 5;

  /**
   * Execute tool calls in parallel with controlled concurrency
   *
   * Uses a semaphore-like pattern to limit concurrent executions
   * while maintaining the order of results.
   *
   * @param toolCalls - Array of tool calls to execute
   * @param registry - Tool registry for execution
   * @param options - Execution options
   * @returns Results of all executed tools
   */
  async executeParallel(
    toolCalls: ToolCall[],
    registry: ToolRegistry,
    options: ParallelExecutorOptions = {}
  ): Promise<ParallelExecutionResult> {
    const {
      maxConcurrency = this.defaultMaxConcurrency,
      onToolStart,
      onToolEnd,
      onToolSkipped,
      signal,
    } = options;

    const total = toolCalls.length;
    const executed: ExecutedToolCall[] = [];
    const skipped: Array<{ toolCall: ToolCall; reason: string }> = [];

    // Handle empty input
    if (total === 0) {
      return { executed, skipped, aborted: false };
    }

    // Check if already aborted before starting
    if (signal?.aborted) {
      for (const toolCall of toolCalls) {
        const reason = "Operation cancelled before execution";
        skipped.push({ toolCall, reason });
        onToolSkipped?.(toolCall, reason);
      }
      return { executed, skipped, aborted: true };
    }

    // Create execution tasks with 1-based index for display
    const tasks: ExecutionTask[] = toolCalls.map((toolCall, idx) => ({
      toolCall,
      index: idx + 1,
      completed: false,
    }));

    // Results array to maintain order
    const results: (ExecutedToolCall | null)[] = new Array(total).fill(null);

    // Active execution count for concurrency control
    let activeCount = 0;
    let nextTaskIndex = 0;
    let aborted = false;

    // Process all tasks
    const processingPromises: Promise<ExecutedToolCall | null>[] = [];

    const startNextTask = (): void => {
      // Check abort
      if (signal?.aborted && !aborted) {
        aborted = true;
        // Skip all remaining unstarted tasks
        for (let i = nextTaskIndex; i < tasks.length; i++) {
          const task = tasks[i];
          if (task && !task.completed && !task.promise) {
            const reason = "Operation cancelled";
            skipped.push({ toolCall: task.toolCall, reason });
            onToolSkipped?.(task.toolCall, reason);
            task.completed = true;
          }
        }
        return;
      }

      // Find next unstarted task
      while (
        nextTaskIndex < tasks.length &&
        activeCount < maxConcurrency &&
        !aborted
      ) {
        const task = tasks[nextTaskIndex];
        if (!task) {
          nextTaskIndex++;
          continue;
        }

        nextTaskIndex++;
        activeCount++;

        // Start execution
        const taskPromise = this.executeSingleTool(
          task.toolCall,
          task.index,
          total,
          registry,
          onToolStart,
          onToolEnd,
          signal
        ).then((result) => {
          task.result = result;
          task.completed = true;
          results[task.index - 1] = result;
          activeCount--;

          // Try to start another task
          startNextTask();

          return result;
        });

        task.promise = taskPromise;
        processingPromises.push(taskPromise);
      }
    };

    // Start initial batch of tasks
    startNextTask();

    // Wait for all to complete
    await Promise.all(processingPromises);

    // Collect executed results in order, filtering nulls
    for (const result of results) {
      if (result !== null) {
        executed.push(result);
      }
    }

    return {
      executed,
      skipped,
      aborted: signal?.aborted ?? false,
    };
  }

  /**
   * Execute a single tool call
   */
  private async executeSingleTool(
    toolCall: ToolCall,
    index: number,
    total: number,
    registry: ToolRegistry,
    onToolStart?: (toolCall: ToolCall, index: number, total: number) => void,
    onToolEnd?: (result: ExecutedToolCall) => void,
    signal?: AbortSignal
  ): Promise<ExecutedToolCall | null> {
    // Check for abort before starting
    if (signal?.aborted) {
      return null;
    }

    onToolStart?.(toolCall, index, total);

    const startTime = performance.now();
    const result: ToolResult = await registry.execute(
      toolCall.name,
      toolCall.input,
      { signal }
    );
    const duration = performance.now() - startTime;

    const output = result.success
      ? JSON.stringify(result.data, null, 2)
      : result.error ?? "Unknown error";

    const executedCall: ExecutedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
      result: {
        success: result.success,
        output,
        error: result.error,
      },
      duration,
    };

    onToolEnd?.(executedCall);

    return executedCall;
  }

  /**
   * Execute a single tool call with hooks
   */
  async executeSingleToolWithHooks(
    toolCall: ToolCall,
    index: number,
    total: number,
    registry: ToolRegistry,
    options: ParallelExecutorOptions
  ): Promise<{ executed: ExecutedToolCall | null; skipped: boolean; reason?: string }> {
    const {
      onToolStart,
      onToolEnd,
      signal,
      hookRegistry,
      hookExecutor,
      sessionId,
      projectPath,
      onHookExecuted,
    } = options;

    // Check for abort before starting
    if (signal?.aborted) {
      return { executed: null, skipped: true, reason: "Operation cancelled" };
    }

    // Execute PreToolUse hooks if hooks are configured
    if (hookRegistry && hookExecutor) {
      const preContext: HookContext = {
        event: "PreToolUse",
        toolName: toolCall.name,
        toolInput: toolCall.input,
        sessionId: sessionId ?? "unknown",
        projectPath: projectPath ?? process.cwd(),
        timestamp: new Date(),
      };

      const preResult = await hookExecutor.executeHooks(hookRegistry, preContext);
      onHookExecuted?.("PreToolUse", preResult);

      // Check if hooks denied the tool execution
      if (!preResult.shouldContinue) {
        return {
          executed: null,
          skipped: true,
          reason: "Blocked by PreToolUse hook",
        };
      }

      // If hooks modified the input, use the modified input
      if (preResult.modifiedInput) {
        toolCall = {
          ...toolCall,
          input: preResult.modifiedInput,
        };
      }
    }

    onToolStart?.(toolCall, index, total);

    const startTime = performance.now();
    const result: ToolResult = await registry.execute(
      toolCall.name,
      toolCall.input,
      { signal }
    );
    const duration = performance.now() - startTime;

    const output = result.success
      ? JSON.stringify(result.data, null, 2)
      : result.error ?? "Unknown error";

    const executedCall: ExecutedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
      result: {
        success: result.success,
        output,
        error: result.error,
      },
      duration,
    };

    // Execute PostToolUse hooks if hooks are configured
    if (hookRegistry && hookExecutor) {
      const postContext: HookContext = {
        event: "PostToolUse",
        toolName: toolCall.name,
        toolInput: toolCall.input,
        toolResult: {
          toolName: toolCall.name,
          success: result.success,
          output,
          error: result.error,
          duration,
        },
        sessionId: sessionId ?? "unknown",
        projectPath: projectPath ?? process.cwd(),
        timestamp: new Date(),
      };

      const postResult = await hookExecutor.executeHooks(hookRegistry, postContext);
      onHookExecuted?.("PostToolUse", postResult);
    }

    onToolEnd?.(executedCall);

    return { executed: executedCall, skipped: false };
  }
}

/**
 * Create a new parallel executor instance
 */
export function createParallelExecutor(): ParallelToolExecutor {
  return new ParallelToolExecutor();
}

/**
 * Default shared instance
 */
let defaultExecutor: ParallelToolExecutor | null = null;

/**
 * Get the default parallel executor instance
 */
export function getParallelExecutor(): ParallelToolExecutor {
  if (!defaultExecutor) {
    defaultExecutor = new ParallelToolExecutor();
  }
  return defaultExecutor;
}
