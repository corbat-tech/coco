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
import { getConversationContext, addMessage, saveTrustedTool } from "./session.js";
import {
  requiresConfirmation,
  confirmToolExecution,
  createConfirmationState,
  type ConfirmationState,
} from "./confirmation.js";

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
  signal?: AbortSignal;
  /** Skip confirmation prompts for destructive tools */
  skipConfirmation?: boolean;
}

/**
 * Execute an agent turn (potentially with multiple tool call iterations)
 */
export async function executeAgentTurn(
  session: ReplSession,
  userMessage: string,
  provider: LLMProvider,
  toolRegistry: ToolRegistry,
  options: AgentTurnOptions = {}
): Promise<AgentTurnResult> {
  // Add user message to context
  addMessage(session, { role: "user", content: userMessage });

  const executedTools: ExecutedToolCall[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalContent = "";

  // Get tool definitions for LLM (cast to provider's ToolDefinition type)
  const tools = toolRegistry.getToolDefinitionsForLLM() as ToolDefinition[];

  // Confirmation state for this turn
  const confirmState: ConfirmationState = createConfirmationState();

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

    // Call LLM with tools
    const messages = getConversationContext(session);

    // Notify thinking started
    options.onThinkingStart?.();

    const response = await provider.chatWithTools(messages, {
      tools,
      maxTokens: session.config.provider.maxTokens,
    });

    // Notify thinking ended
    options.onThinkingEnd?.();

    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;

    // Stream text content if present
    if (response.content) {
      finalContent += response.content;
      options.onStream?.({ type: "text", text: response.content });
    }

    // Check if we have tool calls
    if (!response.toolCalls || response.toolCalls.length === 0) {
      // No more tool calls, we're done
      addMessage(session, { role: "assistant", content: response.content });
      break;
    }

    // Execute each tool call
    const toolResults: ToolResultContent[] = [];
    const toolUses: ToolUseContent[] = [];
    let turnAborted = false;
    const totalTools = response.toolCalls.length;
    let toolIndex = 0;

    for (const toolCall of response.toolCalls) {
      toolIndex++;
      // Check for abort
      if (options.signal?.aborted || turnAborted) {
        break;
      }

      // Check if confirmation is needed (skip if tool is trusted for session)
      const needsConfirmation =
        !options.skipConfirmation &&
        !confirmState.allowAll &&
        !session.trustedTools.has(toolCall.name) &&
        requiresConfirmation(toolCall.name);

      if (needsConfirmation) {
        const confirmResult = await confirmToolExecution(toolCall);

        switch (confirmResult) {
          case "no":
            // Skip this tool, report as skipped
            options.onToolSkipped?.(toolCall, "User declined");
            toolUses.push({
              type: "tool_use",
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input,
            });
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: "Tool execution was declined by the user",
              is_error: true,
            });
            continue;

          case "abort":
            // Abort entire turn
            turnAborted = true;
            continue;

          case "yes_all":
            // Allow all for rest of turn
            confirmState.allowAll = true;
            break;

          case "trust_session":
            // Trust this tool for the rest of the session and persist
            session.trustedTools.add(toolCall.name);
            // Persist trust setting for future sessions (fire and forget)
            saveTrustedTool(toolCall.name, session.projectPath, false).catch(() => {});
            break;

          case "yes":
          default:
            // Just continue with this one
            break;
        }
      }

      options.onToolStart?.(toolCall, toolIndex, totalTools);

      const startTime = performance.now();
      const result = await toolRegistry.execute(toolCall.name, toolCall.input);
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

      executedTools.push(executedCall);
      options.onToolEnd?.(executedCall);

      // Build tool use content for assistant message
      toolUses.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      });

      // Build tool result for user message
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: output,
        is_error: !result.success,
      });
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
    `Completed ${successful.length} tool${successful.length !== 1 ? "s" : ""} before cancellation`
  );

  if (uniqueTools.length <= 5) {
    summary += chalk.dim(`: [${uniqueTools.join(", ")}]`);
  } else {
    summary += chalk.dim(
      `: [${uniqueTools.slice(0, 4).join(", ")}, +${uniqueTools.length - 4} more]`
    );
  }

  if (failed.length > 0) {
    summary += chalk.red(` (${failed.length} failed)`);
  }

  return summary;
}
