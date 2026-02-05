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
} from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { getValidAccessToken } from "../auth/index.js";

/**
 * Codex API endpoint (ChatGPT backend)
 */
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

/**
 * Default model for Codex (via ChatGPT Plus/Pro subscription)
 * Note: ChatGPT subscription uses different models than the API
 * Updated January 2026
 */
const DEFAULT_MODEL = "gpt-5.2-codex";

/**
 * Context windows for Codex models (ChatGPT Plus/Pro)
 * These are the models available via the chatgpt.com/backend-api/codex endpoint
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-5-codex": 200000,
  "gpt-5.2-codex": 200000,
  "gpt-5.1-codex": 200000,
  "gpt-5": 200000,
  "gpt-5.2": 200000,
  "gpt-5.1": 200000,
};

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
    ((claims["organizations"] as Array<{ id: string }> | undefined)?.[0]?.id)
  );
}

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
        { provider: this.id }
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
      throw new ProviderError(
        `Codex API error: ${response.status} - ${errorText}`,
        { provider: this.id, statusCode: response.status }
      );
    }

    return response;
  }

  /**
   * Extract text content from a message
   */
  private extractTextContent(msg: Message): string {
    if (typeof msg.content === "string") {
      return msg.content;
    }
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((part) => {
          if (part.type === "text") return part.text;
          if (part.type === "tool_result") return `Tool result: ${JSON.stringify(part.content)}`;
          return "";
        })
        .join("\n");
    }
    return "";
  }

  /**
   * Convert messages to Codex Responses API format
   * Codex uses a different format than Chat Completions:
   * {
   *   "input": [
   *     { "type": "message", "role": "developer|user", "content": [{ "type": "input_text", "text": "..." }] },
   *     { "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "..." }] }
   *   ]
   * }
   *
   * IMPORTANT: User/developer messages use "input_text", assistant messages use "output_text"
   */
  private convertMessagesToResponsesFormat(messages: Message[]): Array<{
    type: string;
    role: string;
    content: Array<{ type: string; text: string }>;
  }> {
    return messages.map((msg) => {
      const text = this.extractTextContent(msg);
      // Map roles: system -> developer, assistant -> assistant, user -> user
      const role = msg.role === "system" ? "developer" : msg.role;
      // Assistant messages use "output_text", all others use "input_text"
      const contentType = msg.role === "assistant" ? "output_text" : "input_text";
      return {
        type: "message",
        role,
        content: [{ type: contentType, text }],
      };
    });
  }


  /**
   * Send a chat message using Codex Responses API format
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model ?? this.config.model ?? DEFAULT_MODEL;

    // Extract system message for instructions (if any)
    const systemMsg = messages.find((m) => m.role === "system");
    const instructions = systemMsg ? this.extractTextContent(systemMsg) : "You are a helpful coding assistant.";

    // Convert remaining messages to Responses API format
    const inputMessages = messages
      .filter((m) => m.role !== "system")
      .map((msg) => this.convertMessagesToResponsesFormat([msg])[0]);

    const body = {
      model,
      instructions,
      input: inputMessages,
      tools: [],
      store: false,
      stream: true, // Codex API requires streaming
    };

    const response = await this.makeRequest(body);

    if (!response.body) {
      throw new ProviderError("No response body from Codex API", {
        provider: this.id,
      });
    }

    // Read streaming response (SSE format)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let responseId = `codex-${Date.now()}`;
    let inputTokens = 0;
    let outputTokens = 0;
    let status = "completed";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);

              // Extract response ID
              if (parsed.id) {
                responseId = parsed.id;
              }

              // Handle different event types
              if (parsed.type === "response.output_text.delta" && parsed.delta) {
                content += parsed.delta;
              } else if (parsed.type === "response.completed" && parsed.response) {
                // Final response with usage info
                if (parsed.response.usage) {
                  inputTokens = parsed.response.usage.input_tokens ?? 0;
                  outputTokens = parsed.response.usage.output_tokens ?? 0;
                }
                status = parsed.response.status ?? "completed";
              } else if (parsed.type === "response.output_text.done" && parsed.text) {
                // Full text output
                content = parsed.text;
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!content) {
      throw new ProviderError("No response content from Codex API", {
        provider: this.id,
      });
    }

    const stopReason = status === "completed" ? "end_turn" as const
      : status === "incomplete" ? "max_tokens" as const
      : "end_turn" as const;

    return {
      id: responseId,
      content,
      stopReason,
      model,
      usage: {
        inputTokens,
        outputTokens,
      },
    };
  }

  /**
   * Send a chat message with tool use
   * Note: Codex Responses API tool support is complex; for now we delegate to chat()
   * and return empty toolCalls. Full tool support can be added later.
   */
  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions
  ): Promise<ChatWithToolsResponse> {
    // For now, use basic chat without tools
    const response = await this.chat(messages, options);

    return {
      ...response,
      toolCalls: [], // Tools not yet supported in Codex provider
    };
  }

  /**
   * Stream a chat response
   * Note: True streaming with Codex Responses API is complex.
   * For now, we make a non-streaming call and simulate streaming by emitting chunks.
   */
  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    // Make a regular chat call and emit the result
    const response = await this.chat(messages, options);

    // Simulate streaming by emitting content in small chunks
    // This provides better visual feedback than emitting all at once
    if (response.content) {
      const content = response.content;
      const chunkSize = 20; // Characters per chunk for smooth display

      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        yield { type: "text" as const, text: chunk };

        // Small delay to simulate streaming (only if there's more content)
        if (i + chunkSize < content.length) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
    }

    yield { type: "done" as const };
  }

  /**
   * Stream a chat response with tool use
   * Note: Tools and true streaming with Codex Responses API are not yet implemented.
   * For now, we delegate to stream() which uses non-streaming under the hood.
   */
  async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions
  ): AsyncIterable<StreamChunk> {
    // Use the basic stream method (tools not supported yet)
    yield* this.stream(messages, options);
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
