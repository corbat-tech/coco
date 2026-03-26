/**
 * OpenAI Codex Provider for Corbat-Coco
 *
 * Uses ChatGPT Plus/Pro subscription via OAuth authentication.
 * This provider connects to the Codex API endpoint (chatgpt.com/backend-api/codex)
 * which is different from the standard OpenAI API (api.openai.com).
 *
 * Authentication:
 * - Uses OAuth tokens obtained via browser-based PKCE flow
 * - Tokens are stored in ~/.coco/tokens/openai.json
 * - Supports automatic token refresh
 */

import type {
  LLMProvider,
  ProviderConfig,
  Message,
  ChatOptions,
  ChatResponse,
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  StreamChunk,
  ToolDefinition,
  ToolUseContent,
  ToolResultContent,
} from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { getValidAccessToken } from "../auth/index.js";
import { withRetry, type RetryConfig, DEFAULT_RETRY_CONFIG } from "./retry.js";
import { ResponsesToolCallAssembler, parseToolCallArguments } from "./tool-call-normalizer.js";

/**
 * Codex API endpoint (ChatGPT backend)
 */
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

/**
 * Default model for Codex (via ChatGPT Plus/Pro subscription)
 * Note: ChatGPT subscription uses different models than the API
 * Updated March 2026
 */
const DEFAULT_MODEL = "gpt-5.4-codex";

/**
 * Context windows for Codex models (ChatGPT Plus/Pro)
 * These are the models available via the chatgpt.com/backend-api/codex endpoint
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-5.4-codex": 200000,
  "gpt-5.3-codex": 200000,
  "gpt-5.2-codex": 200000,
  "gpt-5-codex": 200000,
  "gpt-5.1-codex": 200000,
  "gpt-5": 200000,
  "gpt-5.2": 200000,
  "gpt-5.1": 200000,
};

/**
 * Stream timeout in milliseconds
 */
const STREAM_TIMEOUT_MS = 120000;

/**
 * Parse JWT token to extract claims
 */
function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return undefined;
  }
}

/**
 * Extract ChatGPT account ID from token claims
 */
function extractAccountId(accessToken: string): string | undefined {
  const claims = parseJwtClaims(accessToken);
  if (!claims) return undefined;

  // Try different claim locations
  const auth = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
  return (
    (claims["chatgpt_account_id"] as string) ||
    (auth?.["chatgpt_account_id"] as string) ||
    (claims["organizations"] as Array<{ id: string }> | undefined)?.[0]?.id
  );
}

// --- Responses API input types (raw fetch, no SDK) ---

interface ResponsesInputMessage {
  role: string;
  content: string | Array<{ type: string; text: string }>;
}

interface ResponsesFunctionCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

interface ResponsesFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

type ResponsesInputItem =
  | ResponsesInputMessage
  | ResponsesFunctionCall
  | ResponsesFunctionCallOutput;

/**
 * Codex provider implementation
 * Uses ChatGPT Plus/Pro subscription via OAuth
 */
export class CodexProvider implements LLMProvider {
  readonly id = "codex";
  readonly name = "OpenAI Codex (ChatGPT Plus/Pro)";

  private config: ProviderConfig = {};
  private accessToken: string | null = null;
  private accountId: string | undefined;
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;

  /**
   * Initialize the provider with OAuth tokens
   */
  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;

    // Try to load OAuth tokens
    const tokenResult = await getValidAccessToken("openai");
    if (tokenResult) {
      this.accessToken = tokenResult.accessToken;
      this.accountId = extractAccountId(tokenResult.accessToken);
    } else if (config.apiKey) {
      // Fallback to provided API key (might be an OAuth token)
      this.accessToken = config.apiKey;
      this.accountId = extractAccountId(config.apiKey);
    }

    if (!this.accessToken) {
      throw new ProviderError(
        "No OAuth token found. Please run authentication first with: coco --provider openai",
        { provider: this.id },
      );
    }
  }

  /**
   * Ensure provider is initialized
   */
  private ensureInitialized(): void {
    if (!this.accessToken) {
      throw new ProviderError("Provider not initialized", {
        provider: this.id,
      });
    }
  }

  /**
   * Get context window size for a model
   */
  getContextWindow(model?: string): number {
    const m = model ?? this.config.model ?? DEFAULT_MODEL;
    return CONTEXT_WINDOWS[m] ?? 128000;
  }

  /**
   * Count tokens in text (approximate)
   * Uses GPT-4 approximation: ~4 chars per token
   */
  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if provider is available (has valid OAuth tokens)
   */
  async isAvailable(): Promise<boolean> {
    try {
      const tokenResult = await getValidAccessToken("openai");
      return tokenResult !== null;
    } catch {
      return false;
    }
  }

  /**
   * Make a request to the Codex API
   */
  private async makeRequest(body: Record<string, unknown>): Promise<Response> {
    this.ensureInitialized();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.accessToken}`,
    };

    // Add account ID if available (required for organization subscriptions)
    if (this.accountId) {
      headers["ChatGPT-Account-Id"] = this.accountId;
    }

    const response = await fetch(CODEX_API_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError(`Codex API error: ${response.status} - ${errorText}`, {
        provider: this.id,
        statusCode: response.status,
      });
    }

    return response;
  }

  /**
   * Extract text content from a message
   */
  private contentToString(content: Message["content"]): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((part) => part.type === "text")
        .map((part) => (part as { text: string }).text)
        .join("\n");
    }
    return "";
  }

  /**
   * Convert messages to Responses API input format.
   *
   * Handles:
   * - system messages → extracted as instructions
   * - user text messages → { role: "user", content: "..." }
   * - user tool_result messages → function_call_output items
   * - assistant text → { role: "assistant", content: "..." }
   * - assistant tool_use → function_call items
   */
  private convertToResponsesInput(
    messages: Message[],
    systemPrompt?: string,
  ): { input: ResponsesInputItem[]; instructions: string | null } {
    const input: ResponsesInputItem[] = [];
    let instructions: string | null = systemPrompt ?? null;

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
        } else {
          // Note: image blocks are silently dropped — Codex backend does not support images.
          // contentToString extracts only text parts, which is the safe fallback.
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
              const tu = block as ToolUseContent;
              input.push({
                type: "function_call",
                call_id: tu.id,
                name: tu.name,
                arguments: JSON.stringify(tu.input),
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
   * Convert tool definitions to Responses API function tool format
   */
  private convertTools(tools: ToolDefinition[]): Array<{
    type: "function";
    name: string;
    description?: string;
    parameters: unknown;
    strict: boolean;
  }> {
    return tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description ?? undefined,
      parameters: tool.input_schema ?? null,
      strict: false,
    }));
  }

  /**
   * Build the request body for the Codex Responses API
   */
  private buildRequestBody(
    model: string,
    input: ResponsesInputItem[],
    instructions: string | null,
    options?: { tools?: ToolDefinition[]; maxTokens?: number; temperature?: number },
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      input,
      instructions: instructions ?? "You are a helpful coding assistant.",
      store: false,
      stream: true, // Codex API requires streaming
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = this.convertTools(options.tools);
    }

    return body;
  }

  /**
   * Read SSE stream and call handler for each parsed event.
   * Returns when stream ends.
   */
  private async readSSEStream(
    response: Response,
    onEvent: (event: Record<string, unknown>) => void,
  ): Promise<void> {
    if (!response.body) {
      throw new ProviderError("No response body from Codex API", { provider: this.id });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Activity-based timeout using AbortController
    let lastActivityTime = Date.now();
    const timeoutController = new AbortController();

    const timeoutInterval = setInterval(() => {
      if (Date.now() - lastActivityTime > STREAM_TIMEOUT_MS) {
        clearInterval(timeoutInterval);
        timeoutController.abort();
      }
    }, 5000);

    try {
      while (true) {
        if (timeoutController.signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        lastActivityTime = Date.now();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          try {
            onEvent(JSON.parse(data));
          } catch {
            // Invalid JSON, skip
          }
        }
      }
    } finally {
      clearInterval(timeoutInterval);
      reader.releaseLock();
    }

    if (timeoutController.signal.aborted) {
      throw new Error(
        `Stream timeout: No response from Codex API for ${STREAM_TIMEOUT_MS / 1000}s`,
      );
    }
  }

  /**
   * Send a chat message using Codex Responses API format
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    return withRetry(async () => {
      const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
      const { input, instructions } = this.convertToResponsesInput(messages, options?.system);
      const body = this.buildRequestBody(model, input, instructions, {
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
      });

      const response = await this.makeRequest(body);

      let content = "";
      let responseId = `codex-${Date.now()}`;
      let inputTokens = 0;
      let outputTokens = 0;
      let status = "completed";

      await this.readSSEStream(response, (event) => {
        if (event.id) responseId = event.id as string;

        if (event.type === "response.output_text.delta" && event.delta) {
          content += event.delta as string;
        } else if (event.type === "response.output_text.done" && event.text) {
          content = event.text as string;
        } else if (event.type === "response.completed" && event.response) {
          const resp = event.response as Record<string, unknown>;
          const usage = resp.usage as Record<string, number> | undefined;
          if (usage) {
            inputTokens = usage.input_tokens ?? 0;
            outputTokens = usage.output_tokens ?? 0;
          }
          status = (resp.status as string) ?? "completed";
        }
      });

      const stopReason =
        status === "completed"
          ? ("end_turn" as const)
          : status === "incomplete"
            ? ("max_tokens" as const)
            : ("end_turn" as const);

      return {
        id: responseId,
        content,
        stopReason,
        model,
        usage: { inputTokens, outputTokens },
      };
    }, this.retryConfig);
  }

  /**
   * Send a chat message with tool use via Responses API
   */
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    return withRetry(async () => {
      const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
      const { input, instructions } = this.convertToResponsesInput(messages, options?.system);
      const body = this.buildRequestBody(model, input, instructions, {
        tools: options.tools,
        maxTokens: options?.maxTokens,
      });

      const response = await this.makeRequest(body);

      let content = "";
      let responseId = `codex-${Date.now()}`;
      let inputTokens = 0;
      let outputTokens = 0;
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      const toolCallAssembler = new ResponsesToolCallAssembler();

      await this.readSSEStream(response, (event) => {
        if (event.id) responseId = event.id as string;

        switch (event.type) {
          case "response.output_text.delta":
            content += (event.delta as string) ?? "";
            break;

          case "response.output_text.done":
            content = (event.text as string) ?? content;
            break;

          case "response.output_item.added": {
            toolCallAssembler.onOutputItemAdded({
              output_index: event.output_index as number | undefined,
              item: event.item as {
                type?: string;
                id?: string;
                call_id?: string;
                name?: string;
                arguments?: string;
              },
            });
            break;
          }

          case "response.function_call_arguments.delta": {
            toolCallAssembler.onArgumentsDelta({
              item_id: event.item_id as string | undefined,
              output_index: event.output_index as number | undefined,
              delta: event.delta as string | undefined,
            });
            break;
          }

          case "response.function_call_arguments.done": {
            const toolCall = toolCallAssembler.onArgumentsDone(
              {
                item_id: event.item_id as string | undefined,
                output_index: event.output_index as number | undefined,
                arguments: event.arguments as string | undefined,
              },
              this.name,
            );
            if (toolCall) {
              toolCalls.push({
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.input,
              });
            }
            break;
          }

          case "response.completed": {
            const resp = event.response as Record<string, unknown>;
            const usage = resp.usage as Record<string, number> | undefined;
            if (usage) {
              inputTokens = usage.input_tokens ?? 0;
              outputTokens = usage.output_tokens ?? 0;
            }
            for (const toolCall of toolCallAssembler.finalizeAll(this.name)) {
              toolCalls.push({
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.input,
              });
            }
            break;
          }
        }
      });

      return {
        id: responseId,
        content,
        stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
        model,
        usage: { inputTokens, outputTokens },
        toolCalls,
      };
    }, this.retryConfig);
  }

  /**
   * Stream a chat response (no tools)
   */
  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
    const { input, instructions } = this.convertToResponsesInput(messages, options?.system);
    const body = this.buildRequestBody(model, input, instructions, {
      maxTokens: options?.maxTokens,
    });

    const response = await this.makeRequest(body);

    if (!response.body) {
      throw new ProviderError("No response body from Codex API", { provider: this.id });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastActivityTime = Date.now();
    const timeoutController = new AbortController();

    const timeoutInterval = setInterval(() => {
      if (Date.now() - lastActivityTime > STREAM_TIMEOUT_MS) {
        clearInterval(timeoutInterval);
        timeoutController.abort();
      }
    }, 5000);

    try {
      while (true) {
        if (timeoutController.signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        lastActivityTime = Date.now();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const event = JSON.parse(data);

            if (event.type === "response.output_text.delta" && event.delta) {
              yield { type: "text", text: event.delta };
            } else if (event.type === "response.completed") {
              yield { type: "done", stopReason: "end_turn" };
            }
          } catch {
            // Invalid JSON, skip
          }
        }
      }
    } finally {
      clearInterval(timeoutInterval);
      reader.releaseLock();
    }

    if (timeoutController.signal.aborted) {
      throw new Error(
        `Stream timeout: No response from Codex API for ${STREAM_TIMEOUT_MS / 1000}s`,
      );
    }
  }

  /**
   * Stream a chat response with tool use via Responses API.
   *
   * IMPORTANT: fnCallBuilders is keyed by output item ID (item.id), NOT by
   * call_id. The streaming events (function_call_arguments.delta/done) use
   * item_id which references the output item's id field, not call_id.
   */
  async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;
    const { input, instructions } = this.convertToResponsesInput(messages, options?.system);
    const body = this.buildRequestBody(model, input, instructions, {
      tools: options.tools,
      maxTokens: options?.maxTokens,
    });

    const response = await this.makeRequest(body);

    if (!response.body) {
      throw new ProviderError("No response body from Codex API", { provider: this.id });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const toolCallAssembler = new ResponsesToolCallAssembler();
    const emittedToolCallIds = new Set<string>();
    const emittedToolCallSignatures = new Set<string>();

    // Activity-based timeout using AbortController (safe for async generators)
    let lastActivityTime = Date.now();
    const timeoutController = new AbortController();

    const timeoutInterval = setInterval(() => {
      if (Date.now() - lastActivityTime > STREAM_TIMEOUT_MS) {
        clearInterval(timeoutInterval);
        timeoutController.abort();
      }
    }, 5000);

    try {
      while (true) {
        if (timeoutController.signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        lastActivityTime = Date.now();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          switch (event.type) {
            case "response.output_text.delta":
              yield { type: "text", text: (event.delta as string) ?? "" };
              break;

            case "response.output_item.added": {
              const start = toolCallAssembler.onOutputItemAdded({
                output_index: event.output_index as number | undefined,
                item: event.item as {
                  type?: string;
                  id?: string;
                  call_id?: string;
                  name?: string;
                  arguments?: string;
                },
              });
              if (start) {
                yield {
                  type: "tool_use_start",
                  toolCall: { id: start.id, name: start.name },
                };
              }
              break;
            }

            case "response.function_call_arguments.delta": {
              toolCallAssembler.onArgumentsDelta({
                item_id: event.item_id as string | undefined,
                output_index: event.output_index as number | undefined,
                delta: event.delta as string | undefined,
              });
              break;
            }

            case "response.function_call_arguments.done": {
              const toolCall = toolCallAssembler.onArgumentsDone(
                {
                  item_id: event.item_id as string | undefined,
                  output_index: event.output_index as number | undefined,
                  arguments: event.arguments as string | undefined,
                },
                this.name,
              );
              if (toolCall) {
                if (toolCall.id) emittedToolCallIds.add(toolCall.id);
                const signature = `${toolCall.name}:${JSON.stringify(toolCall.input ?? {})}`;
                emittedToolCallSignatures.add(signature);
                yield {
                  type: "tool_use_end",
                  toolCall: {
                    id: toolCall.id,
                    name: toolCall.name,
                    input: toolCall.input,
                  },
                };
              }
              break;
            }

            case "response.completed": {
              // Emit any remaining function calls not finalized via done events
              for (const toolCall of toolCallAssembler.finalizeAll(this.name)) {
                if (toolCall.id) emittedToolCallIds.add(toolCall.id);
                const signature = `${toolCall.name}:${JSON.stringify(toolCall.input ?? {})}`;
                emittedToolCallSignatures.add(signature);
                yield {
                  type: "tool_use_end",
                  toolCall: {
                    id: toolCall.id,
                    name: toolCall.name,
                    input: toolCall.input,
                  },
                };
              }

              const responsePayload = event.response as
                | {
                    output?: Array<{
                      type?: string;
                      call_id?: string;
                      name?: string;
                      arguments?: string;
                    }>;
                  }
                | undefined;
              const output =
                (responsePayload?.output as Array<{
                  type?: string;
                  call_id?: string;
                  name?: string;
                  arguments?: string;
                }>) ?? [];

              // Fallback: some compatible backends include function calls in
              // response.completed.output but may skip the granular done events.
              for (const item of output) {
                if (item.type !== "function_call" || !item.call_id || !item.name) continue;
                const parsedInput = parseToolCallArguments(item.arguments ?? "{}", this.name);
                const signature = `${item.name}:${JSON.stringify(parsedInput ?? {})}`;
                if (
                  emittedToolCallIds.has(item.call_id) ||
                  emittedToolCallSignatures.has(signature)
                ) {
                  continue;
                }
                emittedToolCallIds.add(item.call_id);
                emittedToolCallSignatures.add(signature);
                yield {
                  type: "tool_use_end",
                  toolCall: {
                    id: item.call_id,
                    name: item.name,
                    input: parsedInput,
                  },
                };
              }

              const hasToolCalls = output.some((i) => i.type === "function_call");
              yield {
                type: "done",
                stopReason: hasToolCalls ? "tool_use" : "end_turn",
              };
              break;
            }
          }
        }
      }
    } finally {
      clearInterval(timeoutInterval);
      reader.releaseLock();
    }

    if (timeoutController.signal.aborted) {
      throw new Error(
        `Stream timeout: No response from Codex API for ${STREAM_TIMEOUT_MS / 1000}s`,
      );
    }
  }
}

/**
 * Create a Codex provider
 */
export function createCodexProvider(config?: ProviderConfig): CodexProvider {
  const provider = new CodexProvider();
  if (config) {
    provider.initialize(config).catch(() => {});
  }
  return provider;
}
