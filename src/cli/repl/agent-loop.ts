/**
 * Agentic loop for REPL
 * Handles tool calling iterations until task completion
 */

import chalk from "chalk";
import type {
  LLMProvider,
  ToolCall,
  StreamChunk,
  ToolResultContent,
  ToolUseContent,
  ToolDefinition,
} from "../../providers/types.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { ReplSession, AgentTurnResult, ExecutedToolCall } from "./types.js";
import {
  getConversationContext,
  addMessage,
  saveTrustedTool,
  removeTrustedTool,
  saveDeniedTool,
  removeDeniedTool,
} from "./session.js";
import { requiresConfirmation, confirmToolExecution } from "./confirmation.js";
import { getTrustPattern } from "./bash-patterns.js";
import { ParallelToolExecutor } from "./parallel-executor.js";
import {
  type HookRegistryInterface,
  type HookExecutor,
  type HookExecutionResult,
} from "./hooks/index.js";
import { resetLineBuffer, flushLineBuffer } from "./output/renderer.js";
import { promptAllowPath } from "./allow-path-prompt.js";

/**
 * Options for executing an agent turn
 */
export interface AgentTurnOptions {
  onStream?: (chunk: StreamChunk) => void;
  onToolStart?: (toolCall: ToolCall, index: number, total: number) => void;
  onToolEnd?: (result: ExecutedToolCall) => void;
  onThinkingStart?: () => void;
  onThinkingEnd?: () => void;
  onToolSkipped?: (toolCall: ToolCall, reason: string) => void;
  /** Called when a tool is being prepared (parsed from stream) */
  onToolPreparing?: (toolName: string) => void;
  /** Called before showing confirmation dialog (to clear spinners, etc.) */
  onBeforeConfirmation?: () => void;
  signal?: AbortSignal;
  /** Skip confirmation prompts for destructive tools */
  skipConfirmation?: boolean;
  /** Hook registry for lifecycle hooks */
  hookRegistry?: HookRegistryInterface;
  /** Hook executor for running hooks */
  hookExecutor?: HookExecutor;
  /** Callback when a hook executes */
  onHookExecuted?: (event: string, result: HookExecutionResult) => void;
}

/**
 * Execute an agent turn (potentially with multiple tool call iterations)
 */
export async function executeAgentTurn(
  session: ReplSession,
  userMessage: string,
  provider: LLMProvider,
  toolRegistry: ToolRegistry,
  options: AgentTurnOptions = {},
): Promise<AgentTurnResult> {
  // Reset line buffer at start of each turn
  resetLineBuffer();

  // Add user message to context
  addMessage(session, { role: "user", content: userMessage });

  const executedTools: ExecutedToolCall[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalContent = "";

  // Get tool definitions for LLM (cast to provider's ToolDefinition type)
  const tools = toolRegistry.getToolDefinitionsForLLM() as ToolDefinition[];

  // Agentic loop - continue until no more tool calls
  let iteration = 0;
  const maxIterations = session.config.agent.maxToolIterations;

  while (iteration < maxIterations) {
    iteration++;

    // Check for abort - preserve partial content
    if (options.signal?.aborted) {
      return {
        content: finalContent,
        toolCalls: executedTools,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        aborted: true,
        partialContent: finalContent || undefined,
        abortReason: "user_cancel",
      };
    }

    // Call LLM with tools using streaming
    const messages = getConversationContext(session);

    // Notify thinking started
    options.onThinkingStart?.();

    // Use streaming API for real-time text output
    let responseContent = "";
    const collectedToolCalls: ToolCall[] = [];
    let thinkingEnded = false;

    // Track tool call builders for streaming
    const toolCallBuilders: Map<
      string,
      { id: string; name: string; input: Record<string, unknown> }
    > = new Map();

    for await (const chunk of provider.streamWithTools(messages, {
      tools,
      maxTokens: session.config.provider.maxTokens,
    })) {
      // Check for abort
      if (options.signal?.aborted) {
        break;
      }

      // Handle text chunks - stream them immediately
      if (chunk.type === "text" && chunk.text) {
        // End thinking spinner on first text
        if (!thinkingEnded) {
          options.onThinkingEnd?.();
          thinkingEnded = true;
        }
        responseContent += chunk.text;
        finalContent += chunk.text;
        options.onStream?.(chunk);
      }

      // Handle tool call start
      if (chunk.type === "tool_use_start" && chunk.toolCall) {
        // Flush any buffered text before showing spinner
        flushLineBuffer();

        // End thinking spinner when tool starts (if no text came first)
        if (!thinkingEnded) {
          options.onThinkingEnd?.();
          thinkingEnded = true;
        }
        const id = chunk.toolCall.id ?? `tool_${toolCallBuilders.size}`;
        const toolName = chunk.toolCall.name ?? "";
        toolCallBuilders.set(id, {
          id,
          name: toolName,
          input: {},
        });
        // Notify that a tool is being prepared/parsed
        if (toolName) {
          options.onToolPreparing?.(toolName);
        }
      }

      // Handle tool call end - finalize the tool call
      if (chunk.type === "tool_use_end" && chunk.toolCall) {
        const id = chunk.toolCall.id ?? "";
        const builder = toolCallBuilders.get(id);
        if (builder) {
          const finalToolCall: ToolCall = {
            id: builder.id,
            name: chunk.toolCall.name ?? builder.name,
            input: chunk.toolCall.input ?? builder.input,
          };
          collectedToolCalls.push(finalToolCall);
        } else if (chunk.toolCall.id && chunk.toolCall.name) {
          // Direct tool call without builder
          collectedToolCalls.push({
            id: chunk.toolCall.id,
            name: chunk.toolCall.name,
            input: chunk.toolCall.input ?? {},
          });
        }
      }

      // Handle done
      if (chunk.type === "done") {
        // Ensure thinking ended
        if (!thinkingEnded) {
          options.onThinkingEnd?.();
          thinkingEnded = true;
        }
        break;
      }
    }

    // Estimate token usage (streaming doesn't provide exact counts)
    // Use provider's token counting method for estimation
    const inputText = messages
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");
    const estimatedInputTokens = provider.countTokens(inputText);
    const estimatedOutputTokens = provider.countTokens(
      responseContent + JSON.stringify(collectedToolCalls),
    );

    totalInputTokens += estimatedInputTokens;
    totalOutputTokens += estimatedOutputTokens;

    // Check if we have tool calls
    if (collectedToolCalls.length === 0) {
      // No more tool calls, we're done
      addMessage(session, { role: "assistant", content: responseContent });
      break;
    }

    // Use collected tool calls for execution
    const response = {
      content: responseContent,
      toolCalls: collectedToolCalls,
    };

    // Execute tool calls with parallel execution support
    const toolResults: ToolResultContent[] = [];
    const toolUses: ToolUseContent[] = [];
    let turnAborted = false;
    const totalTools = response.toolCalls.length;

    // Phase 1: Handle confirmations sequentially (user interaction required)
    // Build list of confirmed tools and declined/skipped tools
    const confirmedTools: ToolCall[] = [];
    const declinedTools: Map<string, string> = new Map(); // toolCall.id -> decline reason

    for (const toolCall of response.toolCalls) {
      // Check for abort
      if (options.signal?.aborted || turnAborted) {
        break;
      }

      // Check if confirmation is needed (skip if tool is trusted for session)
      // Uses pattern-aware trust: "bash:git:commit" instead of just "bash_exec"
      const trustPattern = getTrustPattern(toolCall.name, toolCall.input);
      const needsConfirmation =
        !options.skipConfirmation &&
        !session.trustedTools.has(trustPattern) &&
        requiresConfirmation(toolCall.name, toolCall.input);

      if (needsConfirmation) {
        // Notify UI to clear any spinners before showing confirmation
        options.onBeforeConfirmation?.();
        const confirmResult = await confirmToolExecution(toolCall);

        // Handle edit result for bash_exec
        if (typeof confirmResult === "object" && confirmResult.type === "edit") {
          // Create modified tool call with edited command
          const editedToolCall: ToolCall = {
            ...toolCall,
            input: { ...toolCall.input, command: confirmResult.newCommand },
          };
          confirmedTools.push(editedToolCall);
          continue;
        }

        switch (confirmResult) {
          case "no":
            // Mark as declined, will be reported after parallel execution
            declinedTools.set(toolCall.id, "User declined");
            options.onToolSkipped?.(toolCall, "User declined");
            continue;

          case "abort":
            // Abort entire turn
            turnAborted = true;
            continue;

          case "trust_project": {
            // Trust this tool pattern for this project (e.g., "bash:git:commit")
            const projectPattern = getTrustPattern(toolCall.name, toolCall.input);
            session.trustedTools.add(projectPattern);
            saveTrustedTool(projectPattern, session.projectPath, false).catch(() => {});
            break;
          }

          case "trust_global": {
            // Trust this tool pattern globally (e.g., "bash:git:commit")
            const globalPattern = getTrustPattern(toolCall.name, toolCall.input);
            session.trustedTools.add(globalPattern);
            saveTrustedTool(globalPattern, null, true).catch(() => {});
            break;
          }

          case "yes":
          default:
            // Just continue with this one
            break;
        }
      }

      // Tool is confirmed for execution
      confirmedTools.push(toolCall);
    }

    // Phase 2: Execute confirmed tools in parallel
    if (!turnAborted && confirmedTools.length > 0) {
      const executor = new ParallelToolExecutor();
      const parallelResult = await executor.executeParallel(confirmedTools, toolRegistry, {
        maxConcurrency: 5,
        onToolStart: (toolCall, _index, _total) => {
          // Adjust index to account for declined tools for accurate progress
          const originalIndex = response.toolCalls.findIndex((tc) => tc.id === toolCall.id) + 1;
          options.onToolStart?.(toolCall, originalIndex, totalTools);
        },
        onToolEnd: options.onToolEnd,
        onToolSkipped: options.onToolSkipped,
        signal: options.signal,
        onPathAccessDenied: async (dirPath: string) => {
          // Clear spinner before showing interactive prompt
          options.onBeforeConfirmation?.();
          return promptAllowPath(dirPath);
        },
      });

      // Collect executed tools and apply side-effects
      for (const executed of parallelResult.executed) {
        executedTools.push(executed);

        // Apply manage_permissions side-effects after successful execution
        if (executed.name === "manage_permissions" && executed.result.success) {
          const action = executed.input.action as string;
          const patterns = executed.input.patterns as string[];
          const scope = (executed.input.scope as string) || "project";

          if (Array.isArray(patterns)) {
            for (const p of patterns) {
              if (action === "allow") {
                session.trustedTools.add(p);
                if (scope === "global") {
                  saveTrustedTool(p, null, true).catch(() => {});
                } else {
                  saveTrustedTool(p, session.projectPath, false).catch(() => {});
                }
                // Remove from project deny list if previously denied
                removeDeniedTool(p, session.projectPath).catch(() => {});
              } else {
                // deny / ask
                session.trustedTools.delete(p);
                if (scope === "global") {
                  // Global deny = remove from global allow list
                  removeTrustedTool(p, session.projectPath, true).catch(() => {});
                } else {
                  // Project deny = add to project deny list (overrides global)
                  saveDeniedTool(p, session.projectPath).catch(() => {});
                }
              }
            }
          }
        }
      }

      // Handle skipped tools from parallel execution (e.g., due to abort)
      for (const { toolCall, reason } of parallelResult.skipped) {
        declinedTools.set(toolCall.id, reason);
      }

      // Check if parallel execution was aborted
      if (parallelResult.aborted) {
        turnAborted = true;
      }
    }

    // Phase 3: Build tool uses and results in original order
    for (const toolCall of response.toolCalls) {
      // Build tool use content for assistant message (always include)
      toolUses.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      });

      // Check if this tool was declined
      const declineReason = declinedTools.get(toolCall.id);
      if (declineReason) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: `Tool execution was declined: ${declineReason}`,
          is_error: true,
        });
        continue;
      }

      // Find the executed result
      const executedCall = executedTools.find((e) => e.id === toolCall.id);
      if (executedCall) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: executedCall.result.output,
          is_error: !executedCall.result.success,
        });
      }
    }

    // If turn was aborted, return early with partial content preserved
    if (turnAborted) {
      return {
        content: finalContent,
        toolCalls: executedTools,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        aborted: true,
        partialContent: finalContent || undefined,
        abortReason: "user_cancel",
      };
    }

    // Add assistant message with tool uses
    const assistantContent = response.content
      ? [{ type: "text" as const, text: response.content }, ...toolUses]
      : toolUses;

    addMessage(session, {
      role: "assistant",
      content: assistantContent,
    });

    // Add tool results as user message
    addMessage(session, {
      role: "user",
      content: toolResults,
    });
  }

  // Signal completion
  options.onStream?.({ type: "done" });

  return {
    content: finalContent,
    toolCalls: executedTools,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    aborted: false,
  };
}

/**
 * Format summary of executed tools for abort message
 */
export function formatAbortSummary(executedTools: ExecutedToolCall[]): string | null {
  if (executedTools.length === 0) return null;

  const successful = executedTools.filter((t) => t.result.success);
  const failed = executedTools.filter((t) => !t.result.success);

  const toolNames = successful.map((t) => t.name);
  const uniqueTools = [...new Set(toolNames)];

  let summary = chalk.yellow(
    `Completed ${successful.length} tool${successful.length !== 1 ? "s" : ""} before cancellation`,
  );

  if (uniqueTools.length <= 5) {
    summary += chalk.dim(`: [${uniqueTools.join(", ")}]`);
  } else {
    summary += chalk.dim(
      `: [${uniqueTools.slice(0, 4).join(", ")}, +${uniqueTools.length - 4} more]`,
    );
  }

  if (failed.length > 0) {
    summary += chalk.red(` (${failed.length} failed)`);
  }

  return summary;
}
