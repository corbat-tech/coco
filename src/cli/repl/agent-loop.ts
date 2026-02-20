/**
 * Agentic loop for REPL
 * Handles tool calling iterations until task completion
 *
 * ABORT STRATEGY (Snapshot + Rollback):
 * Session mutations are transactional. A snapshot of session.messages.length
 * is taken at the start of executeAgentTurn. If the turn is aborted for any
 * reason, session.messages is rolled back to the snapshot — guaranteeing
 * valid message alternation regardless of where the abort occurred.
 * Completed tool results are returned in AgentTurnResult.toolCalls so the
 * caller can incorporate them into context if needed (e.g., Modify flow).
 */

import chalk from "chalk";
import type {
  LLMProvider,
  ToolCall,
  StreamChunk,
  ToolResultContent,
  ToolUseContent,
  ToolDefinition,
  MessageContent,
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
  /** Called after confirmation dialog completes (to resume capture, etc.) */
  onAfterConfirmation?: () => void;
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
  userMessage: string | MessageContent,
  provider: LLMProvider,
  toolRegistry: ToolRegistry,
  options: AgentTurnOptions = {},
): Promise<AgentTurnResult> {
  // Reset line buffer at start of each turn
  resetLineBuffer();

  // --- Snapshot for transactional rollback on abort ---
  // If the turn is aborted, we roll back session.messages to this length.
  // This guarantees valid message alternation regardless of where abort occurs.
  const messageSnapshot = session.messages.length;

  // Add user message to context
  addMessage(session, { role: "user", content: userMessage });

  const executedTools: ExecutedToolCall[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalContent = "";

  // Helper: abort return with rollback
  const abortReturn = (): AgentTurnResult => {
    // Rollback all session mutations from this turn
    session.messages.length = messageSnapshot;
    return {
      content: finalContent,
      toolCalls: executedTools,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      aborted: true,
      partialContent: finalContent || undefined,
      abortReason: "user_cancel",
    };
  };

  // Get tool definitions for LLM (cast to provider's ToolDefinition type)
  const tools = toolRegistry.getToolDefinitionsForLLM() as ToolDefinition[];

  // Agentic loop - continue until no more tool calls
  let iteration = 0;
  const maxIterations = session.config.agent.maxToolIterations;

  while (iteration < maxIterations) {
    iteration++;

    // Check for abort at start of each iteration
    if (options.signal?.aborted) {
      return abortReturn();
    }

    // Call LLM with tools using streaming (pass toolRegistry for dynamic prompt)
    const messages = getConversationContext(session, toolRegistry);

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
      // If aborted, rollback — don't save empty or partial assistant messages
      if (options.signal?.aborted) {
        return abortReturn();
      }
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
        options.onAfterConfirmation?.();

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
          const result = await promptAllowPath(dirPath);
          options.onAfterConfirmation?.();
          return result;
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
              } else if (action === "deny") {
                session.trustedTools.delete(p);
                if (scope === "global") {
                  // Global deny = remove from global allow list
                  removeTrustedTool(p, session.projectPath, true).catch(() => {});
                } else {
                  // Project deny = add to project deny list (overrides global)
                  saveDeniedTool(p, session.projectPath).catch(() => {});
                }
              } else {
                // ask: untrust for this session only — do NOT write to deny list
                session.trustedTools.delete(p);
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

    // If turn was aborted (signal or user confirmation), rollback and return.
    // executedTools still contains completed work for the caller to use.
    if (turnAborted || options.signal?.aborted) {
      return abortReturn();
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

/**
 * Summarize executed tool results for context injection.
 * Used when re-sending a modified task so the LLM knows what work was already done.
 */
export function summarizeToolResults(toolCalls: ExecutedToolCall[]): string {
  if (toolCalls.length === 0) return "";

  const lines = toolCalls.map((tc) => {
    const inputSummary = Object.entries(tc.input)
      .map(([k, v]) => {
        const val = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}=${val.length > 60 ? val.slice(0, 57) + "…" : val}`;
      })
      .join(", ");

    const status = tc.result.success ? "✓" : "✗";
    const outputPreview =
      tc.result.output.length > 200 ? tc.result.output.slice(0, 197) + "…" : tc.result.output;

    return `- ${status} ${tc.name}(${inputSummary}): ${outputPreview}`;
  });

  return [
    "\n## Work completed before interruption:",
    ...lines,
    "",
    "Reuse the above results where relevant — do NOT repeat searches or work already done.",
  ].join("\n");
}
