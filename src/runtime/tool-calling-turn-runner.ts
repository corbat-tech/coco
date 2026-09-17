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
} from "./types.js";

export interface ToolCallingRuntimeTurnRunnerOptions {
  maxToolIterations?: number;
}

interface RuntimeWithTools {
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
  private readonly maxToolIterations: number;

  constructor(options: ToolCallingRuntimeTurnRunnerOptions = {}) {
    this.maxToolIterations = options.maxToolIterations ?? 10;
    if (!Number.isSafeInteger(this.maxToolIterations) || this.maxToolIterations < 1) {
      throw new RangeError("maxToolIterations must be a positive safe integer");
    }
  }

  async run(input: RuntimeTurnInput, context: RuntimeTurnContext): Promise<RuntimeTurnResult> {
    const runtime = runtimeWithTools(context.runtime);
    const messages: Message[] = [
      ...context.session.messages,
      {
        role: "user",
        content: input.content,
      },
    ];
    const tools = context.toolRegistry.getToolDefinitionsForLLM() as ProviderToolDefinition[];
    const confirmedTools = new Set(input.confirmedTools ?? []);
    let inputTokens = 0;
    let outputTokens = 0;

    for (let iteration = 0; iteration < this.maxToolIterations; iteration++) {
      input.options?.signal?.throwIfAborted();
      const response = await context.provider.chatWithTools(messages, {
        tools,
        model: input.options?.model,
        maxTokens: input.options?.maxTokens,
        temperature: input.options?.temperature,
        stopSequences: input.options?.stopSequences,
        system: context.session.instructions ?? input.options?.system,
        timeout: input.options?.timeout,
        signal: input.options?.signal,
        thinking: input.options?.thinking,
      });

      inputTokens += response.usage.inputTokens;
      outputTokens += response.usage.outputTokens;
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
        });
      }
      messages.push({
        role: "assistant",
        content: assistantContent as MessageContent,
      });

      const toolResults: ToolResultContent[] = [];
      for (const toolCall of response.toolCalls) {
        input.options?.signal?.throwIfAborted();
        const result = await runtime.executeTool({
          signal: input.options?.signal,
          toolCallId: toolCall.id,
          sessionId: context.session.id,
          mode: context.session.mode,
          toolName: toolCall.name,
          input: toolCall.input,
          confirmed: confirmedTools.has(toolCall.name),
          metadata: input.metadata,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: toolResultToContent(result),
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
