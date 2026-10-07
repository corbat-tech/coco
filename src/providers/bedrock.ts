import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type ContentBlock,
  type ConverseCommandInput,
  type ConverseResponse,
} from "@aws-sdk/client-bedrock-runtime";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type {
  LLMProvider,
  ProviderConfig,
  Message,
  ChatOptions,
  ChatResponse,
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  StreamChunk,
  ToolCall,
} from "./types.js";
import { getCatalogContextWindow, getCatalogDefaultModel } from "./catalog.js";
import { mapToAnthropic } from "./thinking.js";
import { catalogEffort } from "./contracts.js";
import { parseToolCallArguments, validateToolCallInput } from "./tool-call-normalizer.js";
import { ResponseIntegrityError } from "./response-integrity.js";
import { ProviderError } from "../utils/errors.js";
import { createRequestScope } from "../utils/request-scope.js";

function encodeReasoningBlock(block: ContentBlock): Record<string, unknown> {
  const redacted = block.reasoningContent?.redactedContent;
  return redacted
    ? { reasoningContent: { redactedContent: Buffer.from(redacted).toString("base64") } }
    : (block as unknown as Record<string, unknown>);
}
function decodeReasoningBlock(block: Record<string, unknown>): ContentBlock {
  const reasoning = block.reasoningContent as { redactedContent?: unknown } | undefined;
  return typeof reasoning?.redactedContent === "string"
    ? { reasoningContent: { redactedContent: Buffer.from(reasoning.redactedContent, "base64") } }
    : (block as unknown as ContentBlock);
}

/** Bedrock uses signed AWS requests and the Converse content-block protocol. */
export class BedrockProvider implements LLMProvider {
  readonly id = "bedrock";
  readonly name = "Amazon Bedrock";
  private client?: BedrockRuntimeClient;
  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    const region = config.region ?? process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"];
    if (!region)
      throw new ProviderError("Set AWS_REGION for Amazon Bedrock.", { provider: this.id });
    this.config = config;
    this.client = new BedrockRuntimeClient({
      region,
      maxAttempts: 1,
      ...(config.baseUrl ? { endpoint: config.baseUrl } : {}),
      ...(config.apiKey
        ? { token: { token: config.apiKey } }
        : { credentials: fromNodeProviderChain({ profile: config.awsProfile }) }),
    });
  }

  private request(
    messages: Message[],
    options?: ChatWithToolsOptions | ChatOptions,
  ): ConverseCommandInput {
    const model = options?.model ?? this.config.model ?? getCatalogDefaultModel("bedrock");
    const converted: BedrockMessage[] = [];
    for (const message of messages) {
      if (message.role === "system") continue;
      const content: ContentBlock[] = [];
      if (typeof message.content === "string") {
        if (message.content) content.push({ text: message.content });
      } else {
        const state = message.content.find(
          (block) =>
            block.type === "tool_use" &&
            block.providerState?.provider === this.id &&
            block.providerState.model === model,
        );
        if (state?.type === "tool_use")
          for (const block of state.providerState?.bedrockBlocks ?? [])
            content.push(decodeReasoningBlock(block));
        for (const block of message.content) {
          if (block.type === "text") content.push({ text: block.text });
          if (block.type === "tool_use")
            content.push({
              toolUse: {
                toolUseId: block.id,
                name: block.name,
                input: block.input as ContentBlock.ToolUseMember["toolUse"]["input"],
              },
            });
          if (block.type === "tool_result")
            content.push({
              toolResult: {
                toolUseId: block.tool_use_id,
                content: [{ text: block.content }],
                status: block.is_error ? "error" : "success",
              },
            });
          if (block.type === "image") {
            const format = block.source.media_type.split("/")[1];
            if (!["png", "jpeg", "gif", "webp"].includes(format ?? ""))
              throw new Error("Unsupported Bedrock image format.");
            content.push({
              image: {
                format: format as "png",
                source: { bytes: Buffer.from(block.source.data, "base64") },
              },
            });
          }
        }
      }
      if (!content.length) continue;
      const previous = converted.at(-1);
      if (previous?.role === message.role) previous.content?.push(...content);
      else converted.push({ role: message.role, content });
    }
    const system = [
      ...messages
        .filter((m) => m.role === "system")
        .map((m) =>
          typeof m.content === "string"
            ? m.content
            : m.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n"),
        ),
      options?.system,
    ].filter((text): text is string => !!text);
    const toolOptions = options && "tools" in options ? options : undefined;
    const effort = catalogEffort(this.id, model, options?.thinking);
    const thinking = model.startsWith("anthropic.")
      ? mapToAnthropic(options?.thinking, model.replace("anthropic.", ""))
      : undefined;
    return {
      modelId: model,
      messages: converted,
      ...(system.length ? { system: system.map((text) => ({ text })) } : {}),
      inferenceConfig: {
        maxTokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        ...(!thinking ? { temperature: options?.temperature ?? this.config.temperature ?? 0 } : {}),
        ...(options?.stopSequences ? { stopSequences: options.stopSequences } : {}),
      },
      ...(thinking
        ? {
            additionalModelRequestFields: {
              thinking,
              ...(effort && effort !== "none" ? { output_config: { effort } } : {}),
            },
          }
        : {}),
      ...(toolOptions?.tools.length
        ? {
            toolConfig: {
              tools: toolOptions.tools.map((tool) => ({
                toolSpec: {
                  name: tool.name,
                  description: tool.description,
                  inputSchema: {
                    json: tool.input_schema as unknown as NonNullable<
                      import("@aws-sdk/client-bedrock-runtime").ToolInputSchema.JsonMember["json"]
                    >,
                  },
                },
              })),
              toolChoice:
                typeof toolOptions.toolChoice === "object"
                  ? { tool: { name: toolOptions.toolChoice.name } }
                  : toolOptions.toolChoice === "any"
                    ? { any: {} }
                    : { auto: {} },
            },
          }
        : {}),
    };
  }

  private parse(response: ConverseResponse, model: string): ChatWithToolsResponse {
    const content = response.output?.message?.content;
    if (!content || !response.stopReason)
      throw new ResponseIntegrityError("Bedrock response is incomplete.", this.id);
    const toolCalls: ToolCall[] = content
      .filter((b) => b.toolUse)
      .map((b) => {
        const tool = b.toolUse!;
        if (!tool.toolUseId || !tool.name)
          throw new ResponseIntegrityError("Bedrock tool is missing identity.", this.id);
        return {
          id: tool.toolUseId,
          name: tool.name,
          input: validateToolCallInput(tool.input, this.id),
          providerState: {
            provider: this.id,
            model,
            bedrockBlocks: content.filter((b) => b.reasoningContent).map(encodeReasoningBlock),
          },
        };
      });
    if (new Set(toolCalls.map((call) => call.id)).size !== toolCalls.length)
      throw new ResponseIntegrityError("Duplicate Bedrock tool identity.", this.id);
    this.validateFinish(response.stopReason, toolCalls.length);
    return {
      id: crypto.randomUUID(),
      model,
      content: content.map((b) => b.text ?? "").join(""),
      toolCalls,
      stopReason: toolCalls.length
        ? "tool_use"
        : response.stopReason === "max_tokens"
          ? "max_tokens"
          : "end_turn",
      usage: {
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
      },
    };
  }

  private validateFinish(reason: string, calls: number): void {
    if (
      calls ? reason !== "tool_use" : !["end_turn", "stop_sequence", "max_tokens"].includes(reason)
    )
      throw new ResponseIntegrityError(`Invalid Bedrock terminal reason: ${reason}`, this.id);
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    return this.chatWithTools(messages, { ...options, tools: [] });
  }
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    if (!this.client) throw new ProviderError("Bedrock is not initialized.", { provider: this.id });
    const scope = createRequestScope(
      options.signal,
      options.timeout ?? this.config.timeout ?? 120000,
    );
    try {
      const input = this.request(messages, options);
      const response = await this.client.send(new ConverseCommand(input), {
        abortSignal: scope.signal,
      });
      scope.signal.throwIfAborted();
      return this.parse(response, input.modelId!);
    } finally {
      scope.dispose();
    }
  }
  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    yield* this.streamWithTools(messages, { ...options, tools: [] });
  }
  async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    if (!this.client) throw new ProviderError("Bedrock is not initialized.", { provider: this.id });
    const scope = createRequestScope(
      options.signal,
      options.timeout ?? this.config.timeout ?? 120000,
    );
    try {
      const input = this.request(messages, options);
      const response = await this.client.send(new ConverseStreamCommand(input), {
        abortSignal: scope.signal,
      });
      if (!response.stream) throw new ResponseIntegrityError("Missing Bedrock stream.", this.id);
      const pending = new Map<number, { id: string; name: string; json: string }>();
      const open = new Set<number>();
      const complete: ToolCall[] = [];
      let terminal: string | undefined;
      const reasoning = new Map<
        number,
        { text: string; signature: string; redacted: Uint8Array[] }
      >();
      for await (const event of response.stream) {
        scope.signal.throwIfAborted();
        const failure =
          event.internalServerException ??
          event.modelStreamErrorException ??
          event.validationException ??
          event.throttlingException ??
          event.serviceUnavailableException;
        if (failure)
          throw new ProviderError(failure.message ?? "Bedrock stream failed.", {
            provider: this.id,
          });
        if (event.contentBlockStart) {
          const { contentBlockIndex: index, start } = event.contentBlockStart;
          if (index === undefined || open.has(index) || terminal)
            throw new ResponseIntegrityError("Invalid Bedrock block start.", this.id);
          open.add(index);
          if (start?.toolUse) {
            if (!start.toolUse.toolUseId || !start.toolUse.name)
              throw new ResponseIntegrityError("Missing tool identity.", this.id);
            pending.set(index, { id: start.toolUse.toolUseId, name: start.toolUse.name, json: "" });
          }
        }
        if (event.contentBlockDelta) {
          const { contentBlockIndex: index, delta } = event.contentBlockDelta;
          if (index === undefined || terminal)
            throw new ResponseIntegrityError("Invalid Bedrock content delta.", this.id);
          open.add(index); // Text blocks can begin directly with a delta.
          if (delta?.text) yield { type: "text", text: delta.text };
          if (delta?.toolUse) {
            const tool = pending.get(index);
            if (!tool) throw new ResponseIntegrityError("Tool delta without start.", this.id);
            tool.json += delta.toolUse.input ?? "";
          }
          if (delta?.reasoningContent) {
            const block = reasoning.get(index) ?? { text: "", signature: "", redacted: [] };
            block.text += delta.reasoningContent.text ?? "";
            block.signature += delta.reasoningContent.signature ?? "";
            if (delta.reasoningContent.redactedContent)
              block.redacted.push(delta.reasoningContent.redactedContent);
            reasoning.set(index, block);
          }
        }
        if (event.contentBlockStop) {
          const index = event.contentBlockStop.contentBlockIndex;
          if (index === undefined || !open.delete(index))
            throw new ResponseIntegrityError("Unmatched Bedrock block stop.", this.id);
          const tool = pending.get(index);
          if (tool) {
            complete.push({
              id: tool.id,
              name: tool.name,
              input: parseToolCallArguments(tool.json, this.id),
            });
            pending.delete(index);
          }
        }
        if (event.messageStop) {
          if (open.size || pending.size || terminal)
            throw new ResponseIntegrityError("Bedrock ended with incomplete blocks.", this.id);
          terminal = event.messageStop.stopReason;
          if (!terminal)
            throw new ResponseIntegrityError("Missing Bedrock terminal reason.", this.id);
          this.validateFinish(terminal, complete.length);
        }
      }
      scope.signal.throwIfAborted();
      if (!terminal)
        throw new ResponseIntegrityError("Bedrock stream ended without messageStop.", this.id);
      const ids = new Set<string>();
      for (const toolCall of complete) {
        if (ids.has(toolCall.id))
          throw new ResponseIntegrityError("Duplicate Bedrock tool identity.", this.id);
        ids.add(toolCall.id);
      }
      for (const toolCall of complete) {
        const blocks: ContentBlock[] = [];
        for (const block of reasoning.values()) {
          if (block.redacted.length)
            blocks.push({ reasoningContent: { redactedContent: Buffer.concat(block.redacted) } });
          else if (block.text && block.signature)
            blocks.push({
              reasoningContent: { reasoningText: { text: block.text, signature: block.signature } },
            });
        }
        if (blocks.length)
          toolCall.providerState = {
            provider: this.id,
            model: input.modelId!,
            bedrockBlocks: blocks.map(encodeReasoningBlock),
          };
        yield { type: "tool_use_end", toolCall };
      }
      yield {
        type: "done",
        stopReason: complete.length
          ? "tool_use"
          : terminal === "max_tokens"
            ? "max_tokens"
            : "end_turn",
      };
    } finally {
      scope.dispose();
    }
  }
  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
  getContextWindow(): number {
    return getCatalogContextWindow("bedrock", this.config.model, 200000);
  }
  async isAvailable(options?: { signal?: AbortSignal }): Promise<boolean> {
    try {
      await this.chat([{ role: "user", content: "Reply OK." }], {
        maxTokens: 64,
        signal: options?.signal,
      });
      return true;
    } catch {
      options?.signal?.throwIfAborted();
      return false;
    }
  }
}
