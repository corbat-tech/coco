/**
 * GitHub Copilot Provider for Corbat-Coco
 *
 * Extends OpenAIProvider since the Copilot API is fully OpenAI-compatible.
 * The main differences are:
 * - Authentication via GitHub Device Flow (not API key)
 * - Short-lived Copilot tokens that auto-refresh (~25 min)
 * - Custom headers required by the Copilot API
 * - Multiple model families (Claude, GPT, Gemini) available via subscription
 * - Codex/GPT-5+ models require the /responses endpoint instead of /chat/completions
 *
 * API endpoints:
 * - /chat/completions — Claude, Gemini, GPT-4.1
 * - /responses — GPT-5.x Codex models
 */

import OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses.js";
import { jsonrepair } from "jsonrepair";
import type {
  ProviderConfig,
  Message,
  MessageContent,
  ChatOptions,
  ChatResponse,
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  StreamChunk,
  ToolDefinition,
  ToolResultContent,
} from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { OpenAIProvider } from "./openai.js";
import { getValidCopilotToken } from "../auth/copilot.js";
import { withRetry, DEFAULT_RETRY_CONFIG } from "./retry.js";

/**
 * Context windows for models available via Copilot.
 *
 * NOTE: Copilot API uses dot-separated model names (claude-sonnet-4.6) while
 * the Anthropic API uses hyphenated names (claude-sonnet-4-6). These are
 * different model IDs for different endpoints — do not conflate them.
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  // Claude models
  "claude-sonnet-4.6": 200000,
  "claude-opus-4.6": 200000,
  "claude-sonnet-4.5": 200000,
  "claude-opus-4.5": 200000,
  "claude-haiku-4.5": 200000,
  // OpenAI models — chat/completions
  "gpt-4.1": 1048576,
  // OpenAI models — /responses API (Codex/GPT-5+)
  "gpt-5.3-codex": 400000,
  "gpt-5.2-codex": 400000,
  "gpt-5.1-codex-max": 400000,
  "gpt-5.2": 400000,
  "gpt-5.1": 400000,
  // Google models
  "gemini-3.1-pro-preview": 1000000,
  "gemini-3-flash-preview": 1000000,
  "gemini-2.5-pro": 1048576,
};

/**
 * Default model for Copilot
 */
const DEFAULT_MODEL = "claude-sonnet-4.6";

/**
 * Required headers for Copilot API requests.
 *
 * These identify the client to the Copilot API. The VS Code identifiers
 * are used because this is the well-known integration format expected by
 * the API (same approach as opencode, copilot-api, etc.).
 */
const COPILOT_HEADERS: Record<string, string> = {
  "Copilot-Integration-Id": "vscode-chat",
  "Editor-Version": "vscode/1.99.0",
  "Editor-Plugin-Version": "copilot-chat/0.26.7",
  "X-GitHub-Api-Version": "2025-04-01",
};

/**
 * Check if a model requires the Responses API (/responses) instead of
 * Chat Completions (/chat/completions).
 *
 * GPT-5+ and Codex models only support the Responses API.
 */
function needsResponsesApi(model: string): boolean {
  return (
    model.includes("codex") ||
    model.startsWith("gpt-5") ||
    model.startsWith("o4-") ||
    model.startsWith("o3-")
  );
}

/**
 * GitHub Copilot provider implementation.
 *
 * Extends OpenAIProvider to reuse all message conversion, tool handling,
 * streaming, and retry logic. Only overrides initialization (Copilot token
 * management) and adds automatic token refresh before each API call.
 *
 * For Codex/GPT-5+ models, routes requests through the Responses API
 * instead of Chat Completions.
 */
export class CopilotProvider extends OpenAIProvider {
  private baseUrl = "https://api.githubcopilot.com";
  private currentToken: string | null = null;
  /** In-flight refresh promise to prevent concurrent token exchanges */
  private refreshPromise: Promise<void> | null = null;

  constructor() {
    super("copilot", "GitHub Copilot");
  }

  /**
   * Initialize the provider with Copilot credentials.
   *
   * Gets a valid Copilot API token (from cache or by refreshing),
   * then creates an OpenAI client configured for the Copilot endpoint.
   */
  override async initialize(config: ProviderConfig): Promise<void> {
    this.config = {
      ...config,
      model: config.model ?? DEFAULT_MODEL,
    };

    // Try to get a valid Copilot token
    const tokenResult = await getValidCopilotToken();

    if (tokenResult) {
      this.currentToken = tokenResult.token;
      this.baseUrl = tokenResult.baseUrl;
    } else if (config.apiKey) {
      // Fallback: user provided a token directly (e.g., via GITHUB_TOKEN env var)
      this.currentToken = config.apiKey;
    }

    if (!this.currentToken) {
      throw new ProviderError(
        "No Copilot token found. Please authenticate with: coco --provider copilot",
        { provider: this.id },
      );
    }

    this.createCopilotClient();
  }

  /**
   * Create the OpenAI client configured for Copilot API
   */
  private createCopilotClient(): void {
    this.client = new OpenAI({
      apiKey: this.currentToken!,
      baseURL: this.config.baseUrl ?? this.baseUrl,
      timeout: this.config.timeout ?? 120000,
      defaultHeaders: COPILOT_HEADERS,
    });
  }

  /**
   * Refresh the Copilot token if expired.
   *
   * Uses a mutex so concurrent callers share a single in-flight token
   * exchange. The slot is cleared inside the IIFE's finally block,
   * which runs after all awaiting callers have resumed.
   */
  private async refreshTokenIfNeeded(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          const tokenResult = await getValidCopilotToken();
          if (tokenResult && tokenResult.isNew) {
            this.currentToken = tokenResult.token;
            this.baseUrl = tokenResult.baseUrl;
            this.createCopilotClient();
          }
        } finally {
          this.refreshPromise = null;
        }
      })();
    }
    await this.refreshPromise;
  }

  // --- Override public methods to add token refresh + Responses API routing ---

  override async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    await this.refreshTokenIfNeeded();
    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
    if (needsResponsesApi(model)) {
      return this.chatViaResponses(messages, options);
    }
    return super.chat(messages, options);
  }

  override async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    await this.refreshTokenIfNeeded();
    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
    if (needsResponsesApi(model)) {
      return this.chatWithToolsViaResponses(messages, options);
    }
    return super.chatWithTools(messages, options);
  }

  // Note: Token is refreshed before the stream starts but NOT mid-stream.
  // Copilot tokens last ~25 min. Very long streams may get a 401 mid-stream
  // which surfaces as a ProviderError. The retry layer handles re-attempts.

  override async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    await this.refreshTokenIfNeeded();
    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
    if (needsResponsesApi(model)) {
      yield* this.streamViaResponses(messages, options);
      return;
    }
    yield* super.stream(messages, options);
  }

  override async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    await this.refreshTokenIfNeeded();
    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
    if (needsResponsesApi(model)) {
      yield* this.streamWithToolsViaResponses(messages, options);
      return;
    }
    yield* super.streamWithTools(messages, options);
  }

  // --- Responses API implementations ---

  /**
   * Simple chat via Responses API (no tools)
   */
  private async chatViaResponses(
    messages: Message[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    this.ensureInitialized();

    return withRetry(async () => {
      try {
        const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
        const { input, instructions } = this.convertToResponsesInput(messages, options?.system);

        const response = await this.client!.responses.create({
          model,
          input,
          instructions: instructions ?? undefined,
          max_output_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: options?.temperature ?? this.config.temperature ?? 0,
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
    }, DEFAULT_RETRY_CONFIG);
  }

  /**
   * Chat with tools via Responses API
   */
  private async chatWithToolsViaResponses(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    this.ensureInitialized();

    return withRetry(async () => {
      try {
        const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
        const { input, instructions } = this.convertToResponsesInput(messages, options?.system);
        const tools = this.convertToolsForResponses(options.tools);

        const response = await this.client!.responses.create({
          model,
          input,
          instructions: instructions ?? undefined,
          tools,
          max_output_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: options?.temperature ?? this.config.temperature ?? 0,
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
              input: this.parseToolArguments(item.arguments),
            });
          }
        }

        return {
          id: response.id,
          content,
          stopReason: response.status === "completed" ? "end_turn" : "tool_use",
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
    }, DEFAULT_RETRY_CONFIG);
  }

  /**
   * Stream via Responses API (no tools)
   */
  private async *streamViaResponses(
    messages: Message[],
    options?: ChatOptions,
  ): AsyncIterable<StreamChunk> {
    this.ensureInitialized();

    try {
      const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
      const { input, instructions } = this.convertToResponsesInput(messages, options?.system);

      const stream = await this.client!.responses.create({
        model,
        input,
        instructions: instructions ?? undefined,
        max_output_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        temperature: options?.temperature ?? this.config.temperature ?? 0,
        store: false,
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield { type: "text", text: event.delta };
        } else if (event.type === "response.completed") {
          yield { type: "done", stopReason: "end_turn" };
        }
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Stream with tools via Responses API
   */
  private async *streamWithToolsViaResponses(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    this.ensureInitialized();

    try {
      const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
      const { input, instructions } = this.convertToResponsesInput(messages, options?.system);
      const tools = this.convertToolsForResponses(options.tools);

      const stream = await this.client!.responses.create({
        model,
        input,
        instructions: instructions ?? undefined,
        tools,
        max_output_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        temperature: options?.temperature ?? this.config.temperature ?? 0,
        store: false,
        stream: true,
      });

      // Track function call builders
      const fnCallBuilders: Map<string, { callId: string; name: string; arguments: string }> =
        new Map();

      for await (const event of stream) {
        switch (event.type) {
          case "response.output_text.delta":
            yield { type: "text", text: event.delta };
            break;

          case "response.output_item.added":
            if (event.item.type === "function_call") {
              const fc = event.item;
              fnCallBuilders.set(fc.call_id, {
                callId: fc.call_id,
                name: fc.name,
                arguments: "",
              });
              yield {
                type: "tool_use_start",
                toolCall: { id: fc.call_id, name: fc.name },
              };
            }
            break;

          case "response.function_call_arguments.delta":
            {
              const builder = fnCallBuilders.get(event.item_id);
              if (builder) {
                builder.arguments += event.delta;
              }
            }
            break;

          case "response.function_call_arguments.done":
            {
              const builder = fnCallBuilders.get(event.item_id);
              if (builder) {
                yield {
                  type: "tool_use_end",
                  toolCall: {
                    id: builder.callId,
                    name: builder.name,
                    input: this.parseToolArguments(event.arguments),
                  },
                };
                fnCallBuilders.delete(event.item_id);
              }
            }
            break;

          case "response.completed":
            {
              // Emit any remaining function calls that weren't finalized
              for (const [, builder] of fnCallBuilders) {
                yield {
                  type: "tool_use_end",
                  toolCall: {
                    id: builder.callId,
                    name: builder.name,
                    input: this.parseToolArguments(builder.arguments),
                  },
                };
              }
              fnCallBuilders.clear();

              const hasToolCalls = event.response.output.some((i) => i.type === "function_call");
              yield {
                type: "done",
                stopReason: hasToolCalls ? "tool_use" : "end_turn",
              };
            }
            break;
        }
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // --- Responses API helpers ---

  /**
   * Convert our internal messages to Responses API input format.
   *
   * The Responses API uses a flat array of input items (EasyInputMessage,
   * function_call, function_call_output) instead of the chat completions
   * messages array.
   */
  private convertToResponsesInput(
    messages: Message[],
    systemPrompt?: string,
  ): { input: Responses.ResponseInput; instructions: string | null } {
    const input: Responses.ResponseInput = [];
    let instructions: string | null = null;

    // System prompt goes to instructions field
    if (systemPrompt) {
      instructions = systemPrompt;
    }

    for (const msg of messages) {
      if (msg.role === "system") {
        // Additional system messages go as developer messages
        instructions = (instructions ? instructions + "\n\n" : "") + this.contentToStr(msg.content);
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
        } else {
          input.push({
            role: "user",
            content: this.contentToStr(msg.content),
          });
        }
      } else if (msg.role === "assistant") {
        if (typeof msg.content === "string") {
          input.push({
            role: "assistant",
            content: msg.content,
          });
        } else if (Array.isArray(msg.content)) {
          // Handle mixed text + tool_use blocks
          const textParts: string[] = [];

          for (const block of msg.content) {
            if (block.type === "text") {
              textParts.push(block.text);
            } else if (block.type === "tool_use") {
              // Emit any accumulated text first
              if (textParts.length > 0) {
                input.push({
                  role: "assistant",
                  content: textParts.join(""),
                });
                textParts.length = 0;
              }
              // Emit function_call item
              input.push({
                type: "function_call",
                call_id: block.id,
                name: block.name,
                arguments: JSON.stringify(block.input),
              });
            }
          }

          // Emit remaining text
          if (textParts.length > 0) {
            input.push({
              role: "assistant",
              content: textParts.join(""),
            });
          }
        }
      }
    }

    return { input, instructions };
  }

  /**
   * Convert our tool definitions to Responses API FunctionTool format
   */
  private convertToolsForResponses(tools: ToolDefinition[]): Responses.FunctionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description ?? undefined,
      parameters: tool.input_schema ?? null,
      strict: false,
    }));
  }

  /**
   * Parse tool call arguments with jsonrepair fallback
   */
  private parseToolArguments(args: string): Record<string, unknown> {
    try {
      return args ? JSON.parse(args) : {};
    } catch {
      try {
        if (args) {
          const repaired = jsonrepair(args);
          return JSON.parse(repaired);
        }
      } catch {
        console.error(`[${this.name}] Cannot parse tool arguments: ${args.slice(0, 200)}`);
      }
      return {};
    }
  }

  /**
   * Convert message content to string
   */
  private contentToStr(content: MessageContent): string {
    if (typeof content === "string") return content;
    return content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
  }

  // --- Override metadata methods ---

  /**
   * Count tokens (approximate — Copilot models vary in tokenizer)
   */
  override countTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Get context window for the current model
   */
  override getContextWindow(): number {
    const model = this.config.model ?? DEFAULT_MODEL;
    return CONTEXT_WINDOWS[model] ?? 128000;
  }

  /**
   * Check if Copilot credentials are available
   */
  override async isAvailable(): Promise<boolean> {
    try {
      const tokenResult = await getValidCopilotToken();
      return tokenResult !== null;
    } catch {
      return false;
    }
  }
}

/**
 * Create a Copilot provider
 */
export function createCopilotProvider(): CopilotProvider {
  return new CopilotProvider();
}
