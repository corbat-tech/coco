/**
 * OpenAI provider for Corbat-Coco
 * Also supports OpenAI-compatible APIs (Kimi/Moonshot, etc.)
 */

import OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses.js";
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
  ToolDefinition,
  MessageContent,
  ImageContent,
  ToolResultContent,
} from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { withRetry, type RetryConfig, DEFAULT_RETRY_CONFIG } from "./retry.js";
import {
  ChatToolCallAssembler,
  ResponsesToolCallAssembler,
  parseToolCallArguments,
} from "./tool-call-normalizer.js";
import { mapToOpenAIEffort, mapToKimiExtraBody } from "./thinking.js";
import type { ThinkingMode } from "./thinking.js";
import { getTierConfig } from "./model-tier.js";

/**
 * Default model - Updated February 2026
 */
const DEFAULT_MODEL = "gpt-5.3-codex";

/**
 * Context windows for models (Updated March 2026)
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI models
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4": 8192,
  "gpt-3.5-turbo": 16385,
  o1: 200000,
  "o1-mini": 128000,
  o3: 200000,
  "o3-mini": 200000,
  "o4-mini": 200000,
  // GPT-4.1 series (Feb 2026)
  "gpt-4.1": 1048576,
  "gpt-4.1-mini": 1048576,
  "gpt-4.1-nano": 1048576,
  // GPT-5 series (2025-2026)
  "gpt-5": 400000,
  "gpt-5.2": 400000,
  "gpt-5.2-codex": 400000,
  "gpt-5.2-thinking": 400000,
  "gpt-5.2-instant": 400000,
  "gpt-5.2-pro": 400000,
  "gpt-5.3-codex": 400000,
  "gpt-5.4-codex": 400000,
  // Kimi/Moonshot models
  "kimi-k2.5": 262144,
  "kimi-k2-0324": 131072,
  "kimi-latest": 131072,
  "moonshot-v1-8k": 8000,
  "moonshot-v1-32k": 32000,
  "moonshot-v1-128k": 128000,
  // LM Studio / Local models (Qwen3-Coder series)
  "qwen3-coder-3b-instruct": 256000,
  "qwen3-coder-8b-instruct": 256000,
  "qwen3-coder-14b-instruct": 256000,
  "qwen3-coder-32b-instruct": 256000,
  // DeepSeek Coder models
  "deepseek-coder-v3": 128000,
  "deepseek-coder-v3-lite": 128000,
  "deepseek-coder-v2": 128000,
  "deepseek-coder": 128000,
  // Codestral (Mistral)
  "codestral-22b": 32768,
  codestral: 32768,
  // Qwen 2.5 Coder (legacy but still popular)
  "qwen2.5-coder-7b-instruct": 32768,
  "qwen2.5-coder-14b-instruct": 32768,
  "qwen2.5-coder-32b-instruct": 32768,
  // Llama 3 Code models
  "llama-3-8b": 8192,
  "llama-3-70b": 8192,
  "llama-3.1-8b": 128000,
  "llama-3.1-70b": 128000,
  "llama-3.2-3b": 128000,
  // Mistral models
  "mistral-7b": 32768,
  "mistral-nemo": 128000,
  "mixtral-8x7b": 32768,
  // Mistral AI API models
  "codestral-latest": 32768,
  "mistral-large-latest": 131072,
  "mistral-small-latest": 131072,
  "open-mixtral-8x22b": 65536,
  // Groq-hosted models (same models, fast inference)
  "llama-3.3-70b-versatile": 128000,
  "llama-3.1-8b-instant": 128000,
  "mixtral-8x7b-32768": 32768,
  "gemma2-9b-it": 8192,
  // DeepSeek API models
  "deepseek-chat": 65536,
  "deepseek-reasoner": 65536,
  // Together AI model IDs
  "Qwen/Qwen2.5-Coder-32B-Instruct": 32768,
  "meta-llama/Meta-Llama-3.1-70B-Instruct": 128000,
  "mistralai/Mixtral-8x7B-Instruct-v0.1": 32768,
  // HuggingFace model IDs
  "meta-llama/Llama-3.3-70B-Instruct": 128000,
  "microsoft/Phi-4": 16384,
  // OpenRouter model IDs
  "anthropic/claude-opus-4-6": 200000,
  "openai/gpt-5.4-codex": 400000,
  "google/gemini-3-flash-preview": 1000000,
  "meta-llama/llama-3.3-70b-instruct": 128000,
};

/**
 * Models that don't support temperature parameter or only support temperature=1
 */
const MODELS_WITHOUT_TEMPERATURE: string[] = [
  "o1",
  "o1-mini",
  "o1-preview",
  "o3",
  "o3-mini",
  "o4-mini",
  "gpt-5",
  "codex",
  "kimi-k2.5",
  "kimi-k2-0324",
  "kimi-latest",
];

/**
 * Local model patterns - these use different tokenizers
 * Used for more accurate token counting
 */
const LOCAL_MODEL_PATTERNS: string[] = [
  "qwen",
  "deepseek",
  "codestral",
  "llama",
  "mistral",
  "mixtral",
  "phi",
  "gemma",
  "starcoder",
];

/**
 * Models that have "thinking" mode enabled by default and need it disabled for tool use
 * Kimi K2.5 has interleaved reasoning that requires reasoning_content to be passed back
 * Disabling thinking mode avoids this complexity with tool calling
 */
// Kimi model list kept for import-free reference; capability registry in thinking.ts is the SoT
const MODELS_WITH_THINKING_MODE: string[] = ["kimi-k2.5", "kimi-k2-0324", "kimi-latest"];

/**
 * Check if a model requires the Responses API (/responses) instead of
 * Chat Completions (/chat/completions).
 *
 * GPT-5+, Codex, o3, and o4 models only support the Responses API.
 */
export function needsResponsesApi(model: string): boolean {
  return (
    model.includes("codex") ||
    model.startsWith("gpt-5") ||
    model.startsWith("o4-") ||
    model === "o3"
  );
}

/**
 * Check if a model requires `max_completion_tokens` instead of `max_tokens`
 * in the Chat Completions API.
 *
 * OpenAI's newer models (o1, o1-mini, o1-preview, gpt-4o, etc.) deprecated
 * `max_tokens` in favor of `max_completion_tokens`. Sending `max_tokens`
 * to these models causes a 400 error.
 */
function needsMaxCompletionTokens(model: string): boolean {
  return (
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4") ||
    model.startsWith("gpt-4o") ||
    model.startsWith("gpt-4.1") ||
    model.startsWith("gpt-5") ||
    model.startsWith("chatgpt-4o")
  );
}

/**
 * Build the appropriate max tokens parameter for Chat Completions API.
 * Returns `{ max_completion_tokens }` or `{ max_tokens }` depending on model.
 *
 * PRECONDITION: must only be called for models that do NOT require the
 * Responses API (i.e. needsResponsesApi(model) === false). Callers must
 * guard with needsResponsesApi() first.
 */
function buildMaxTokensParam(model: string, maxTokens: number): Record<string, number> {
  if (needsMaxCompletionTokens(model)) {
    return { max_completion_tokens: maxTokens };
  }
  return { max_tokens: maxTokens };
}

/**
 * OpenAI provider implementation
 */
export class OpenAIProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;

  protected client: OpenAI | null = null;
  protected config: ProviderConfig = {};
  protected retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;

  constructor(id = "openai", name = "OpenAI") {
    this.id = id;
    this.name = name;
  }

  /**
   * Initialize the provider
   */
  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;

    // Get API key based on provider type (supports OpenAI-compatible providers like Kimi)
    let apiKey = config.apiKey;
    if (!apiKey) {
      if (this.id === "kimi") {
        apiKey = process.env["KIMI_API_KEY"] ?? process.env["MOONSHOT_API_KEY"];
      } else {
        apiKey = process.env["OPENAI_API_KEY"];
      }
    }

    if (!apiKey) {
      throw new ProviderError(`${this.name} API key not provided`, {
        provider: this.id,
      });
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 120000,
    });
  }

  /**
   * Check if a model supports temperature parameter
   */
  protected supportsTemperature(model: string): boolean {
    return !MODELS_WITHOUT_TEMPERATURE.some((m) => model.toLowerCase().includes(m.toLowerCase()));
  }

  /**
   * Whether this provider instance supports the Responses API for the given model.
   * Subclasses (e.g. CopilotProvider) can override to force Chat Completions
   * when their endpoint does not expose /v1/responses.
   */
  protected modelNeedsResponsesApi(model: string): boolean {
    return needsResponsesApi(model);
  }

  /**
   * Get extra body parameters for API calls.
   * Honors the user's ThinkingMode for Kimi models; defaults to disabled
   * (preserving existing behavior) when no mode is specified.
   */
  private getExtraBody(
    model: string,
    thinking?: ThinkingMode,
  ): Record<string, unknown> | undefined {
    const kimiBody = mapToKimiExtraBody(thinking, model);
    if (kimiBody) return kimiBody;

    // Fallback for Kimi models without explicit mode: disable thinking
    if (MODELS_WITH_THINKING_MODE.some((m) => model.toLowerCase().includes(m.toLowerCase()))) {
      return { thinking: { type: "disabled" } };
    }
    return undefined;
  }

  /**
   * Send a chat message
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    this.ensureInitialized();

    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
    if (this.modelNeedsResponsesApi(model)) {
      return this.chatViaResponses(messages, options);
    }

    return withRetry(async () => {
      try {
        const supportsTemp = this.supportsTemperature(model);

        const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 8192;
        const reasoningEffort = mapToOpenAIEffort(options?.thinking, model);
        const response = await this.client!.chat.completions.create({
          model,
          ...buildMaxTokensParam(model, maxTokens),
          messages: this.convertMessages(messages, options?.system),
          stop: options?.stopSequences,
          ...(supportsTemp && {
            temperature: options?.temperature ?? this.config.temperature ?? 0,
          }),
          ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
        } as OpenAI.ChatCompletionCreateParamsNonStreaming);

        const choice = response.choices[0];

        return {
          id: response.id,
          content: choice?.message?.content ?? "",
          stopReason: this.mapFinishReason(choice?.finish_reason),
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
          },
          model: response.model,
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }, this.retryConfig);
  }

  /**
   * Send a chat message with tool use
   */
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    this.ensureInitialized();

    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
    if (this.modelNeedsResponsesApi(model)) {
      return this.chatWithToolsViaResponses(messages, options);
    }

    const tierCfg = getTierConfig(this.id, model);

    return withRetry(async () => {
      try {
        const supportsTemp = this.supportsTemperature(model);
        const extraBody = this.getExtraBody(model, options?.thinking);
        const reasoningEffort = mapToOpenAIEffort(options?.thinking, model);

        // Build request params
        const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 8192;
        const tools = this.limitTools(options.tools, tierCfg.maxTools);
        const requestParams: Record<string, unknown> = {
          model,
          ...buildMaxTokensParam(model, maxTokens),
          messages: this.convertMessages(messages, options?.system),
          tools: this.convertTools(tools),
          tool_choice: this.convertToolChoice(options.toolChoice),
          parallel_tool_calls: tierCfg.parallelToolCalls,
        };

        if (supportsTemp) {
          requestParams.temperature = options?.temperature ?? this.config.temperature ?? 0;
        }

        if (reasoningEffort) {
          requestParams.reasoning_effort = reasoningEffort;
        }

        if (extraBody) {
          Object.assign(requestParams, extraBody);
        }

        const response = await this.client!.chat.completions.create(
          requestParams as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );

        const choice = response.choices[0];
        const toolCalls = this.extractToolCalls(choice?.message?.tool_calls);

        return {
          id: response.id,
          content: choice?.message?.content ?? "",
          stopReason: this.mapFinishReason(choice?.finish_reason),
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
          },
          model: response.model,
          toolCalls,
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }, this.retryConfig);
  }

  /**
   * Stream a chat response
   */
  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    this.ensureInitialized();

    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
    if (this.modelNeedsResponsesApi(model)) {
      yield* this.streamViaResponses(messages, options);
      return;
    }

    try {
      const supportsTemp = this.supportsTemperature(model);

      const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 8192;
      const reasoningEffort = mapToOpenAIEffort(options?.thinking, model);
      const stream = await this.client!.chat.completions.create({
        model,
        ...buildMaxTokensParam(model, maxTokens),
        messages: this.convertMessages(messages, options?.system),
        stream: true,
        ...(supportsTemp && { temperature: options?.temperature ?? this.config.temperature ?? 0 }),
        ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
      } as OpenAI.ChatCompletionCreateParamsStreaming);

      let streamStopReason: StreamChunk["stopReason"];

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield { type: "text", text: delta.content };
        }
        const finishReason = chunk.choices[0]?.finish_reason;
        if (finishReason) {
          streamStopReason = this.mapFinishReason(finishReason);
        }
      }

      yield { type: "done", stopReason: streamStopReason };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Stream a chat response with tool use
   */
  async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    this.ensureInitialized();

    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
    if (this.modelNeedsResponsesApi(model)) {
      yield* this.streamWithToolsViaResponses(messages, options);
      return;
    }

    const tierCfg = getTierConfig(this.id, model);
    let timeoutTriggered = false;
    try {
      const supportsTemp = this.supportsTemperature(model);
      const extraBody = this.getExtraBody(model, options?.thinking);
      const reasoningEffort = mapToOpenAIEffort(options?.thinking, model);

      // Build request params
      const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 8192;
      const tools = this.limitTools(options.tools, tierCfg.maxTools);
      const requestParams: Record<string, unknown> = {
        model,
        ...buildMaxTokensParam(model, maxTokens),
        messages: this.convertMessages(messages, options?.system),
        tools: this.convertTools(tools),
        tool_choice: this.convertToolChoice(options.toolChoice),
        parallel_tool_calls: tierCfg.parallelToolCalls,
        stream: true,
      };

      if (supportsTemp) {
        requestParams.temperature = options?.temperature ?? this.config.temperature ?? 0;
      }

      if (reasoningEffort) {
        requestParams.reasoning_effort = reasoningEffort;
      }

      if (extraBody) {
        Object.assign(requestParams, extraBody);
      }

      const stream = await this.client!.chat.completions.create(
        requestParams as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
      );

      const toolCallAssembler = new ChatToolCallAssembler();

      // Activity-based timeout: abort the stream if no events for streamTimeout ms.
      // IMPORTANT: We use AbortController instead of throwing from setInterval,
      // because throw inside setInterval causes an unhandled exception that kills
      // the process instead of propagating to the async generator.
      const streamTimeout = this.config.timeout ?? 120000;
      let lastActivityTime = Date.now();
      const timeoutController = new AbortController();

      const timeoutInterval = setInterval(() => {
        if (Date.now() - lastActivityTime > streamTimeout) {
          clearInterval(timeoutInterval);
          timeoutTriggered = true;
          timeoutController.abort();
        }
      }, 5000);

      // Abort the underlying stream when timeout fires
      timeoutController.signal.addEventListener("abort", () => stream.controller.abort(), {
        once: true,
      });

      try {
        let streamStopReason: StreamChunk["stopReason"];

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          // Reset timeout on any activity (content, tool calls)
          if (delta?.content || delta?.tool_calls) {
            lastActivityTime = Date.now();
          }

          // Handle text content
          if (delta?.content) {
            yield { type: "text", text: delta.content };
          }

          // Handle tool calls
          if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const consumed = toolCallAssembler.consume({
                index: toolCallDelta.index,
                id: toolCallDelta.id ?? undefined,
                function: {
                  name: toolCallDelta.function?.name ?? undefined,
                  arguments: toolCallDelta.function?.arguments ?? undefined,
                },
              });

              if (consumed.started) {
                yield {
                  type: "tool_use_start",
                  toolCall: {
                    id: consumed.started.id,
                    name: consumed.started.name,
                  },
                };
              }
              if (consumed.argumentDelta) {
                yield {
                  type: "tool_use_delta",
                  toolCall: {
                    id: consumed.argumentDelta.id,
                    name: consumed.argumentDelta.name,
                  },
                  text: consumed.argumentDelta.text,
                };
              }
            }
          }

          // Finalize tool calls inline when finish_reason is received.
          // This ensures tool_use_end events are yielded to the consumer
          // while still inside the for-await loop — so they are never lost
          // if the consumer breaks out of the generator early (e.g. on abort).
          const finishReason = chunk.choices[0]?.finish_reason;
          if (finishReason) {
            streamStopReason = this.mapFinishReason(finishReason);
          }
          if (finishReason) {
            for (const toolCall of toolCallAssembler.finalizeAll(this.name)) {
              yield {
                type: "tool_use_end",
                toolCall: {
                  id: toolCall.id,
                  name: toolCall.name,
                  input: toolCall.input,
                },
              };
            }
          }
        }

        // Fallback: finalize any remaining tool calls not yet emitted.
        // Handles providers that omit finish_reason in the last chunk.
        for (const toolCall of toolCallAssembler.finalizeAll(this.name)) {
          yield {
            type: "tool_use_end",
            toolCall: {
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input,
            },
          };
        }

        yield { type: "done", stopReason: streamStopReason };
      } finally {
        clearInterval(timeoutInterval);
      }

      // If we exited the loop because of our timeout, throw a descriptive error
      if (timeoutController.signal.aborted) {
        throw new Error(`Stream timeout: No response from LLM for ${streamTimeout / 1000}s`);
      }
    } catch (error) {
      if (timeoutTriggered) {
        throw new Error(
          `Stream timeout: No response from LLM for ${(this.config.timeout ?? 120000) / 1000}s`,
        );
      }
      throw this.handleError(error);
    }
  }

  /**
   * Check if current model is a local model (LM Studio, Ollama, etc.)
   */
  private isLocalModel(): boolean {
    const model = (this.config.model ?? "").toLowerCase();
    const baseUrl = (this.config.baseUrl ?? "").toLowerCase();

    // Check by URL patterns (localhost, common local ports)
    if (
      baseUrl.includes("localhost") ||
      baseUrl.includes("127.0.0.1") ||
      baseUrl.includes(":1234") || // LM Studio default
      baseUrl.includes(":11434") // Ollama default
    ) {
      return true;
    }

    // Check by model name patterns
    return LOCAL_MODEL_PATTERNS.some((pattern) => model.includes(pattern));
  }

  /**
   * Count tokens (improved heuristic for OpenAI and local models)
   *
   * Different tokenizers have different characteristics:
   *
   * GPT models (BPE tokenizer - tiktoken):
   * - English text: ~4 characters per token
   * - Code: ~3.3 characters per token
   *
   * Local models (SentencePiece/HuggingFace tokenizers):
   * - Qwen models: ~3.5 chars/token for code, uses tiktoken-compatible
   * - Llama models: ~3.8 chars/token, SentencePiece-based
   * - DeepSeek: ~3.2 chars/token for code, BPE-based
   * - Mistral: ~3.5 chars/token, SentencePiece-based
   *
   * For accurate counting, use the model's native tokenizer.
   * This heuristic provides a reasonable estimate without dependencies.
   */
  countTokens(text: string): number {
    if (!text) return 0;

    // Count different character types
    const codePatterns = /[{}[\]();=<>!&|+\-*/]/g;
    const whitespacePattern = /\s/g;
    const wordPattern = /\b\w+\b/g;
    // oxlint-disable-next-line no-control-regex -- Intentional: detecting non-ASCII characters
    const nonAsciiPattern = /[^\x00-\x7F]/g;

    const codeChars = (text.match(codePatterns) || []).length;
    const whitespace = (text.match(whitespacePattern) || []).length;
    const words = (text.match(wordPattern) || []).length;
    const nonAscii = (text.match(nonAsciiPattern) || []).length;

    // Estimate if text is code-like
    const isCodeLike = codeChars > text.length * 0.05;

    // Check if we're using a local model (different tokenizer characteristics)
    const isLocal = this.isLocalModel();

    // Calculate base ratio based on model type and content
    let charsPerToken: number;
    if (isLocal) {
      // Local models tend to have slightly more efficient tokenization for code
      if (isCodeLike) {
        charsPerToken = 3.2; // Code is more efficiently tokenized
      } else if (nonAscii > text.length * 0.1) {
        charsPerToken = 2.0; // Non-ASCII (CJK, emoji) uses more tokens
      } else {
        charsPerToken = 3.5;
      }
    } else {
      // OpenAI GPT models
      if (isCodeLike) {
        charsPerToken = 3.3;
      } else if (whitespace > text.length * 0.3) {
        charsPerToken = 4.5;
      } else {
        charsPerToken = 4.0;
      }
    }

    // Word-based estimate
    const tokensPerWord = isLocal ? 1.4 : 1.3;
    const wordBasedEstimate = words * tokensPerWord;

    // Char-based estimate
    const charBasedEstimate = text.length / charsPerToken;

    // Use weighted average (char-based is usually more reliable for code)
    const weight = isCodeLike ? 0.7 : 0.5;
    return Math.ceil(charBasedEstimate * weight + wordBasedEstimate * (1 - weight));
  }

  /**
   * Get context window size
   *
   * For local models, tries to match by model family if exact match not found.
   * This handles cases where LM Studio reports models with different naming
   * conventions (e.g., "qwen3-coder-8b" vs "qwen3-coder-8b-instruct").
   */
  getContextWindow(): number {
    const model = this.config.model ?? DEFAULT_MODEL;

    // Try exact match first
    if (CONTEXT_WINDOWS[model]) {
      return CONTEXT_WINDOWS[model];
    }

    // Try partial match for local models
    const modelLower = model.toLowerCase();
    for (const [key, value] of Object.entries(CONTEXT_WINDOWS)) {
      // Check if model name contains the key or vice versa
      if (modelLower.includes(key.toLowerCase()) || key.toLowerCase().includes(modelLower)) {
        return value;
      }
    }

    // Infer context window by model family for local models
    if (modelLower.includes("qwen3-coder")) {
      return 256000; // Qwen3-Coder has 256k context
    }
    if (modelLower.includes("qwen2.5-coder")) {
      return 32768;
    }
    if (modelLower.includes("deepseek-coder")) {
      return 128000;
    }
    if (modelLower.includes("codestral")) {
      return 32768;
    }
    if (modelLower.includes("llama-3.1") || modelLower.includes("llama-3.2")) {
      return 128000;
    }
    if (modelLower.includes("llama")) {
      return 8192;
    }
    if (modelLower.includes("mistral-nemo")) {
      return 128000;
    }
    if (modelLower.includes("mistral") || modelLower.includes("mixtral")) {
      return 32768;
    }

    // Default for unknown models (conservative estimate for local models)
    if (this.isLocalModel()) {
      return 32768; // Safe default for local models
    }

    return 128000; // Default for cloud APIs
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.client) return false;

    try {
      // Try to list models first (standard OpenAI)
      await this.client.models.list();
      return true;
    } catch {
      // Fallback: try a simple request
      // This works better for OpenAI-compatible APIs like Kimi
      try {
        const model = this.config.model || DEFAULT_MODEL;
        if (this.modelNeedsResponsesApi(model)) {
          await (this.client as any).responses.create({
            model,
            input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
            max_output_tokens: 1,
            store: false,
          });
        } else {
          await this.client.chat.completions.create({
            model,
            messages: [{ role: "user", content: "Hi" }],
            ...buildMaxTokensParam(model, 1),
          } as OpenAI.ChatCompletionCreateParamsNonStreaming);
        }
        return true;
      } catch {
        // If we get a 401/403, the key is invalid
        // If we get a 404, the model might not exist
        // If we get other errors, provider might be down
        return false;
      }
    }
  }

  /**
   * Ensure client is initialized
   */
  protected ensureInitialized(): void {
    if (!this.client) {
      throw new ProviderError("Provider not initialized. Call initialize() first.", {
        provider: this.id,
      });
    }
  }

  /**
   * Convert messages to OpenAI format
   */
  private convertMessages(
    messages: Message[],
    systemPrompt?: string,
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    // Add system message if provided
    if (systemPrompt) {
      result.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "system", content: this.contentToString(msg.content) });
      } else if (msg.role === "user") {
        // Check if this is a tool result message
        if (Array.isArray(msg.content) && msg.content.some((b) => b.type === "tool_result")) {
          // Convert tool results to OpenAI format.
          // OpenAI requires one 'tool' role message per tool_call_id.
          // Any text blocks in the same user message (unusual but valid in Anthropic format)
          // are emitted as a separate user message after the tool messages.
          const textParts: string[] = [];
          for (const block of msg.content) {
            if (block.type === "tool_result") {
              const toolResult = block as ToolResultContent;
              result.push({
                role: "tool",
                tool_call_id: toolResult.tool_use_id,
                content: toolResult.content,
              });
            } else if (block.type === "text") {
              textParts.push(block.text);
            }
          }
          if (textParts.length > 0) {
            console.warn(
              `[${this.name}] User message has mixed tool_result and text blocks — text emitted as a separate user message.`,
            );
            result.push({ role: "user", content: textParts.join("") });
          }
        } else if (Array.isArray(msg.content) && msg.content.some((b) => b.type === "image")) {
          // Build OpenAI vision-format content parts for messages with images
          const parts: Array<
            { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
          > = [];

          for (const block of msg.content) {
            if (block.type === "text") {
              parts.push({ type: "text", text: block.text });
            } else if (block.type === "image") {
              const imgBlock = block as ImageContent;
              parts.push({
                type: "image_url",
                image_url: {
                  url: `data:${imgBlock.source.media_type};base64,${imgBlock.source.data}`,
                },
              });
            }
          }
          result.push({
            role: "user",
            content: parts,
          } as OpenAI.ChatCompletionUserMessageParam);
        } else {
          result.push({ role: "user", content: this.contentToString(msg.content) });
        }
      } else if (msg.role === "assistant") {
        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: null,
        };

        if (typeof msg.content === "string") {
          assistantMsg.content = msg.content;
        } else if (Array.isArray(msg.content)) {
          // Extract text and tool calls
          const textParts: string[] = [];
          const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

          for (const block of msg.content) {
            if (block.type === "text") {
              textParts.push(block.text);
            } else if (block.type === "tool_use") {
              toolCalls.push({
                id: block.id,
                type: "function",
                function: {
                  name: block.name,
                  arguments: JSON.stringify(block.input),
                },
              });
            } else {
              // tool_result blocks belong in user messages, not assistant messages.
              // Any other unexpected type is also silently dropped here — log a
              // warning so message-format bugs are visible in the console.
              console.warn(
                `[${this.name}] Unexpected block type '${(block as { type?: string }).type}' in assistant message — dropping. This may indicate a message history corruption.`,
              );
            }
          }

          if (textParts.length > 0) {
            assistantMsg.content = textParts.join("");
          }
          if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls;
          }
        }

        result.push(assistantMsg);
      }
    }

    return result;
  }

  /**
   * Convert content to string
   */
  protected contentToString(content: MessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    return content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("");
  }

  /**
   * Limit the tool list to at most `max` entries.
   * Built-in tools (those without an `mcp_server` tag) are prioritised over
   * MCP tools so core capabilities are never dropped.
   */
  protected limitTools(tools: ToolDefinition[], max: number): ToolDefinition[] {
    if (tools.length <= max) return tools;
    // Sort: built-in (no server tag) first, MCP tools after
    const builtin = tools.filter((t) => !("serverName" in t && t.serverName));
    const mcp = tools.filter((t) => "serverName" in t && t.serverName);
    return [...builtin, ...mcp].slice(0, max);
  }

  /**
   * Convert tools to OpenAI format
   */
  private convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: truncateToolDescription(tool.description),
        parameters: tool.input_schema,
        strict: true,
      },
    }));
  }

  /**
   * Convert tool choice to OpenAI format
   */
  private convertToolChoice(
    choice: ChatWithToolsOptions["toolChoice"],
  ): OpenAI.ChatCompletionToolChoiceOption | undefined {
    if (!choice) return undefined;
    if (choice === "auto") return "auto";
    if (choice === "any") return "required";
    if (typeof choice === "object" && choice.type === "tool") {
      return { type: "function", function: { name: choice.name } };
    }
    return "auto";
  }

  /**
   * Extract tool calls from response
   */
  private extractToolCalls(toolCalls?: OpenAI.ChatCompletionMessageToolCall[]): ToolCall[] {
    if (!toolCalls) return [];

    return toolCalls
      .filter(
        (tc): tc is OpenAI.ChatCompletionMessageToolCall & { type: "function" } =>
          tc.type === "function",
      )
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: (() => {
          try {
            return JSON.parse(tc.function.arguments || "{}");
          } catch {
            console.warn(
              `[${this.name}] Failed to parse tool call arguments: ${tc.function.arguments?.slice(0, 100)}`,
            );
            return {};
          }
        })(),
      }));
  }

  /**
   * Map finish reason to our format
   */
  private mapFinishReason(reason?: string | null): ChatResponse["stopReason"] {
    switch (reason) {
      case "stop":
        return "end_turn";
      case "length":
        return "max_tokens";
      case "tool_calls":
        return "tool_use";
      default:
        return "end_turn";
    }
  }

  /**
   * Handle API errors
   */
  protected handleError(error: unknown): never {
    if (error instanceof OpenAI.APIError) {
      // Determine if error is retryable based on status code and message
      const msg = error.message.toLowerCase();
      let retryable = error.status === 429 || (error.status ?? 0) >= 500;

      // Non-retryable: quota/billing errors
      if (
        msg.includes("exceeded your current quota") ||
        msg.includes("insufficient_quota") ||
        msg.includes("billing") ||
        msg.includes("usage limit") ||
        msg.includes("you have exceeded")
      ) {
        retryable = false;
      }

      // Non-retryable: auth errors
      if (error.status === 401 || error.status === 403) {
        retryable = false;
      }

      throw new ProviderError(error.message, {
        provider: this.id,
        statusCode: error.status,
        retryable,
        cause: error,
      });
    }

    // Handle non-OpenAI errors (network, etc.)
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      // Check for quota/billing errors in message
      const isQuotaError =
        msg.includes("exceeded your current quota") ||
        msg.includes("insufficient_quota") ||
        msg.includes("usage limit") ||
        msg.includes("you have exceeded");

      throw new ProviderError(error.message, {
        provider: this.id,
        retryable: !isQuotaError,
        cause: error,
      });
    }

    throw new ProviderError(String(error), {
      provider: this.id,
    });
  }

  // --- Responses API support (GPT-5+, Codex, o3, o4 models) ---

  /**
   * Simple chat via Responses API (no tools)
   */
  protected async chatViaResponses(
    messages: Message[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    this.ensureInitialized();

    return withRetry(async () => {
      try {
        const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
        const { input, instructions } = this.convertToResponsesInput(messages, options?.system);
        const supportsTemp = this.supportsTemperature(model);

        const reasoningEffort = mapToOpenAIEffort(options?.thinking, model);
        const response = await this.client!.responses.create({
          model,
          input,
          instructions: instructions ?? undefined,
          max_output_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          ...(supportsTemp && {
            temperature: options?.temperature ?? this.config.temperature ?? 0,
          }),
          // Responses API uses nested reasoning.effort (not top-level reasoning_effort)
          ...(reasoningEffort && { reasoning: { effort: reasoningEffort } }),
          store: false,
        });

        return {
          id: response.id,
          content: response.output_text ?? "",
          stopReason: response.status === "completed" ? "end_turn" : "max_tokens",
          usage: {
            inputTokens: response.usage?.input_tokens ?? 0,
            outputTokens: response.usage?.output_tokens ?? 0,
          },
          model: String(response.model),
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }, this.retryConfig);
  }

  /**
   * Chat with tools via Responses API
   */
  protected async chatWithToolsViaResponses(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    this.ensureInitialized();

    return withRetry(async () => {
      try {
        const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
        const tierCfg = getTierConfig(this.id, model);
        const { input, instructions } = this.convertToResponsesInput(messages, options?.system);
        const tools = this.convertToolsForResponses(this.limitTools(options.tools, tierCfg.maxTools));
        const supportsTemp = this.supportsTemperature(model);

        const reasoningEffort = mapToOpenAIEffort(options?.thinking, model);
        const response = await this.client!.responses.create({
          model,
          input,
          instructions: instructions ?? undefined,
          tools,
          max_output_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          ...(supportsTemp && {
            temperature: options?.temperature ?? this.config.temperature ?? 0,
          }),
          ...(reasoningEffort && { reasoning: { effort: reasoningEffort } }),
          store: false,
        });

        // Extract text and tool calls from output
        let content = "";
        const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

        for (const item of response.output) {
          if (item.type === "message") {
            for (const part of item.content) {
              if (part.type === "output_text") {
                content += part.text;
              }
            }
          } else if (item.type === "function_call") {
            toolCalls.push({
              id: item.call_id,
              name: item.name,
              input: parseToolCallArguments(item.arguments, this.name),
            });
          }
        }

        return {
          id: response.id,
          content,
          stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
          usage: {
            inputTokens: response.usage?.input_tokens ?? 0,
            outputTokens: response.usage?.output_tokens ?? 0,
          },
          model: String(response.model),
          toolCalls,
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }, this.retryConfig);
  }

  /**
   * Stream via Responses API (no tools)
   */
  protected async *streamViaResponses(
    messages: Message[],
    options?: ChatOptions,
  ): AsyncIterable<StreamChunk> {
    this.ensureInitialized();

    let timeoutTriggered = false;
    try {
      const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
      const { input, instructions } = this.convertToResponsesInput(messages, options?.system);
      const supportsTemp = this.supportsTemperature(model);

      const reasoningEffort = mapToOpenAIEffort(options?.thinking, model);
      const stream = await this.client!.responses.create({
        model,
        input,
        instructions: instructions ?? undefined,
        max_output_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        ...(supportsTemp && { temperature: options?.temperature ?? this.config.temperature ?? 0 }),
        ...(reasoningEffort && { reasoning: { effort: reasoningEffort } }),
        store: false,
        stream: true,
      });

      // Activity-based timeout using AbortController (safe for async generators)
      const streamTimeout = this.config.timeout ?? 120000;
      let lastActivityTime = Date.now();
      const timeoutController = new AbortController();

      const timeoutInterval = setInterval(() => {
        if (Date.now() - lastActivityTime > streamTimeout) {
          clearInterval(timeoutInterval);
          timeoutTriggered = true;
          timeoutController.abort();
        }
      }, 5000);

      timeoutController.signal.addEventListener(
        "abort",
        () => (stream as unknown as { controller: AbortController }).controller?.abort(),
        { once: true },
      );

      try {
        for await (const event of stream) {
          lastActivityTime = Date.now();
          if (event.type === "response.output_text.delta") {
            yield { type: "text", text: event.delta };
          } else if (event.type === "response.completed") {
            yield { type: "done", stopReason: "end_turn" };
          }
        }
      } finally {
        clearInterval(timeoutInterval);
      }

      if (timeoutController.signal.aborted) {
        throw new Error(`Stream timeout: No response from LLM for ${streamTimeout / 1000}s`);
      }
    } catch (error) {
      if (timeoutTriggered) {
        throw new Error(
          `Stream timeout: No response from LLM for ${(this.config.timeout ?? 120000) / 1000}s`,
        );
      }
      throw this.handleError(error);
    }
  }

  /**
   * Stream with tools via Responses API
   *
   * IMPORTANT: fnCallBuilders is keyed by output item ID (fc.id), NOT by
   * call_id. The streaming events (function_call_arguments.delta/done) use
   * item_id which references the output item's id field, not call_id.
   */
  protected async *streamWithToolsViaResponses(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    this.ensureInitialized();

    let timeoutTriggered = false;
    try {
      const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
      const tierCfg = getTierConfig(this.id, model);
      const { input, instructions } = this.convertToResponsesInput(messages, options?.system);
      const limitedTools = this.limitTools(options.tools, tierCfg.maxTools);
      const tools =
        limitedTools.length > 0 ? this.convertToolsForResponses(limitedTools) : undefined;
      const supportsTemp = this.supportsTemperature(model);

      const reasoningEffort = mapToOpenAIEffort(options?.thinking, model);
      const requestParams: Record<string, unknown> = {
        model,
        input,
        instructions: instructions ?? undefined,
        max_output_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        ...(supportsTemp && { temperature: options?.temperature ?? this.config.temperature ?? 0 }),
        ...(reasoningEffort && { reasoning: { effort: reasoningEffort } }),
        store: false,
        stream: true,
      };

      if (tools) {
        requestParams.tools = tools;
      }

      const stream = await this.client!.responses.create(
        requestParams as unknown as Responses.ResponseCreateParamsStreaming,
      );

      const toolCallAssembler = new ResponsesToolCallAssembler();

      // Activity-based timeout using AbortController (safe for async generators)
      const streamTimeout = this.config.timeout ?? 120000;
      let lastActivityTime = Date.now();
      const timeoutController = new AbortController();

      const timeoutInterval = setInterval(() => {
        if (Date.now() - lastActivityTime > streamTimeout) {
          clearInterval(timeoutInterval);
          timeoutTriggered = true;
          timeoutController.abort();
        }
      }, 5000);

      timeoutController.signal.addEventListener(
        "abort",
        () => (stream as unknown as { controller: AbortController }).controller?.abort(),
        { once: true },
      );

      try {
        for await (const event of stream) {
          lastActivityTime = Date.now();

          switch (event.type) {
            case "response.output_text.delta":
              yield { type: "text", text: event.delta };
              break;

            case "response.output_item.added":
              {
                const item = event.item as {
                  type?: string;
                  id?: string;
                  call_id?: string;
                  name?: string;
                  arguments?: string;
                };
                const start = toolCallAssembler.onOutputItemAdded({
                  output_index: event.output_index,
                  item: {
                    type: item.type,
                    id: item.id,
                    call_id: item.call_id,
                    name: item.name,
                    arguments: item.arguments,
                  },
                });
                if (!start) break;
                yield {
                  type: "tool_use_start",
                  toolCall: { id: start.id, name: start.name },
                };
              }
              break;

            case "response.function_call_arguments.delta":
              toolCallAssembler.onArgumentsDelta({
                item_id: event.item_id,
                output_index: event.output_index,
                delta: event.delta,
              });
              break;

            case "response.function_call_arguments.done":
              {
                const toolCall = toolCallAssembler.onArgumentsDone(
                  {
                    item_id: event.item_id,
                    output_index: event.output_index,
                    arguments: event.arguments,
                  },
                  this.name,
                );
                if (toolCall) {
                  yield {
                    type: "tool_use_end",
                    toolCall: {
                      id: toolCall.id,
                      name: toolCall.name,
                      input: toolCall.input,
                    },
                  };
                }
              }
              break;

            case "response.completed":
              {
                const emittedCallIds = new Set<string>();

                // Emit any remaining function calls not finalized via done events
                for (const toolCall of toolCallAssembler.finalizeAll(this.name)) {
                  if (toolCall.id) emittedCallIds.add(toolCall.id);
                  yield {
                    type: "tool_use_end",
                    toolCall: {
                      id: toolCall.id,
                      name: toolCall.name,
                      input: toolCall.input,
                    },
                  };
                }

                const outputItems =
                  (event.response?.output as Array<{
                    type?: string;
                    call_id?: string;
                    name?: string;
                    arguments?: string;
                  }>) ?? [];

                // Fallback: some OpenAI-compatible providers only include
                // function calls in response.completed.output and may omit
                // fine-grained function_call_arguments.done events.
                for (const item of outputItems) {
                  if (item.type !== "function_call" || !item.call_id || !item.name) continue;
                  if (emittedCallIds.has(item.call_id)) continue;
                  yield {
                    type: "tool_use_end",
                    toolCall: {
                      id: item.call_id,
                      name: item.name,
                      input: parseToolCallArguments(item.arguments ?? "{}", this.name),
                    },
                  };
                }

                const hasToolCalls = outputItems.some((i) => i.type === "function_call");
                yield {
                  type: "done",
                  stopReason: hasToolCalls ? "tool_use" : "end_turn",
                };
              }
              break;
          }
        }
      } finally {
        clearInterval(timeoutInterval);
      }

      if (timeoutController.signal.aborted) {
        throw new Error(`Stream timeout: No response from LLM for ${streamTimeout / 1000}s`);
      }
    } catch (error) {
      if (timeoutTriggered) {
        throw new Error(
          `Stream timeout: No response from LLM for ${(this.config.timeout ?? 120000) / 1000}s`,
        );
      }
      throw this.handleError(error);
    }
  }

  // --- Responses API conversion helpers ---

  /**
   * Convert internal messages to Responses API input format.
   *
   * The Responses API uses a flat array of input items instead of the
   * chat completions messages array.
   */
  protected convertToResponsesInput(
    messages: Message[],
    systemPrompt?: string,
  ): { input: Responses.ResponseInput; instructions: string | null } {
    const input: Responses.ResponseInput = [];
    let instructions: string | null = null;

    if (systemPrompt) {
      instructions = systemPrompt;
    }

    for (const msg of messages) {
      if (msg.role === "system") {
        instructions =
          (instructions ? instructions + "\n\n" : "") + this.contentToString(msg.content);
      } else if (msg.role === "user") {
        if (Array.isArray(msg.content) && msg.content.some((b) => b.type === "tool_result")) {
          // Convert tool results to function_call_output items
          for (const block of msg.content) {
            if (block.type === "tool_result") {
              const tr = block as ToolResultContent;
              input.push({
                type: "function_call_output",
                call_id: tr.tool_use_id,
                output: tr.content,
              });
            }
          }
        } else if (Array.isArray(msg.content) && msg.content.some((b) => b.type === "image")) {
          // Build Responses API multi-part content with images
          const parts: Responses.ResponseInputContent[] = [];
          for (const block of msg.content) {
            if (block.type === "text") {
              parts.push({ type: "input_text", text: block.text });
            } else if (block.type === "image") {
              const imgBlock = block as ImageContent;
              parts.push({
                type: "input_image",
                image_url: `data:${imgBlock.source.media_type};base64,${imgBlock.source.data}`,
                detail: "auto",
              });
            }
          }
          input.push({
            role: "user",
            content: parts,
          } as Responses.EasyInputMessage);
        } else {
          input.push({
            role: "user",
            content: this.contentToString(msg.content),
          });
        }
      } else if (msg.role === "assistant") {
        if (typeof msg.content === "string") {
          input.push({ role: "assistant", content: msg.content });
        } else if (Array.isArray(msg.content)) {
          const textParts: string[] = [];

          for (const block of msg.content) {
            if (block.type === "text") {
              textParts.push(block.text);
            } else if (block.type === "tool_use") {
              // Emit accumulated text before function_call
              if (textParts.length > 0) {
                input.push({ role: "assistant", content: textParts.join("") });
                textParts.length = 0;
              }
              input.push({
                type: "function_call",
                call_id: block.id,
                name: block.name,
                arguments: JSON.stringify(block.input),
              });
            }
          }

          if (textParts.length > 0) {
            input.push({ role: "assistant", content: textParts.join("") });
          }
        }
      }
    }

    return { input, instructions };
  }

  /**
   * Convert tool definitions to Responses API FunctionTool format
   */
  protected convertToolsForResponses(tools: ToolDefinition[]): Responses.FunctionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description ? truncateToolDescription(tool.description) : undefined,
      parameters: tool.input_schema ?? null,
      strict: true,
    }));
  }
}

/**
 * OpenAI enforces a 1024-character limit on tool descriptions.
 * Truncate gracefully so MCP tools with long descriptions (e.g. Atlassian)
 * don't cause silent request failures.
 * https://platform.openai.com/docs/guides/function-calling
 */
const MAX_TOOL_DESCRIPTION_LENGTH = 1024;

function truncateToolDescription(description: string): string {
  if (description.length <= MAX_TOOL_DESCRIPTION_LENGTH) return description;
  return description.slice(0, MAX_TOOL_DESCRIPTION_LENGTH - 1) + "…";
}

/**
 * Create an OpenAI provider
 */
export function createOpenAIProvider(config?: ProviderConfig): OpenAIProvider {
  const provider = new OpenAIProvider();
  if (config) {
    provider.initialize(config).catch(() => {});
  }
  return provider;
}

/**
 * Create a Kimi/Moonshot provider (OpenAI-compatible)
 *
 * Uses the standard Moonshot API — pay per token.
 *
 * Note: Moonshot has two API endpoints:
 * - Global: https://api.moonshot.ai/v1 (default)
 * - China: https://api.moonshot.cn/v1
 * Use KIMI_BASE_URL env var to override if needed
 */
export function createKimiProvider(config?: ProviderConfig): OpenAIProvider {
  const provider = new OpenAIProvider("kimi", "Kimi (Moonshot)");
  const kimiConfig: ProviderConfig = {
    ...config,
    baseUrl: config?.baseUrl ?? process.env["KIMI_BASE_URL"] ?? "https://api.moonshot.ai/v1",
    apiKey: config?.apiKey ?? process.env["KIMI_API_KEY"] ?? process.env["MOONSHOT_API_KEY"],
    model: config?.model ?? "kimi-k2.5",
  };
  if (kimiConfig.apiKey) {
    provider.initialize(kimiConfig).catch(() => {});
  }
  return provider;
}
