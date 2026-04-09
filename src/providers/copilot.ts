/**
 * GitHub Copilot Provider for Corbat-Coco
 *
 * Extends OpenAIProvider since the Copilot API is fully OpenAI-compatible.
 * The main differences are:
 * - Authentication via GitHub Device Flow (not API key)
 * - Short-lived Copilot tokens that auto-refresh (~25 min)
 * - Custom headers required by the Copilot API
 * - Multiple model families (Claude, GPT, Gemini) available via subscription
 *
 * Responses API routing for GPT-5+/Codex models is handled by the parent
 * OpenAIProvider — this class only adds Copilot token management.
 */

import OpenAI from "openai";
import type {
  ProviderConfig,
  Message,
  ChatOptions,
  ChatResponse,
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  StreamChunk,
} from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { OpenAIProvider } from "./openai.js";
import { getValidCopilotToken } from "../auth/copilot.js";

/**
 * Context windows for models available via Copilot.
 *
 * NOTE: Copilot API uses dot-separated model names (claude-sonnet-4.6) while
 * the Anthropic API uses hyphenated names (claude-sonnet-4-6). These are
 * different model IDs for different endpoints — do not conflate them.
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  // Claude models — Copilot API caps these at 168 000 (not 200 000 like Anthropic direct)
  "claude-sonnet-4.6": 168000,
  "claude-sonnet-4": 168000,
  "claude-opus-4.6": 168000,
  "claude-opus-4.6-fast": 168000,
  "claude-sonnet-4.5": 168000,
  "claude-opus-4.5": 168000,
  "claude-haiku-4.5": 168000,
  // OpenAI models — chat/completions
  "gpt-4.1": 1048576,
  "gpt-4o": 128000,
  // OpenAI models — /responses API (Codex/GPT-5+)
  "gpt-5.4-codex": 400000,
  "gpt-5.4": 400000,
  "gpt-5.4-mini": 400000,
  "gpt-5.3-codex": 400000,
  "gpt-5.2-codex": 400000,
  "gpt-5.1-codex-max": 400000,
  "gpt-5-mini": 400000,
  "gpt-5.2": 400000,
  "gpt-5.1": 400000,
  // Google models
  "gemini-3.1-pro": 1000000,
  "gemini-3.1-pro-preview": 1000000,
  "gemini-3-flash": 1000000,
  "gemini-3-flash-preview": 1000000,
  "gemini-2.5-pro": 1048576,
  // Evaluation models
  "grok-code-fast-1": 400000,
  "raptor-mini": 400000,
  goldeneye: 400000,
};

/**
 * Default model for Copilot
 */
const DEFAULT_MODEL = "claude-sonnet-4.6";

function normalizeModel(model: string | undefined): string | undefined {
  if (typeof model !== "string") return undefined;
  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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
 * GitHub Copilot provider implementation.
 *
 * Extends OpenAIProvider to reuse all message conversion, tool handling,
 * streaming, retry logic, and Responses API routing. Only overrides
 * initialization (Copilot token management) and adds automatic token
 * refresh before each API call.
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
      model: normalizeModel(config.model) ?? DEFAULT_MODEL,
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

  // --- Override public methods to add token refresh ---

  override async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    await this.refreshTokenIfNeeded();
    return super.chat(messages, options);
  }

  override async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    await this.refreshTokenIfNeeded();
    return super.chatWithTools(messages, options);
  }

  override async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    await this.refreshTokenIfNeeded();
    yield* super.stream(messages, options);
  }

  override async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    await this.refreshTokenIfNeeded();
    yield* super.streamWithTools(messages, options);
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
