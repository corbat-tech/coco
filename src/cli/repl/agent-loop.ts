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
import { classifyAgentLoopError } from "./error-resilience.js";
import {
  computeTurnQualityMetrics,
  RepeatedOutputSuppressor,
  type TurnQualityMetrics,
} from "./turn-quality.js";

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
  /**
   * Mid-task steering: called between iterations to check for pending user
   * messages that should be injected as context without aborting the turn.
   * Returns an array of steering messages, or empty/undefined if none.
   */
  onSteeringCheck?: () => string[];
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
  let hadTurnError = false;
  let repeatedOutputsSuppressed = 0;
  const repeatedOutputSuppressor = new RepeatedOutputSuppressor();

  const buildQualityMetrics = (): TurnQualityMetrics =>
    computeTurnQualityMetrics({
      iterationsUsed: iteration,
      maxIterations,
      executedTools,
      hadError: hadTurnError,
      repeatedOutputsSuppressed,
    });

  // Helper: abort return with rollback
  const abortReturn = (): AgentTurnResult => {
    // Rollback all session mutations from this turn
    session.messages.length = messageSnapshot;
    return {
      content: finalContent,
      toolCalls: executedTools,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      quality: buildQualityMetrics(),
      aborted: true,
      partialContent: finalContent || undefined,
      abortReason: "user_cancel",
    };
  };

  // Get tool definitions for LLM (cast to provider's ToolDefinition type)
  // In plan mode, restrict to read-only tools only
  const allTools = toolRegistry.getToolDefinitionsForLLM() as ToolDefinition[];
  const tools = session.planMode ? filterReadOnlyTools(allTools) : allTools;

  // Agentic loop - continue until no more tool calls
  let iteration = 0;
  const maxIterations = session.config.agent.maxToolIterations;

  // Repeated-error loop detection:
  // key = "toolName:errorPrefix" → consecutive failure count.
  // When the same tool fails with the same error ≥ MAX_CONSECUTIVE_TOOL_ERRORS times in a
  // row, we inject a guidance message and break so the LLM can explain the issue instead
  // of retrying indefinitely.
  const toolErrorCounts = new Map<string, number>();
  const MAX_CONSECUTIVE_TOOL_ERRORS = 3;

  /**
   * Fraction of maxIterations at which to inject a budget-warning into the LLM's
   * tool results so it starts wrapping up before hitting the hard limit.
   */
  const ITERATION_LIMIT_WARNING_RATIO = 0.75;

  /**
   * Message appended to the last tool result on the final iteration.
   * Instructs the LLM to stop calling tools and write a proper summary/handoff.
   */
  const ITERATION_LIMIT_SUMMARY_PROMPT =
    `[System: You have now used all allowed iterations and tool calls are no longer available. ` +
    `Write your final response immediately: ` +
    `(1) briefly state what was completed, ` +
    `(2) describe what still needs to be done, ` +
    `(3) give specific next steps so the user can continue. Be concise and direct.]`;

  // ---------------------------------------------------------------------------
  // Inline tool-result size cap
  // ---------------------------------------------------------------------------
  // Industry practice (Claude Code, Cursor): large tool outputs are written to
  // disk and only a pointer is kept in the context. We approximate this by
  // truncating oversized results inline — keeping the head (most relevant) and
  // a small tail (usually contains closing structure / error summary), with a
  // clear marker for the omitted middle. This prevents quadratic token growth
  // when the same large result is re-sent on every iteration of the agent loop.
  //
  // Numbers derived from production agents:
  //   Cursor: ~8K effective per result before offloading
  //   Morph/common frameworks: 5K–10K truncation threshold
  //   We use 8K total (6.5K head + 1K tail) — enough for most outputs while
  //   still cutting >80% of tokens for large tree/grep/web results.
  const INLINE_RESULT_MAX_CHARS = 8000;
  const INLINE_RESULT_HEAD_CHARS = 6500;
  const INLINE_RESULT_TAIL_CHARS = 1000;

  function truncateInlineResult(content: string, toolName: string): string {
    if (content.length <= INLINE_RESULT_MAX_CHARS) return content;
    const head = content.slice(0, INLINE_RESULT_HEAD_CHARS);
    const tail = content.slice(-INLINE_RESULT_TAIL_CHARS);
    const omitted = content.length - INLINE_RESULT_HEAD_CHARS - INLINE_RESULT_TAIL_CHARS;
    return (
      `${head}\n` +
      `[... ${omitted.toLocaleString()} characters omitted — ` +
      `use read_file with offset/limit to retrieve more of '${toolName}' output ...]\n` +
      `${tail}`
    );
  }

  while (iteration < maxIterations) {
    iteration++;

    // True when this is the last iteration the agent is allowed to run.
    // Used to give the LLM one final text-only summary turn instead of cutting off.
    const isLastIteration = iteration === maxIterations;

    // Buffer text chunks for this iteration.
    // Flushed to onStream only if the turn ends without tool calls (final response).
    // If tool calls follow, the text is intermediate reasoning — discard it to
    // keep the terminal clean.
    const iterationTextChunks: StreamChunk[] = [];

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
    let lastStopReason: StreamChunk["stopReason"];

    // Track tool call builders for streaming
    const toolCallBuilders: Map<
      string,
      { id: string; name: string; input: Record<string, unknown> }
    > = new Map();

    // Wrap streaming in try/catch to handle provider errors gracefully
    try {
      for await (const chunk of provider.streamWithTools(messages, {
        tools,
        maxTokens: session.config.provider.maxTokens,
        signal: options.signal,
      })) {
        // Check for abort
        if (options.signal?.aborted) {
          break;
        }

        // Wrap each chunk processing in try/catch to prevent single bad chunk from stopping flow
        try {
          // Handle text chunks - stream them immediately
          if (chunk.type === "text" && chunk.text) {
            // End thinking spinner on first text
            if (!thinkingEnded) {
              options.onThinkingEnd?.();
              thinkingEnded = true;
            }
            responseContent += chunk.text;
            finalContent += chunk.text;
            iterationTextChunks.push(chunk);
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
            // Capture stopReason from the done chunk
            if (chunk.stopReason) {
              lastStopReason = chunk.stopReason;
            }
            // Ensure thinking ended
            if (!thinkingEnded) {
              options.onThinkingEnd?.();
              thinkingEnded = true;
            }
            break;
          }
        } catch (chunkError) {
          // Log chunk processing error but continue with next chunk
          // This prevents a single malformed chunk from stopping the entire flow
          const errorMsg = chunkError instanceof Error ? chunkError.message : String(chunkError);
          console.error(`[agent-loop] Error processing chunk: ${errorMsg}`);
          // Continue to next chunk
        }
      }
    } catch (streamError) {
      // Ensure thinking ended on error
      if (!thinkingEnded) {
        options.onThinkingEnd?.();
        thinkingEnded = true;
      }

      const classification = classifyAgentLoopError(streamError, options.signal);
      if (classification.kind === "abort") {
        return abortReturn();
      }
      if (classification.kind === "provider_non_retryable") {
        throw classification.original;
      }
      hadTurnError = true;
      const errorMsg = classification.message;

      // Add error as assistant message so LLM can see what happened
      addMessage(session, {
        role: "assistant",
        content: `[Error during streaming: ${errorMsg}]`,
      });

      // Return partial results with error info
      return {
        content: finalContent || `[Error: ${errorMsg}]`,
        toolCalls: executedTools,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        quality: buildQualityMetrics(),
        aborted: false,
        partialContent: finalContent || undefined,
        error: errorMsg,
      };
    }

    // Flush buffered text only if this turn produced no tool calls.
    // A turn with tool calls is an intermediate reasoning step — suppress its text.
    // The final turn (no tool calls) always flushes so the user sees the reply.
    if (collectedToolCalls.length === 0) {
      for (const bufferedChunk of iterationTextChunks) {
        options.onStream?.(bufferedChunk);
      }
    }

    // Estimate token usage (streaming doesn't provide exact counts)
    // Use provider's token counting method for estimation
    const inputText = messages
      .map((m) => {
        if (typeof m.content === "string") return m.content;
        try {
          return JSON.stringify(m.content);
        } catch {
          return "";
        }
      })
      .join("\n");
    const estimatedInputTokens = provider.countTokens(inputText);
    let serializedToolCalls = "";
    try {
      serializedToolCalls = JSON.stringify(collectedToolCalls);
    } catch {
      // ignore circular references in token estimation
    }
    const estimatedOutputTokens = provider.countTokens(responseContent + serializedToolCalls);

    totalInputTokens += estimatedInputTokens;
    totalOutputTokens += estimatedOutputTokens;

    // Check if we have tool calls
    if (collectedToolCalls.length === 0) {
      // If aborted, rollback — don't save empty or partial assistant messages
      if (options.signal?.aborted) {
        return abortReturn();
      }

      // Auto-continue on max_tokens cutoff: the LLM ran out of output tokens
      // mid-response. Save the partial text and ask it to continue.
      if (lastStopReason === "max_tokens" && responseContent) {
        addMessage(session, { role: "assistant", content: responseContent });
        addMessage(session, {
          role: "user",
          content:
            "[System: Your previous response was cut off due to the output token limit. Continue exactly where you left off.]",
        });
        continue;
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
        let confirmResult: Awaited<ReturnType<typeof confirmToolExecution>>;
        try {
          confirmResult = await confirmToolExecution(toolCall);
        } catch (confirmError) {
          // Confirmation prompt failed (e.g. terminal/readline error).
          // Treat as declined so the agent loop continues without crashing.
          options.onAfterConfirmation?.();
          declinedTools.set(
            toolCall.id,
            `Confirmation failed: ${confirmError instanceof Error ? confirmError.message : String(confirmError)}`,
          );
          options.onToolSkipped?.(toolCall, "Confirmation error");
          continue;
        }
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
        // Pass hooks through so PreToolUse/PostToolUse hooks fire during execution
        hookRegistry: options.hookRegistry,
        hookExecutor: options.hookExecutor,
        sessionId: session.id,
        projectPath: session.projectPath,
        onHookExecuted: options.onHookExecuted,
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
        // Give the LLM actionable context about WHY the tool was skipped so it can
        // choose a better strategy instead of retrying the same approach.
        let skipContent: string;
        if (declineReason === "User declined") {
          skipContent =
            "The user explicitly declined this tool call. " +
            "You MUST find a different approach — do not retry the same action or parameters.";
        } else if (
          declineReason.toLowerCase().includes("timeout") ||
          declineReason.toLowerCase().includes("timed out")
        ) {
          skipContent =
            `Tool execution timed out: ${declineReason}. ` +
            "Try a simpler or faster alternative, or break the task into smaller steps.";
        } else if (declineReason.toLowerCase().includes("abort")) {
          skipContent = "Tool execution was cancelled.";
        } else {
          skipContent = `Tool execution was skipped: ${declineReason}`;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: skipContent,
          is_error: true,
        });
        continue;
      }

      // Find the executed result
      const executedCall = executedTools.find((e) => e.id === toolCall.id);
      if (executedCall) {
        const truncatedOutput = truncateInlineResult(executedCall.result.output, toolCall.name);
        const transformedOutput = repeatedOutputSuppressor.transform(toolCall.name, truncatedOutput);
        if (transformedOutput.suppressed) {
          repeatedOutputsSuppressed++;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: transformedOutput.content,
          is_error: !executedCall.result.success,
        });
      } else {
        // Safety net: every tool_use in the assistant message MUST have a
        // matching tool_result, or the API will reject the request (Error 400).
        // This can happen if a tool call was streamed but its execution was
        // dropped (e.g. ID mismatch, stream interruption). Log a warning and
        // inject a placeholder so the history stays valid.
        console.warn(
          `[AgentLoop] No result found for tool call ${toolCall.name}:${toolCall.id} — injecting error placeholder to keep history valid`,
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: "Tool execution result unavailable (internal error)",
          is_error: true,
        });
      }
    }

    // Detect repeated identical tool errors (loop protection).
    // Update consecutive failure counts; if any tool hits the threshold, augment
    // the last result so the LLM understands it must stop retrying, then break.
    let stuckInErrorLoop = false;
    for (const executedCall of executedTools) {
      if (!executedCall.result.success && executedCall.result.error) {
        // Normalise: tool name + first 120 chars of error (enough to distinguish messages)
        const errorKey = `${executedCall.name}:${executedCall.result.error.slice(0, 120).toLowerCase()}`;
        const count = (toolErrorCounts.get(errorKey) ?? 0) + 1;
        toolErrorCounts.set(errorKey, count);

        if (count >= MAX_CONSECUTIVE_TOOL_ERRORS) {
          stuckInErrorLoop = true;
          // Replace the content of this tool result with a directive that tells the LLM
          // to stop retrying and explain the problem to the user instead.
          const idx = toolResults.findIndex((r) => r.tool_use_id === executedCall.id);
          if (idx >= 0) {
            toolResults[idx] = {
              ...toolResults[idx]!,
              content: [
                executedCall.result.error,
                "",
                `⚠️ This tool has now failed ${count} consecutive times with the same error.`,
                "Do NOT retry with the same parameters.",
                "Explain to the user what is missing or wrong, and ask for clarification if needed.",
              ].join("\n"),
              is_error: true,
            };
          }
        }
      } else {
        // Successful tool call — reset its error streak
        for (const key of toolErrorCounts.keys()) {
          if (key.startsWith(`${executedCall.name}:`)) toolErrorCounts.delete(key);
        }
      }
    }

    // Inject iteration-budget feedback into the last tool result so the LLM can adapt.
    // This runs AFTER the stuckInErrorLoop detection so both messages never overlap.
    if (toolResults.length > 0) {
      const warningThreshold = Math.ceil(maxIterations * ITERATION_LIMIT_WARNING_RATIO);
      const lastIdx = toolResults.length - 1;
      const last = toolResults[lastIdx]!;

      if (isLastIteration && !stuckInErrorLoop) {
        // Final iteration: ask for a proper summary handoff
        toolResults[lastIdx] = {
          ...last,
          content:
            typeof last.content === "string"
              ? last.content + `\n\n${ITERATION_LIMIT_SUMMARY_PROMPT}`
              : ITERATION_LIMIT_SUMMARY_PROMPT,
        };
      } else if (iteration === warningThreshold) {
        // 75% of budget used: nudge to start wrapping up
        const remaining = maxIterations - iteration;
        const warning =
          `\n\n[System: Iteration budget warning — ${iteration} of ${maxIterations} iterations used, ` +
          `${remaining} remaining. Begin wrapping up your task. Prioritize the most critical remaining steps.]`;
        toolResults[lastIdx] = {
          ...last,
          content: typeof last.content === "string" ? last.content + warning : warning,
        };
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

    // Mid-task steering: check for user messages injected between iterations.
    // These are incorporated as additional context without aborting the turn,
    // allowing the user to redirect the agent while it's working.
    if (options.onSteeringCheck) {
      const steeringMessages = options.onSteeringCheck();
      if (steeringMessages.length > 0) {
        const steeringContext = [
          "\n---",
          "## Mid-task steering from user:",
          ...steeringMessages.map((m, i) => `${i + 1}. ${m}`),
          "",
          "Incorporate the above feedback into your ongoing work. Adjust your approach accordingly.",
        ].join("\n");

        addMessage(session, {
          role: "user",
          content: steeringContext,
        });
      }
    }

    // Give the LLM one final text-only turn to explain the error to the user.
    // We call streamWithTools with tools=[] so the LLM can only produce text.
    if (stuckInErrorLoop) {
      try {
        const finalMessages = getConversationContext(session, toolRegistry);
        for await (const chunk of provider.streamWithTools(finalMessages, {
          tools: [],
          maxTokens: session.config.provider.maxTokens,
          signal: options.signal,
        })) {
          if (options.signal?.aborted) break;
          if (chunk.type === "text" && chunk.text) {
            finalContent += chunk.text;
            options.onStream?.(chunk);
          }
          if (chunk.type === "done") break;
        }
      } catch {
        // If the final explanation call fails, still break gracefully
      }
      break;
    }

    // Final iteration with tool calls: give the LLM one more text-only turn to
    // summarise progress and hand off to the user instead of cutting off abruptly.
    // The summary prompt was already injected into the last tool result above.
    if (isLastIteration && toolResults.length > 0) {
      let summaryThinkingEnded = false;
      options.onThinkingStart?.();
      try {
        const finalMessages = getConversationContext(session, toolRegistry);
        for await (const chunk of provider.streamWithTools(finalMessages, {
          tools: [],
          maxTokens: session.config.provider.maxTokens,
          signal: options.signal,
        })) {
          if (options.signal?.aborted) break;
          if (chunk.type === "text" && chunk.text) {
            if (!summaryThinkingEnded) {
              options.onThinkingEnd?.();
              summaryThinkingEnded = true;
            }
            finalContent += chunk.text;
            options.onStream?.(chunk);
          }
          if (chunk.type === "done") break;
        }
      } catch {
        // If the summary call fails, show a static notice so the user is never left in the dark
        const notice =
          `\n\nI have reached the maximum iteration limit (${maxIterations}). ` +
          `The task may be incomplete. Type "continue" to give me more iterations, ` +
          `or describe what you'd like me to focus on next.`;
        finalContent += notice;
        options.onStream?.({ type: "text", text: notice });
      } finally {
        if (!summaryThinkingEnded) options.onThinkingEnd?.();
      }
      break;
    }
  }

  // Signal completion
  options.onStream?.({ type: "done" });

  return {
    content: finalContent,
    toolCalls: executedTools,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    quality: buildQualityMetrics(),
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

/**
 * Read-only tool names allowed in plan mode.
 * These tools cannot modify files or execute destructive operations.
 */
const PLAN_MODE_ALLOWED_TOOLS = new Set([
  // File reading
  "glob",
  "read_file",
  "list_dir",
  "tree",
  // Search
  "grep",
  "find_in_file",
  "semantic_search",
  "codebase_map",
  // Git read-only
  "git_status",
  "git_log",
  "git_diff",
  "git_show",
  "git_branch",
  // Memory read
  "recall_memory",
  "list_memories",
  // Checkpoint read
  "list_checkpoints",
  // Agent spawning (read-only agents only)
  "spawnSimpleAgent",
  "checkAgentCapability",
]);

/**
 * Filter tool definitions to only read-only tools for plan mode.
 */
function filterReadOnlyTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.filter((tool) => PLAN_MODE_ALLOWED_TOOLS.has(tool.name));
}
