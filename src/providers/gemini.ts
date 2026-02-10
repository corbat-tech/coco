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
const DEFAULT_MODEL = "gemini-3-flash-preview";

/**
 * Context windows for models
 * Updated February 2026 - Gemini 3 uses -preview suffix
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  // Gemini 3 series (latest, Jan 2026 - use -preview suffix)
  "gemini-3-flash-preview": 1000000,
  "gemini-3-pro-preview": 1000000,
  // Gemini 2.5 series (production stable)
  "gemini-2.5-pro-preview-05-06": 1048576,
  "gemini-2.5-flash-preview-05-20": 1048576,
  "gemini-2.5-pro": 1048576,
  "gemini-2.5-flash": 1048576,
  // Gemini 2.0 series (GA stable)
  "gemini-2.0-flash": 1048576,
  // Legacy
  "gemini-1.5-flash": 1000000,
  "gemini-1.5-pro": 2000000,
  "gemini-1.0-pro": 32000,
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
        systemInstruction: options?.system,
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
        systemInstruction: options?.system,
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
        systemInstruction: options?.system,
      });

      const { history, lastMessage } = this.convertMessages(messages);

      const chat = model.startChat({ history });
      const result = await chat.sendMessageStream(lastMessage);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield { type: "text", text };
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
        systemInstruction: options?.system,
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

      // Track emitted tool calls to avoid duplicates
      const emittedToolCalls = new Set<string>();

      for await (const chunk of result.stream) {
        // Handle text content
        const text = chunk.text();
        if (text) {
          yield { type: "text", text };
        }

        // Handle function calls in the chunk
        const candidate = chunk.candidates?.[0];
        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if ("functionCall" in part && part.functionCall) {
              const funcCall = part.functionCall;
              const sortedArgs = funcCall.args
                ? Object.keys(funcCall.args)
                    .sort()
                    .map(
                      (k) =>
                        `${k}:${JSON.stringify((funcCall.args as Record<string, unknown>)[k])}`,
                    )
                    .join(",")
                : "";
              const callKey = `${funcCall.name}-${sortedArgs}`;

              // Only emit if we haven't seen this exact call before
              if (!emittedToolCalls.has(callKey)) {
                emittedToolCalls.add(callKey);

                // For Gemini, function calls come complete in a single chunk
                // We emit start, then immediately end with the full data
                const toolCall: ToolCall = {
                  id: funcCall.name, // Gemini uses name as ID
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
      }

      yield { type: "done" };
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
   * Convert messages to Gemini format
   */
  private convertMessages(messages: Message[]): {
    history: Content[];
    lastMessage: string | Part[];
  } {
    const history: Content[] = [];
    let lastUserMessage: string | Part[] = "";

    for (const msg of messages) {
      if (msg.role === "system") {
        // System messages are handled via systemInstruction
        continue;
      }

      const parts = this.convertContent(msg.content);

      if (msg.role === "user") {
        // Check if this contains tool results
        if (Array.isArray(msg.content) && msg.content[0]?.type === "tool_result") {
          const functionResponses: Part[] = [];
          for (const block of msg.content) {
            if (block.type === "tool_result") {
              const toolResult = block as ToolResultContent;
              functionResponses.push({
                functionResponse: {
                  name: toolResult.tool_use_id, // Gemini uses name, we store it in tool_use_id
                  response: { result: toolResult.content },
                },
              });
            }
          }
          history.push({ role: "user", parts: functionResponses });
        } else {
          lastUserMessage = parts;
        }
      } else if (msg.role === "assistant") {
        history.push({ role: "model", parts });
      }
    }

    // Add last user message to history if it was followed by assistant
    // This handles multi-turn properly

    return { history, lastMessage: lastUserMessage };
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
      for (const part of candidate.content.parts) {
        if ("text" in part && part.text) {
          textContent += part.text;
        }
        if ("functionCall" in part && part.functionCall) {
          toolCalls.push({
            id: part.functionCall.name, // Use name as ID for Gemini
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
    const retryable = message.includes("429") || message.includes("500");

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
