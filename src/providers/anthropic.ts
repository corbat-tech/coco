/**
 * Anthropic Claude provider for Corbat-Coco
 */

import Anthropic from "@anthropic-ai/sdk";
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
  TextContent,
  ImageContent,
  ToolUseContent,
  ToolResultContent,
} from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { withRetry, type RetryConfig, DEFAULT_RETRY_CONFIG } from "./retry.js";

/**
 * Default model - Updated February 2026
 */
const DEFAULT_MODEL = "claude-opus-4-6-20260115";

/**
 * Context windows for models
 * Updated February 2026 - Added Claude 4.6
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  // Claude 4.6 (latest, Jan 2026) - 200K-1M context, 128K output
  "claude-opus-4-6-20260115": 200000,
  // Claude 4.5 models (Nov 2025)
  "claude-opus-4-5-20251124": 200000,
  "claude-sonnet-4-5-20250929": 200000,
  "claude-haiku-4-5-20251001": 200000,
  // Claude 4.1 models
  "claude-opus-4-1-20250801": 200000,
  // Claude 4 models
  "claude-sonnet-4-20250514": 200000,
  "claude-opus-4-20250514": 200000,
  // Claude 3.7 models
  "claude-3-7-sonnet-20250219": 200000,
  // Claude 3.5 models
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-5-haiku-20241022": 200000,
  // Claude 3 models (legacy)
  "claude-3-opus-20240229": 200000,
  "claude-3-sonnet-20240229": 200000,
  "claude-3-haiku-20240307": 200000,
};

/**
 * Anthropic provider implementation
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly name = "Anthropic Claude";

  private client: Anthropic | null = null;
  private config: ProviderConfig = {};
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;

  /**
   * Initialize the provider
   */
  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;

    const apiKey = config.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      throw new ProviderError("Anthropic API key not provided", {
        provider: this.id,
      });
    }

    this.client = new Anthropic({
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

    return withRetry(async () => {
      try {
        const response = await this.client!.messages.create({
          model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
          max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: options?.temperature ?? this.config.temperature ?? 0,
          system: options?.system,
          messages: this.convertMessages(messages),
          stop_sequences: options?.stopSequences,
        });

        return {
          id: response.id,
          content: this.extractTextContent(response.content),
          stopReason: this.mapStopReason(response.stop_reason),
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
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
        const response = await this.client!.messages.create({
          model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
          max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: options?.temperature ?? this.config.temperature ?? 0,
          system: options?.system,
          messages: this.convertMessages(messages),
          tools: this.convertTools(options.tools),
          tool_choice: options.toolChoice ? this.convertToolChoice(options.toolChoice) : undefined,
        });

        const toolCalls = this.extractToolCalls(response.content);

        return {
          id: response.id,
          content: this.extractTextContent(response.content),
          stopReason: this.mapStopReason(response.stop_reason),
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
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
      const stream = await this.client!.messages.stream({
        model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
        max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        temperature: options?.temperature ?? this.config.temperature ?? 0,
        system: options?.system,
        messages: this.convertMessages(messages),
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          const delta = event.delta as { type: string; text?: string };
          if (delta.type === "text_delta" && delta.text) {
            yield { type: "text", text: delta.text };
          }
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
      const stream = await this.client!.messages.stream({
        model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
        max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        temperature: options?.temperature ?? this.config.temperature ?? 0,
        system: options?.system,
        messages: this.convertMessages(messages),
        tools: this.convertTools(options.tools),
        tool_choice: options.toolChoice ? this.convertToolChoice(options.toolChoice) : undefined,
      });

      // Track current tool call being built
      let currentToolCall: Partial<ToolCall> | null = null;
      let currentToolInputJson = "";

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const contentBlock = event.content_block as {
            type: string;
            id?: string;
            name?: string;
          };
          if (contentBlock.type === "tool_use") {
            currentToolCall = {
              id: contentBlock.id,
              name: contentBlock.name,
            };
            currentToolInputJson = "";
            yield {
              type: "tool_use_start",
              toolCall: { ...currentToolCall },
            };
          }
        } else if (event.type === "content_block_delta") {
          const delta = event.delta as {
            type: string;
            text?: string;
            partial_json?: string;
          };
          if (delta.type === "text_delta" && delta.text) {
            yield { type: "text", text: delta.text };
          } else if (delta.type === "input_json_delta" && delta.partial_json) {
            currentToolInputJson += delta.partial_json;
            yield {
              type: "tool_use_delta",
              toolCall: {
                ...currentToolCall,
              },
              text: delta.partial_json,
            };
          }
        } else if (event.type === "content_block_stop") {
          if (currentToolCall) {
            // Parse the accumulated JSON input
            try {
              currentToolCall.input = currentToolInputJson ? JSON.parse(currentToolInputJson) : {};
            } catch {
              console.warn(
                `[Anthropic] Failed to parse tool call arguments: ${currentToolInputJson?.slice(0, 100)}`,
              );
              currentToolCall.input = {};
            }
            yield {
              type: "tool_use_end",
              toolCall: { ...currentToolCall } as ToolCall,
            };
            currentToolCall = null;
            currentToolInputJson = "";
          }
        }
      }

      yield { type: "done" };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Count tokens (improved heuristic for Claude models)
   *
   * Claude uses a BPE tokenizer similar to GPT models. The average ratio varies:
   * - English text: ~4.5 characters per token
   * - Code: ~3.5 characters per token
   * - Whitespace-heavy: ~5 characters per token
   *
   * This heuristic analyzes the text to provide a better estimate.
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
      charsPerToken = 3.5;
    } else if (whitespace > text.length * 0.3) {
      charsPerToken = 5.0;
    } else {
      charsPerToken = 4.5;
    }

    // Word-based estimate (backup)
    const wordBasedEstimate = words * 1.3;

    // Char-based estimate
    const charBasedEstimate = text.length / charsPerToken;

    // Use average of both methods for better accuracy
    return Math.ceil((wordBasedEstimate + charBasedEstimate) / 2);
  }

  /**
   * Get context window size
   */
  getContextWindow(): number {
    const model = this.config.model ?? DEFAULT_MODEL;
    return CONTEXT_WINDOWS[model] ?? 200000;
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.client) return false;

    try {
      // Try a minimal request
      await this.client.messages.create({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
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
   * Convert messages to Anthropic format
   */
  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages
      .filter((m) => m.role !== "system") // System is handled separately
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: this.convertContent(m.content),
      }));
  }

  /**
   * Convert message content to Anthropic format
   */
  private convertContent(content: MessageContent): string | Anthropic.ContentBlockParam[] {
    if (typeof content === "string") {
      return content;
    }

    return content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: (block as TextContent).text };
      }
      if (block.type === "tool_use") {
        const toolUse = block as ToolUseContent;
        return {
          type: "tool_use" as const,
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        };
      }
      if (block.type === "tool_result") {
        const toolResult = block as ToolResultContent;
        return {
          type: "tool_result" as const,
          tool_use_id: toolResult.tool_use_id,
          content: toolResult.content,
          is_error: toolResult.is_error,
        };
      }
      if (block.type === "image") {
        const imageBlock = block as ImageContent;
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: imageBlock.source.media_type as
              | "image/png"
              | "image/jpeg"
              | "image/gif"
              | "image/webp",
            data: imageBlock.source.data,
          },
        };
      }
      return { type: "text" as const, text: "" };
    });
  }

  /**
   * Convert tools to Anthropic format
   */
  private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
    }));
  }

  /**
   * Convert tool choice to Anthropic format
   */
  private convertToolChoice(
    choice: ChatWithToolsOptions["toolChoice"],
  ): Anthropic.MessageCreateParams["tool_choice"] {
    if (choice === "auto") return { type: "auto" };
    if (choice === "any") return { type: "any" };
    if (typeof choice === "object" && choice.type === "tool") {
      return { type: "tool", name: choice.name };
    }
    return { type: "auto" };
  }

  /**
   * Extract text content from response
   */
  private extractTextContent(content: Anthropic.ContentBlock[]): string {
    return content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  /**
   * Extract tool calls from response
   */
  private extractToolCalls(content: Anthropic.ContentBlock[]): ToolCall[] {
    return content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      }));
  }

  /**
   * Map stop reason to our format
   */
  private mapStopReason(reason: string | null): ChatResponse["stopReason"] {
    switch (reason) {
      case "end_turn":
        return "end_turn";
      case "max_tokens":
        return "max_tokens";
      case "stop_sequence":
        return "stop_sequence";
      case "tool_use":
        return "tool_use";
      default:
        return "end_turn";
    }
  }

  /**
   * Handle API errors
   */
  private handleError(error: unknown): never {
    if (error instanceof Anthropic.APIError) {
      const retryable = error.status === 429 || error.status >= 500;
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
 * Create an Anthropic provider
 */
export function createAnthropicProvider(config?: ProviderConfig): AnthropicProvider {
  const provider = new AnthropicProvider();
  if (config) {
    provider.initialize(config).catch(() => {
      // Initialization will be handled when first method is called
    });
  }
  return provider;
}
