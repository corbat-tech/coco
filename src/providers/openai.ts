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
 * Default models
 */
const DEFAULT_MODEL = "gpt-4o";

/**
 * Context windows for models
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4": 8192,
  "gpt-3.5-turbo": 16385,
  "o1": 200000,
  "o1-mini": 128000,
  // Kimi/Moonshot models
  "moonshot-v1-8k": 8000,
  "moonshot-v1-32k": 32000,
  "moonshot-v1-128k": 128000,
};

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

    const apiKey = config.apiKey ?? process.env["OPENAI_API_KEY"];
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
   * Send a chat message
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    this.ensureInitialized();

    return withRetry(
      async () => {
        try {
          const response = await this.client!.chat.completions.create({
            model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
            max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
            temperature: options?.temperature ?? this.config.temperature ?? 0,
            messages: this.convertMessages(messages, options?.system),
            stop: options?.stopSequences,
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
      },
      this.retryConfig
    );
  }

  /**
   * Send a chat message with tool use
   */
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions
  ): Promise<ChatWithToolsResponse> {
    this.ensureInitialized();

    return withRetry(
      async () => {
        try {
          const response = await this.client!.chat.completions.create({
            model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
            max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
            temperature: options?.temperature ?? this.config.temperature ?? 0,
            messages: this.convertMessages(messages, options?.system),
            tools: this.convertTools(options.tools),
            tool_choice: this.convertToolChoice(options.toolChoice),
          });

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
      },
      this.retryConfig
    );
  }

  /**
   * Stream a chat response
   */
  async *stream(
    messages: Message[],
    options?: ChatOptions
  ): AsyncIterable<StreamChunk> {
    this.ensureInitialized();

    try {
      const stream = await this.client!.chat.completions.create({
        model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
        max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        temperature: options?.temperature ?? this.config.temperature ?? 0,
        messages: this.convertMessages(messages, options?.system),
        stream: true,
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
   * Count tokens (improved heuristic for OpenAI models)
   *
   * GPT models use a BPE tokenizer. The average ratio varies:
   * - English text: ~4 characters per token
   * - Code: ~3.3 characters per token (more syntax chars)
   * - Common words: Often 1 token per word
   *
   * For accurate counting, use tiktoken library.
   * This heuristic provides a reasonable estimate without the dependency.
   */
  countTokens(text: string): number {
    if (!text) return 0;

    // Count different character types
    const codePatterns = /[{}[\]();=<>!&|+\-*/]/g;
    const whitespacePattern = /\s/g;
    const wordPattern = /\b\w+\b/g;

    const codeChars = (text.match(codePatterns) || []).length;
    const whitespace = (text.match(whitespacePattern) || []).length;
    const words = (text.match(wordPattern) || []).length;

    // Estimate if text is code-like
    const isCodeLike = codeChars > text.length * 0.05;

    // Calculate base ratio
    let charsPerToken: number;
    if (isCodeLike) {
      charsPerToken = 3.3;
    } else if (whitespace > text.length * 0.3) {
      charsPerToken = 4.5;
    } else {
      charsPerToken = 4.0;
    }

    // Word-based estimate (GPT tends to have ~1.3 tokens per word)
    const wordBasedEstimate = words * 1.3;

    // Char-based estimate
    const charBasedEstimate = text.length / charsPerToken;

    // Use average of both methods
    return Math.ceil((wordBasedEstimate + charBasedEstimate) / 2);
  }

  /**
   * Get context window size
   */
  getContextWindow(): number {
    const model = this.config.model ?? DEFAULT_MODEL;
    return CONTEXT_WINDOWS[model] ?? 128000;
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.client) return false;

    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
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
    systemPrompt?: string
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
    choice: ChatWithToolsOptions["toolChoice"]
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
  private extractToolCalls(
    toolCalls?: OpenAI.ChatCompletionMessageToolCall[]
  ): ToolCall[] {
    if (!toolCalls) return [];

    return toolCalls
      .filter((tc): tc is OpenAI.ChatCompletionMessageToolCall & { type: "function" } =>
        tc.type === "function"
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
  private mapFinishReason(
    reason?: string | null
  ): ChatResponse["stopReason"] {
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

    throw new ProviderError(
      error instanceof Error ? error.message : String(error),
      {
        provider: this.id,
        cause: error instanceof Error ? error : undefined,
      }
    );
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
 */
export function createKimiProvider(config?: ProviderConfig): OpenAIProvider {
  const provider = new OpenAIProvider("kimi", "Kimi (Moonshot)");
  const kimiConfig: ProviderConfig = {
    ...config,
    baseUrl: config?.baseUrl ?? "https://api.moonshot.cn/v1",
    apiKey: config?.apiKey ?? process.env["KIMI_API_KEY"] ?? process.env["MOONSHOT_API_KEY"],
    model: config?.model ?? "moonshot-v1-8k",
  };
  if (kimiConfig.apiKey) {
    provider.initialize(kimiConfig).catch(() => {});
  }
  return provider;
}
