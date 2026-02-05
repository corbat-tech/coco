/**
 * OpenAI provider for Corbat-Coco
 * Also supports OpenAI-compatible APIs (Kimi/Moonshot, etc.)
 */

import OpenAI from "openai";
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
  ToolResultContent,
} from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { withRetry, type RetryConfig, DEFAULT_RETRY_CONFIG } from "./retry.js";

/**
 * Default model - Updated January 2026
 */
const DEFAULT_MODEL = "gpt-5.2-codex";

/**
 * Context windows for models
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
  "o3-mini": 200000,
  // GPT-5 series (2025-2026)
  "gpt-5": 400000,
  "gpt-5.2": 400000,
  "gpt-5.2-codex": 400000,
  "gpt-5.2-thinking": 400000,
  "gpt-5.2-instant": 400000,
  "gpt-5.2-pro": 400000,
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
};

/**
 * Models that don't support temperature parameter or only support temperature=1
 */
const MODELS_WITHOUT_TEMPERATURE: string[] = [
  "o1",
  "o1-mini",
  "o1-preview",
  "o3-mini",
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
const MODELS_WITH_THINKING_MODE: string[] = ["kimi-k2.5", "kimi-k2-0324", "kimi-latest"];

/**
 * OpenAI provider implementation
 */
export class OpenAIProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;

  private client: OpenAI | null = null;
  private config: ProviderConfig = {};
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;

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
  private supportsTemperature(model: string): boolean {
    return !MODELS_WITHOUT_TEMPERATURE.some((m) => model.toLowerCase().includes(m.toLowerCase()));
  }

  /**
   * Check if a model needs thinking mode disabled for tool use
   * Kimi models have thinking mode enabled by default which requires
   * reasoning_content in multi-turn conversations with tools
   */
  private needsThinkingDisabled(model: string): boolean {
    return MODELS_WITH_THINKING_MODE.some((m) => model.toLowerCase().includes(m.toLowerCase()));
  }

  /**
   * Get extra body parameters for API calls
   * Used to disable thinking mode for Kimi models
   * See: https://huggingface.co/moonshotai/Kimi-K2.5
   *
   * For Official Moonshot API: {'thinking': {'type': 'disabled'}}
   * For vLLM/SGLang: {'chat_template_kwargs': {"thinking": False}}
   */
  private getExtraBody(model: string): Record<string, unknown> | undefined {
    if (this.needsThinkingDisabled(model)) {
      // For official Moonshot API, use thinking.type = disabled
      // This enables "Instant mode" which doesn't require reasoning_content
      return {
        thinking: { type: "disabled" },
      };
    }
    return undefined;
  }

  /**
   * Send a chat message
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    this.ensureInitialized();

    return withRetry(async () => {
      try {
        const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
        const supportsTemp = this.supportsTemperature(model);

        const response = await this.client!.chat.completions.create({
          model,
          max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          messages: this.convertMessages(messages, options?.system),
          stop: options?.stopSequences,
          ...(supportsTemp && {
            temperature: options?.temperature ?? this.config.temperature ?? 0,
          }),
        });

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

    return withRetry(async () => {
      try {
        const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
        const supportsTemp = this.supportsTemperature(model);
        const extraBody = this.getExtraBody(model);

        // Build request params
        const requestParams: Record<string, unknown> = {
          model,
          max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          messages: this.convertMessages(messages, options?.system),
          tools: this.convertTools(options.tools),
          tool_choice: this.convertToolChoice(options.toolChoice),
        };

        if (supportsTemp) {
          requestParams.temperature = options?.temperature ?? this.config.temperature ?? 0;
        }

        // For Kimi models, add chat_template_kwargs directly to disable thinking
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

    try {
      const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
      const supportsTemp = this.supportsTemperature(model);

      const stream = await this.client!.chat.completions.create({
        model,
        max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        messages: this.convertMessages(messages, options?.system),
        stream: true,
        ...(supportsTemp && { temperature: options?.temperature ?? this.config.temperature ?? 0 }),
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield { type: "text", text: delta.content };
        }
      }

      yield { type: "done" };
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

    try {
      const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
      const supportsTemp = this.supportsTemperature(model);
      const extraBody = this.getExtraBody(model);

      // Build request params
      const requestParams: Record<string, unknown> = {
        model,
        max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        messages: this.convertMessages(messages, options?.system),
        tools: this.convertTools(options.tools),
        tool_choice: this.convertToolChoice(options.toolChoice),
        stream: true,
      };

      if (supportsTemp) {
        requestParams.temperature = options?.temperature ?? this.config.temperature ?? 0;
      }

      // For Kimi models, add chat_template_kwargs directly to disable thinking
      if (extraBody) {
        Object.assign(requestParams, extraBody);
      }

      const stream = await this.client!.chat.completions.create(
        requestParams as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
      );

      // Track tool calls being built (OpenAI can stream multiple tool calls)
      const toolCallBuilders: Map<number, { id: string; name: string; arguments: string }> =
        new Map();

      // Add timeout protection for local LLMs that may hang
      const streamTimeout = this.config.timeout ?? 120000;
      let lastActivityTime = Date.now();

      const checkTimeout = () => {
        if (Date.now() - lastActivityTime > streamTimeout) {
          throw new Error(`Stream timeout: No response from LLM for ${streamTimeout / 1000}s`);
        }
      };

      // Set up periodic timeout check
      const timeoutInterval = setInterval(checkTimeout, 5000);

      try {
        for await (const chunk of stream) {
          lastActivityTime = Date.now(); // Reset timeout on activity
          const delta = chunk.choices[0]?.delta;

          // Handle text content
          if (delta?.content) {
            yield { type: "text", text: delta.content };
          }

          // Handle tool calls
          if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index;

              if (!toolCallBuilders.has(index)) {
                // New tool call starting
                toolCallBuilders.set(index, {
                  id: toolCallDelta.id ?? "",
                  name: toolCallDelta.function?.name ?? "",
                  arguments: "",
                });
                yield {
                  type: "tool_use_start",
                  toolCall: {
                    id: toolCallDelta.id,
                    name: toolCallDelta.function?.name,
                  },
                };
              }

              const builder = toolCallBuilders.get(index)!;

              // Update id if provided
              if (toolCallDelta.id) {
                builder.id = toolCallDelta.id;
              }

              // Update name if provided
              if (toolCallDelta.function?.name) {
                builder.name = toolCallDelta.function.name;
              }

              // Accumulate arguments
              if (toolCallDelta.function?.arguments) {
                builder.arguments += toolCallDelta.function.arguments;
                yield {
                  type: "tool_use_delta",
                  toolCall: {
                    id: builder.id,
                    name: builder.name,
                  },
                  text: toolCallDelta.function.arguments,
                };
              }
            }
          }
        }

        // Finalize all tool calls
        for (const [, builder] of toolCallBuilders) {
          let input: Record<string, unknown> = {};
          try {
            input = builder.arguments ? JSON.parse(builder.arguments) : {};
          } catch {
            // Invalid JSON, use empty object
          }

          yield {
            type: "tool_use_end",
            toolCall: {
              id: builder.id,
              name: builder.name,
              input,
            },
          };
        }

        yield { type: "done" };
      } finally {
        clearInterval(timeoutInterval);
      }
    } catch (error) {
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
      // Fallback: try a simple chat completion
      // This works better for OpenAI-compatible APIs like Kimi
      try {
        const model = this.config.model || DEFAULT_MODEL;
        await this.client.chat.completions.create({
          model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1,
        });
        return true;
      } catch (chatError) {
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
  private ensureInitialized(): void {
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
        if (Array.isArray(msg.content) && msg.content[0]?.type === "tool_result") {
          // Convert tool results to OpenAI format
          for (const block of msg.content) {
            if (block.type === "tool_result") {
              const toolResult = block as ToolResultContent;
              result.push({
                role: "tool",
                tool_call_id: toolResult.tool_use_id,
                content: toolResult.content,
              });
            }
          }
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
  private contentToString(content: MessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    return content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("");
  }

  /**
   * Convert tools to OpenAI format
   */
  private convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
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
        input: JSON.parse(tc.function.arguments || "{}"),
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
  private handleError(error: unknown): never {
    if (error instanceof OpenAI.APIError) {
      const retryable = error.status === 429 || (error.status ?? 0) >= 500;
      throw new ProviderError(error.message, {
        provider: this.id,
        statusCode: error.status,
        retryable,
        cause: error,
      });
    }

    throw new ProviderError(error instanceof Error ? error.message : String(error), {
      provider: this.id,
      cause: error instanceof Error ? error : undefined,
    });
  }
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
