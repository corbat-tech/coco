/**
 * Anthropic Claude provider for Corbat-Coco
 */

import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
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
import { getLogger } from "../utils/logger.js";

/**
 * Default model - Updated February 2026
 */
const DEFAULT_MODEL = "claude-opus-4-6";

/**
 * Context windows for models
 * Updated March 2026
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  // Kimi Code model (Anthropic-compatible endpoint)
  "kimi-for-coding": 131072,
  // Claude 4.6 (latest) — 200K standard, 1M beta
  "claude-opus-4-6": 200000,
  "claude-sonnet-4-6": 200000,
  // Claude 4.5 models
  "claude-opus-4-5-20251101": 200000,
  "claude-sonnet-4-5-20250929": 200000,
  "claude-haiku-4-5-20251001": 200000,
  // Claude 4.1 models
  "claude-opus-4-1-20250805": 200000,
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
  readonly id: string;
  readonly name: string;

  private client: Anthropic | null = null;
  private config: ProviderConfig = {};
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;

  constructor(id = "anthropic", name = "Anthropic Claude") {
    this.id = id;
    this.name = name;
  }

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
          system: this.extractSystem(messages, options?.system),
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
          system: this.extractSystem(messages, options?.system),
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
      const stream = await this.client!.messages.stream(
        {
          model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
          max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: options?.temperature ?? this.config.temperature ?? 0,
          system: this.extractSystem(messages, options?.system),
          messages: this.convertMessages(messages),
        },
        { signal: options?.signal },
      );

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
          timeoutController.abort();
        }
      }, 5000);

      // Abort the underlying stream when timeout fires
      timeoutController.signal.addEventListener("abort", () => stream.controller.abort(), {
        once: true,
      });

      try {
        let streamStopReason: StreamChunk["stopReason"];

        for await (const event of stream) {
          lastActivityTime = Date.now();

          if (event.type === "content_block_delta") {
            const delta = event.delta as { type: string; text?: string };
            if (delta.type === "text_delta" && delta.text) {
              yield { type: "text", text: delta.text };
            }
          } else if (event.type === "message_delta") {
            const delta = event.delta as { stop_reason?: string };
            if (delta.stop_reason) {
              streamStopReason = this.mapStopReason(delta.stop_reason);
            }
          }
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
      const stream = await this.client!.messages.stream(
        {
          model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
          max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: options?.temperature ?? this.config.temperature ?? 0,
          system: this.extractSystem(messages, options?.system),
          messages: this.convertMessages(messages),
          tools: this.convertTools(options.tools),
          tool_choice: options.toolChoice ? this.convertToolChoice(options.toolChoice) : undefined,
        },
        { signal: options?.signal },
      );

      // Track current tool call being built
      let currentToolCall: Partial<ToolCall> | null = null;
      let currentToolInputJson = "";

      // Activity-based timeout: abort the stream if no events for streamTimeout ms.
      // Uses AbortController to safely break the for-await loop (see stream() comment).
      const streamTimeout = this.config.timeout ?? 120000;
      let lastActivityTime = Date.now();
      const timeoutController = new AbortController();

      const timeoutInterval = setInterval(() => {
        if (Date.now() - lastActivityTime > streamTimeout) {
          clearInterval(timeoutInterval);
          timeoutController.abort();
        }
      }, 5000);

      timeoutController.signal.addEventListener("abort", () => stream.controller.abort(), {
        once: true,
      });

      try {
        let streamStopReason: StreamChunk["stopReason"];

        for await (const event of stream) {
          lastActivityTime = Date.now();

          if (event.type === "message_delta") {
            const delta = event.delta as { stop_reason?: string };
            if (delta.stop_reason) {
              streamStopReason = this.mapStopReason(delta.stop_reason);
            }
          } else if (event.type === "content_block_start") {
            const contentBlock = event.content_block as {
              type: string;
              id?: string;
              name?: string;
            };
            if (contentBlock.type === "tool_use") {
              // Guard: if a previous tool call was never closed (missing content_block_stop),
              // finalize it now to prevent argument data bleeding into the next tool call.
              if (currentToolCall) {
                getLogger().warn(
                  `[Anthropic] content_block_stop missing for tool '${currentToolCall.name}' — finalizing early to prevent data bleed.`,
                );
                try {
                  currentToolCall.input = currentToolInputJson
                    ? JSON.parse(currentToolInputJson)
                    : {};
                } catch {
                  currentToolCall.input = {};
                }
                yield {
                  type: "tool_use_end",
                  toolCall: { ...currentToolCall } as ToolCall,
                };
              }
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
                currentToolCall.input = currentToolInputJson
                  ? JSON.parse(currentToolInputJson)
                  : {};
              } catch {
                // Try to repair malformed JSON (e.g. unescaped newlines/quotes in content)
                let repaired = false;
                if (currentToolInputJson) {
                  try {
                    currentToolCall.input = JSON.parse(jsonrepair(currentToolInputJson));
                    repaired = true;
                    getLogger().debug(`Repaired JSON for tool ${currentToolCall.name}`);
                  } catch {
                    // repair also failed — fall through
                  }
                }
                if (!repaired) {
                  getLogger().warn(
                    `Failed to parse tool call arguments for ${currentToolCall.name}: ${currentToolInputJson?.slice(0, 300)}`,
                  );
                  currentToolCall.input = {};
                }
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

        yield { type: "done", stopReason: streamStopReason };
      } finally {
        clearInterval(timeoutInterval);
      }

      if (timeoutController.signal.aborted) {
        throw new Error(`Stream timeout: No response from LLM for ${streamTimeout / 1000}s`);
      }
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
   * Extract system prompt from messages array or options.
   *
   * The agent-loop passes the system message as the first element of the
   * messages array (role: "system"). convertMessages() strips it out because
   * Anthropic requires it as a top-level parameter — but all callers forgot
   * to also pass it via options.system. This helper bridges that gap.
   */
  private extractSystem(messages: Message[], optionsSystem?: string): string | undefined {
    if (optionsSystem !== undefined) return optionsSystem;
    const systemMsg = messages.find((m) => m.role === "system");
    if (!systemMsg) return undefined;
    if (typeof systemMsg.content === "string") return systemMsg.content;
    // Array content: join all text blocks into a single string. Non-text blocks
    // (e.g. images) are skipped — Anthropic system supports text only today.
    const text = systemMsg.content
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text || undefined;
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
      const msg = error.message.toLowerCase();
      let retryable = error.status === 429 || error.status >= 500;

      // Non-retryable: quota/billing errors
      if (
        msg.includes("usage limit") ||
        msg.includes("quota") ||
        msg.includes("billing") ||
        msg.includes("insufficient funds")
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

    // Handle non-Anthropic errors
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      const isQuotaError =
        msg.includes("usage limit") || msg.includes("quota") || msg.includes("billing");

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

/**
 * Create a Kimi Code provider (Anthropic-compatible)
 *
 * Uses Kimi's Anthropic-compatible endpoint, which is what Kimi officially
 * recommends for Claude Code and other Anthropic-SDK-based agents.
 * The subscription key is obtained from https://www.kimi.com/code
 *
 * Endpoint: https://api.kimi.com/coding  (Anthropic SDK appends /v1/messages)
 */
export function createKimiCodeProvider(config?: ProviderConfig): AnthropicProvider {
  const provider = new AnthropicProvider("kimi-code", "Kimi Code");
  const kimiCodeConfig: ProviderConfig = {
    ...config,
    baseUrl: config?.baseUrl ?? process.env["KIMI_CODE_BASE_URL"] ?? "https://api.kimi.com/coding",
    apiKey: config?.apiKey ?? process.env["KIMI_CODE_API_KEY"],
    model: config?.model ?? "kimi-for-coding",
  };
  if (kimiCodeConfig.apiKey) {
    provider.initialize(kimiCodeConfig).catch(() => {
      // Initialization will be handled when first method is called
    });
  }
  return provider;
}
