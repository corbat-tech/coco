import type {
  Message,
  MessageContent,
  ToolDefinition as ProviderToolDefinition,
  ToolResultContent,
  ToolUseContent,
} from "../providers/types.js";
import type {
  RuntimeToolExecutionResult,
  RuntimeTurnContext,
  RuntimeTurnInput,
  RuntimeTurnResult,
  RuntimeTurnRunner,
  RuntimeSession,
} from "./types.js";
import { isConversationalOnlyTurn } from "./conversational-turn.js";
import { compactContextToFit, measureContextBudget } from "./context-budget.js";
import { createContextCompactor } from "./context-compactor.js";
import { isContextOverflowError } from "../providers/context-overflow.js";
import { formatWorkLedger, readWorkLedger } from "./work-ledger.js";
import { getCatalogContextWindow } from "../providers/catalog.js";
import type { ProviderType } from "../providers/provider-types.js";

export interface ToolCallingRuntimeTurnRunnerOptions {
  maxToolIterations?: number;
}

interface RuntimeWithTools {
  getSession?(sessionId: string): RuntimeSession | undefined;
  getModel?(): string;
  executeTool(input: {
    signal?: AbortSignal;
    toolCallId?: string;
    sessionId?: string;
    mode?: RuntimeTurnContext["session"]["mode"];
    toolName: string;
    input: Record<string, unknown>;
    confirmed?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeToolExecutionResult>;
}

function runtimeWithTools(runtime: unknown): RuntimeWithTools {
  if (
    runtime &&
    typeof runtime === "object" &&
    "executeTool" in runtime &&
    typeof runtime.executeTool === "function"
  ) {
    return runtime as RuntimeWithTools;
  }
  throw new Error("ToolCallingRuntimeTurnRunner requires a runtime with executeTool().");
}

function toolResultToContent(result: RuntimeToolExecutionResult): string {
  if (!result.success) {
    return `Error: ${result.error ?? "Tool failed."}`;
  }
  if (typeof result.output === "string") return result.output;
  return JSON.stringify(result.output ?? null);
}

/**
 * Runtime turn runner that executes provider-requested tools through the
 * reusable runtime permission and event pipeline.
 */
export class ToolCallingRuntimeTurnRunner implements RuntimeTurnRunner {
  readonly supportsTools = true;
  readonly supportsTranscript = true;
  private readonly maxToolIterations: number;

  constructor(options: ToolCallingRuntimeTurnRunnerOptions = {}) {
    this.maxToolIterations = options.maxToolIterations ?? 10;
    if (!Number.isSafeInteger(this.maxToolIterations) || this.maxToolIterations < 1) {
      throw new RangeError("maxToolIterations must be a positive safe integer");
    }
  }

  async run(input: RuntimeTurnInput, context: RuntimeTurnContext): Promise<RuntimeTurnResult> {
    const runtime = runtimeWithTools(context.runtime);
    let messages: Message[] = context.transcript?.messages() ?? [
      ...context.session.messages,
      {
        role: "user",
        content: input.content,
      },
    ];
    const conversationalOnly = isConversationalOnlyTurn(input.content);
    const tools = conversationalOnly
      ? []
      : (context.toolRegistry.getToolDefinitionsForLLM() as ProviderToolDefinition[]);
    const confirmedTools = new Set(input.confirmedTools ?? []);
    let inputTokens = 0;
    let outputTokens = 0;
    const maxTokens = input.options?.maxTokens ?? 4096;

    const system = () => {
      const latest = runtime.getSession?.(context.session.id) ?? context.session;
      const ledger = formatWorkLedger(readWorkLedger(latest.metadata));
      return (
        [latest.instructions ?? input.options?.system, ledger].filter(Boolean).join("\n\n") ||
        undefined
      );
    };
    const compactor = createContextCompactor();
    const budgetInput = () => ({
      messages,
      system: system(),
      tools,
      countTokens: (text: string) => context.provider.countTokens(text),
      contextWindow: getCatalogContextWindow(
        context.provider.id as ProviderType,
        input.options?.model ?? runtime.getModel?.(),
        context.provider.getContextWindow(),
      ),
      reservedOutputTokens: maxTokens,
    });
    const compact = async (force: boolean): Promise<void> => {
      if (!context.provider.countTokens || !context.provider.getContextWindow) return;
      const budget = measureContextBudget(budgetInput());
      if (!force && budget.fits) return;
      const result = await compactContextToFit({
        ...budgetInput(),
        signal: input.options?.signal,
        summarize: (history, signal) =>
          compactor.compact(history, context.provider, {
            signal,
            summaryModel: input.options?.model,
          }),
      });
      messages = result.messages;
      // Keep the durable transcript intact. Compaction changes only this request
      // view; later turns/reopens can reconstruct it from original messages.
    };

    for (let iteration = 0; iteration < this.maxToolIterations; iteration++) {
      input.options?.signal?.throwIfAborted();
      await compact(false);
      const request = () =>
        context.provider.chatWithTools(messages, {
          tools,
          model: input.options?.model,
          maxTokens,
          temperature: input.options?.temperature,
          stopSequences: input.options?.stopSequences,
          system: system(),
          timeout: input.options?.timeout,
          signal: input.options?.signal,
          thinking: input.options?.thinking,
        });
      let response;
      try {
        response = await request();
      } catch (error) {
        if (!isContextOverflowError(error) || input.options?.signal?.aborted) throw error;
        // The rejected request has executed no tools; retry once after a real reduction.
        await compact(true);
        response = await request();
      }

      inputTokens += response.usage.inputTokens;
      outputTokens += response.usage.outputTokens;
      if (context.transcript) {
        const usage = context.transcript.recordUsage(
          response.usage.inputTokens,
          response.usage.outputTokens,
        );
        inputTokens = usage.inputTokens;
        outputTokens = usage.outputTokens;
      }
      input.options?.signal?.throwIfAborted();
      if (response.stopReason === "max_tokens") {
        throw new Error(
          "Runtime turn incomplete: provider output was truncated (max_tokens). Changes may exist; inspect and verify before continuing.",
        );
      }
      if (
        ["end_turn", "stop_sequence"].includes(response.stopReason) &&
        response.toolCalls.length === 0
      ) {
        return {
          sessionId: context.session.id,
          content: response.content,
          usage: { inputTokens, outputTokens },
          model: response.model,
          mode: context.session.mode,
        };
      }

      if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
        throw new Error(
          "Runtime turn incomplete: inconsistent provider stop reason and tool calls. Changes may exist; inspect and verify before continuing.",
        );
      }

      const assistantContent: Array<ToolUseContent | { type: "text"; text: string }> = [];
      if (response.content.trim().length > 0) {
        assistantContent.push({ type: "text", text: response.content });
      }
      for (const toolCall of response.toolCalls) {
        assistantContent.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
          geminiThoughtSignature: toolCall.geminiThoughtSignature,
          providerState: toolCall.providerState,
        });
      }
      const assistantMessage: Message = {
        role: "assistant",
        content: assistantContent as MessageContent,
      };
      context.transcript?.appendToolBatch(assistantMessage);
      messages.push(assistantMessage);

      const toolResults: ToolResultContent[] = [];
      for (const toolCall of response.toolCalls) {
        input.options?.signal?.throwIfAborted();
        if (conversationalOnly) {
          const denied: ToolResultContent = {
            type: "tool_result",
            tool_use_id: toolCall.id,
            content:
              "This isolated conversational message requires a direct text reply, without tools.",
            is_error: true,
          };
          context.transcript?.finishTool(toolCall.id, denied.content, true);
          toolResults.push(denied);
          continue;
        }
        const confirmed =
          confirmedTools.has(toolCall.name) ||
          input.confirmToolCall?.(structuredClone(toolCall)) === true;
        context.transcript?.startTool(toolCall.id);
        const result = await runtime.executeTool({
          signal: input.options?.signal,
          toolCallId: toolCall.id,
          sessionId: context.session.id,
          mode: context.session.mode,
          toolName: toolCall.name,
          input: toolCall.input,
          confirmed,
          metadata: input.metadata,
        });
        const resultContent = toolResultToContent(result);
        context.transcript?.finishTool(toolCall.id, resultContent, !result.success);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: resultContent,
          is_error: !result.success,
        });
      }
      messages.push({
        role: "user",
        content: toolResults as MessageContent,
      });
    }

    throw new Error(
      "Runtime turn incomplete: maximum tool iteration budget reached without a terminal response. Changes may exist; inspect and verify before continuing.",
    );
  }
}

export function createToolCallingRuntimeTurnRunner(
  options?: ToolCallingRuntimeTurnRunnerOptions,
): RuntimeTurnRunner {
  return new ToolCallingRuntimeTurnRunner(options);
}
