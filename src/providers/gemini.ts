/**
 * Google Gemini provider for Corbat-Coco
 *
 * Supports multiple authentication methods:
 * 1. GEMINI_API_KEY environment variable (recommended)
 * 2. GOOGLE_API_KEY environment variable
 * 3. Google Cloud ADC (gcloud auth application-default login)
 */

import {
  GoogleGenerativeAI,
  FunctionCallingMode,
  type Content,
  type Part,
  type FunctionDeclaration,
  type Tool,
  type GenerateContentResult,
} from "@google/generative-ai";
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
import { getCachedADCToken } from "../auth/gcloud.js";

/**
 * Default model - Updated February 2026
 */
const DEFAULT_MODEL = "gemini-3.1-pro-preview";

/**
 * Context windows for models
 * Updated March 2026 — gemini-3-pro-preview deprecated March 9
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  // Gemini 3.1 series (latest)
  "gemini-3.1-pro-preview": 1000000,
  "gemini-3.1-flash-lite-preview": 1000000,
  // Gemini 3 series
  "gemini-3-flash-preview": 1000000,
  // Gemini 2.5 series (production stable)
  "gemini-2.5-pro": 1048576,
  "gemini-2.5-flash": 1048576,
  "gemini-2.5-flash-lite": 1048576,
  // Legacy
  "gemini-1.5-flash": 1000000,
  "gemini-1.5-pro": 2000000,
};

/**
 * Gemini provider implementation
 */
export class GeminiProvider implements LLMProvider {
  readonly id = "gemini";
  readonly name = "Google Gemini";

  private client: GoogleGenerativeAI | null = null;
  private config: ProviderConfig = {};

  /**
   * Initialize the provider
   *
   * Authentication priority:
   * 1. API key passed in config (unless it's the ADC marker)
   * 2. GEMINI_API_KEY environment variable
   * 3. GOOGLE_API_KEY environment variable
   * 4. Google Cloud ADC (gcloud auth application-default login)
   */
  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;

    // Check for ADC marker (set by onboarding when user chooses gcloud ADC)
    const isADCMarker = config.apiKey === "__gcloud_adc__";

    // Try explicit API keys first (unless it's the ADC marker)
    let apiKey =
      !isADCMarker && config.apiKey
        ? config.apiKey
        : (process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"]);

    // If no API key or ADC marker is set, try gcloud ADC
    if (!apiKey || isADCMarker) {
      try {
        const adcToken = await getCachedADCToken();
        if (adcToken) {
          apiKey = adcToken.accessToken;
          // Store that we're using ADC for refresh later
          this.config.useADC = true;
        }
      } catch {
        // ADC not available, continue without it
      }
    }

    if (!apiKey) {
      throw new ProviderError(
        "Gemini API key not provided. Set GEMINI_API_KEY or run: gcloud auth application-default login",
        { provider: this.id },
      );
    }

    this.client = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Refresh ADC token if needed and reinitialize client
   */
  private async refreshADCIfNeeded(): Promise<void> {
    if (!this.config.useADC) return;

    try {
      const adcToken = await getCachedADCToken();
      if (adcToken) {
        this.client = new GoogleGenerativeAI(adcToken.accessToken);
      }
    } catch {
      // Token refresh failed, continue with existing client
    }
  }

  /**
   * Send a chat message
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    this.ensureInitialized();
    await this.refreshADCIfNeeded();

    try {
      const model = this.client!.getGenerativeModel({
        model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
        generationConfig: {
          maxOutputTokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: options?.temperature ?? this.config.temperature ?? 0,
          stopSequences: options?.stopSequences,
        },
        systemInstruction: this.extractSystem(messages, options?.system),
      });

      const { history, lastMessage } = this.convertMessages(messages);

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage);

      return this.parseResponse(result);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Send a chat message with tool use
   */
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    this.ensureInitialized();
    await this.refreshADCIfNeeded();

    try {
      const tools: Tool[] = [
        {
          functionDeclarations: this.convertTools(options.tools),
        },
      ];

      const model = this.client!.getGenerativeModel({
        model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
        generationConfig: {
          maxOutputTokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: options?.temperature ?? this.config.temperature ?? 0,
        },
        systemInstruction: this.extractSystem(messages, options?.system),
        tools,
        toolConfig: {
          functionCallingConfig: {
            mode: this.convertToolChoice(options.toolChoice),
          },
        },
      });

      const { history, lastMessage } = this.convertMessages(messages);

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage);

      return this.parseResponseWithTools(result);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Stream a chat response
   */
  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    this.ensureInitialized();
    await this.refreshADCIfNeeded();

    try {
      const model = this.client!.getGenerativeModel({
        model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
        generationConfig: {
          maxOutputTokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: options?.temperature ?? this.config.temperature ?? 0,
        },
        systemInstruction: this.extractSystem(messages, options?.system),
      });

      const { history, lastMessage } = this.convertMessages(messages);

      const chat = model.startChat({ history });
      const result = await chat.sendMessageStream(lastMessage);

      let streamStopReason: StreamChunk["stopReason"];

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield { type: "text", text };
        }
        const finishReason = chunk.candidates?.[0]?.finishReason;
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
    await this.refreshADCIfNeeded();

    try {
      const tools: Tool[] = [
        {
          functionDeclarations: this.convertTools(options.tools),
        },
      ];

      const model = this.client!.getGenerativeModel({
        model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
        generationConfig: {
          maxOutputTokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: options?.temperature ?? this.config.temperature ?? 0,
        },
        systemInstruction: this.extractSystem(messages, options?.system),
        tools,
        toolConfig: {
          functionCallingConfig: {
            mode: this.convertToolChoice(options.toolChoice),
          },
        },
      });

      const { history, lastMessage } = this.convertMessages(messages);

      const chat = model.startChat({ history });
      const result = await chat.sendMessageStream(lastMessage);

      let streamStopReason: StreamChunk["stopReason"];
      let streamToolCallCounter = 0;

      for await (const chunk of result.stream) {
        // Handle text content
        const text = chunk.text();
        if (text) {
          yield { type: "text", text };
        }

        // Track finish reason
        const finishReason = chunk.candidates?.[0]?.finishReason;
        if (finishReason) {
          streamStopReason = this.mapFinishReason(finishReason);
        }

        // Handle function calls in the chunk
        const candidate = chunk.candidates?.[0];
        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if ("functionCall" in part && part.functionCall) {
              const funcCall = part.functionCall;
              // Gemini emits complete function calls per chunk (non-delta).
              // Keep repeated calls and assign stable unique IDs.
              streamToolCallCounter++;
              const toolCall: ToolCall = {
                id: `gemini_call_${streamToolCallCounter}`,
                name: funcCall.name,
                input: (funcCall.args ?? {}) as Record<string, unknown>,
              };

              yield {
                type: "tool_use_start",
                toolCall: {
                  id: toolCall.id,
                  name: toolCall.name,
                },
              };

              yield {
                type: "tool_use_end",
                toolCall,
              };
            }
          }
        }
      }

      yield { type: "done", stopReason: streamStopReason };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Count tokens (approximate)
   *
   * Gemini uses a SentencePiece tokenizer. The average ratio varies:
   * - English text: ~4 characters per token
   * - Code: ~3.2 characters per token
   * - Mixed content: ~3.5 characters per token
   *
   * Using 3.5 as the default provides a better estimate for typical
   * coding agent workloads which mix code and natural language.
   */
  countTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Get context window size
   */
  getContextWindow(): number {
    const model = this.config.model ?? DEFAULT_MODEL;
    return CONTEXT_WINDOWS[model] ?? 1000000;
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.client) return false;

    try {
      // Use configured model or fallback to default
      const modelName = this.config.model ?? DEFAULT_MODEL;
      const model = this.client.getGenerativeModel({ model: modelName });
      await model.generateContent("hi");
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
   * convertMessages() skips system-role messages ("handled via systemInstruction"),
   * but all callers forgot to also pass it via options.system. This helper bridges
   * that gap — mirrors the same fix applied to AnthropicProvider.
   */
  private extractSystem(messages: Message[], optionsSystem?: string): string | undefined {
    if (optionsSystem !== undefined) return optionsSystem;
    const systemMsg = messages.find((m) => m.role === "system");
    if (!systemMsg) return undefined;
    if (typeof systemMsg.content === "string") return systemMsg.content;
    // Array content: join all text blocks. Non-text blocks are skipped.
    const text = systemMsg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text || undefined;
  }

  /**
   * Convert messages to Gemini format
   */
  private convertMessages(messages: Message[]): {
    history: Content[];
    lastMessage: string | Part[];
  } {
    const toolNameByUseId = this.buildToolUseNameMap(messages);
    const conversation = messages.filter((m) => m.role !== "system");
    const history: Content[] = [];
    let lastUserMessage: string | Part[] = "";

    for (let i = 0; i < conversation.length; i++) {
      const msg = conversation[i]!;
      const isLastMessage = i === conversation.length - 1;

      if (msg.role === "user") {
        // Check if this contains tool results
        if (Array.isArray(msg.content) && msg.content[0]?.type === "tool_result") {
          const functionResponses: Part[] = [];
          for (const block of msg.content) {
            if (block.type === "tool_result") {
              const toolResult = block as ToolResultContent;
              functionResponses.push({
                functionResponse: {
                  // Gemini expects the function name in functionResponse.name.
                  // Recover it from prior assistant tool_use blocks when possible.
                  name: toolNameByUseId.get(toolResult.tool_use_id) ?? toolResult.tool_use_id,
                  response: { result: toolResult.content },
                },
              });
            }
          }
          // Gemini expects functionResponse parts under a "function" role entry.
          // Putting functionResponse in a user turn causes:
          // "Content with role 'user' contain 'functionResponse' part".
          history.push({ role: "function" as Content["role"], parts: functionResponses });

          if (isLastMessage) {
            // After a tool result as the final turn, send an empty user message
            // so the model can continue from the function response context.
            lastUserMessage = "";
          }
        } else {
          const parts = this.convertContent(msg.content);
          if (isLastMessage) {
            lastUserMessage = parts;
          } else {
            history.push({ role: "user", parts });
          }
        }
      } else if (msg.role === "assistant") {
        const parts = this.convertContent(msg.content);
        history.push({ role: "model", parts });
      }
    }

    return { history, lastMessage: lastUserMessage };
  }

  /**
   * Build a map from tool_use IDs to function names from assistant history.
   */
  private buildToolUseNameMap(messages: Message[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          map.set(block.id, block.name);
        }
      }
    }
    return map;
  }

  /**
   * Convert content to Gemini parts
   */
  private convertContent(content: MessageContent): Part[] {
    if (typeof content === "string") {
      return [{ text: content }];
    }

    const parts: Part[] = [];
    for (const block of content) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      } else if (block.type === "image") {
        const imgBlock = block as ImageContent;
        parts.push({
          inlineData: {
            data: imgBlock.source.data,
            mimeType: imgBlock.source.media_type,
          },
        });
      } else if (block.type === "tool_use") {
        parts.push({
          functionCall: {
            name: block.name,
            args: block.input,
          },
        });
      }
    }

    return parts.length > 0 ? parts : [{ text: "" }];
  }

  /**
   * Convert tools to Gemini format
   */
  private convertTools(tools: ToolDefinition[]): FunctionDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema as FunctionDeclaration["parameters"],
    }));
  }

  /**
   * Convert tool choice to Gemini format
   */
  private convertToolChoice(choice: ChatWithToolsOptions["toolChoice"]): FunctionCallingMode {
    if (!choice || choice === "auto") return FunctionCallingMode.AUTO;
    if (choice === "any") return FunctionCallingMode.ANY;
    return FunctionCallingMode.AUTO;
  }

  /**
   * Parse response from Gemini
   */
  private parseResponse(result: GenerateContentResult): ChatResponse {
    const response = result.response;
    const text = response.text();
    const usage = response.usageMetadata;

    return {
      id: `gemini-${Date.now()}`,
      content: text,
      stopReason: this.mapFinishReason(response.candidates?.[0]?.finishReason),
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      },
      model: this.config.model ?? DEFAULT_MODEL,
    };
  }

  /**
   * Parse response with tool calls from Gemini
   */
  private parseResponseWithTools(result: GenerateContentResult): ChatWithToolsResponse {
    const response = result.response;
    const candidate = response.candidates?.[0];
    const usage = response.usageMetadata;

    let textContent = "";
    const toolCalls: ToolCall[] = [];

    if (candidate?.content?.parts) {
      let toolIndex = 0;
      for (const part of candidate.content.parts) {
        if ("text" in part && part.text) {
          textContent += part.text;
        }
        if ("functionCall" in part && part.functionCall) {
          toolIndex++;
          toolCalls.push({
            id: `gemini_call_${toolIndex}`,
            name: part.functionCall.name,
            input: (part.functionCall.args ?? {}) as Record<string, unknown>,
          });
        }
      }
    }

    return {
      id: `gemini-${Date.now()}`,
      content: textContent,
      stopReason: toolCalls.length > 0 ? "tool_use" : this.mapFinishReason(candidate?.finishReason),
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      },
      model: this.config.model ?? DEFAULT_MODEL,
      toolCalls,
    };
  }

  /**
   * Map finish reason to our format
   */
  private mapFinishReason(reason?: string): ChatResponse["stopReason"] {
    switch (reason) {
      case "STOP":
        return "end_turn";
      case "MAX_TOKENS":
        return "max_tokens";
      case "SAFETY":
      case "RECITATION":
      case "OTHER":
        return "stop_sequence";
      default:
        return "end_turn";
    }
  }

  /**
   * Handle API errors
   */
  private handleError(error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    const msg = message.toLowerCase();

    // Determine if retryable based on status codes and message content
    let retryable = message.includes("429") || message.includes("500");

    // Non-retryable: quota/billing errors
    if (
      msg.includes("quota") ||
      msg.includes("billing") ||
      msg.includes("usage limit") ||
      msg.includes("insufficient quota")
    ) {
      retryable = false;
    }

    // Non-retryable: auth errors
    if (message.includes("401") || message.includes("403")) {
      retryable = false;
    }

    throw new ProviderError(message, {
      provider: this.id,
      retryable,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Create a Gemini provider
 */
export function createGeminiProvider(config?: ProviderConfig): GeminiProvider {
  const provider = new GeminiProvider();
  if (config) {
    provider.initialize(config).catch(() => {});
  }
  return provider;
}
