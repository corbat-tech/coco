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
import { createRequestScope } from "../utils/request-scope.js";
import { rethrowCancellation } from "../utils/cancellation.js";
import type {
  ProviderConfig,
  Message,
  ChatOptions,
  ChatResponse,
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  StreamChunk,
} from "./types.js";
import type { ThinkingMode } from "./thinking.js";
import { ProviderError } from "../utils/errors.js";
import { OpenAIProvider } from "./openai.js";
import { getValidCopilotToken } from "../auth/copilot.js";
import { getCatalogContextWindow, getCatalogDefaultModel } from "./catalog.js";

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
const DEFAULT_MODEL = getCatalogDefaultModel("copilot");

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
class CopilotRefreshFailure extends Error {
  constructor(readonly original: unknown) {
    super("Copilot refresh failed while cancelling");
  }
}

interface CopilotRefresh {
  controller: AbortController;
  promise: Promise<void>;
  consumers: Set<symbol>;
  settled: boolean;
}

export class CopilotProvider extends OpenAIProvider {
  private baseUrl = "https://api.githubcopilot.com";
  private currentToken: string | null = null;
  /** Retained until auth and any local credential save have settled. */
  private refreshState: CopilotRefresh | null = null;

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

    const scope = createRequestScope(undefined, this.config.timeout ?? 120000);
    try {
      // Try to get a valid Copilot token
      const tokenResult = await getValidCopilotToken(scope.signal);
      scope.signal.throwIfAborted();

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
    } finally {
      scope.dispose();
    }
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

  /** Share an exchange, but keep each caller's cancellation independent. */
  private async refreshTokenIfNeeded(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.refreshState?.controller.signal.aborted) {
      // A new caller must not inherit the previous callers' cancelled exchange.
      // Keep ownership until it settles (including an already-started local save).
      const closing = this.refreshState;
      try {
        await this.waitForRefresh(closing, signal);
      } catch (error) {
        if (error instanceof CopilotRefreshFailure) throw error;
        signal.throwIfAborted();
        if (error !== closing.controller.signal.reason) throw new CopilotRefreshFailure(error);
      }
      return this.refreshTokenIfNeeded(signal);
    }
    if (!this.refreshState) {
      const state: CopilotRefresh = {
        controller: new AbortController(),
        promise: Promise.resolve(),
        consumers: new Set(),
        settled: false,
      };
      this.refreshState = state;
      state.promise = (async () => {
        try {
          const tokenResult = await getValidCopilotToken(state.controller.signal);
          state.controller.signal.throwIfAborted();
          if (
            tokenResult &&
            (tokenResult.isNew ||
              tokenResult.token !== this.currentToken ||
              tokenResult.baseUrl !== this.baseUrl)
          ) {
            this.currentToken = tokenResult.token;
            this.baseUrl = tokenResult.baseUrl;
            this.createCopilotClient();
          }
        } finally {
          state.settled = true;
          if (this.refreshState === state) this.refreshState = null;
        }
      })();
    }
    await this.waitForRefresh(this.refreshState, signal);
    signal.throwIfAborted();
  }

  private waitForRefresh(state: CopilotRefresh, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const consumer = Symbol("copilot request");
    state.consumers.add(consumer);
    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        finished = true;
        signal.removeEventListener("abort", onAbort);
        state.consumers.delete(consumer);
        if (!state.settled && state.consumers.size === 0) state.controller.abort(signal.reason);
      };
      const onAbort = () => {
        if (finished) return;
        const lastConsumer = state.consumers.size === 1;
        cleanup();
        if (lastConsumer) {
          // Keep a recipient for a credential-save failure after transport abort.
          state.promise.then(
            () => reject(signal.reason),
            (error: unknown) =>
              reject(
                error === state.controller.signal.reason
                  ? signal.reason
                  : new CopilotRefreshFailure(error),
              ),
          );
        } else {
          reject(signal.reason);
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      state.promise.then(
        () => {
          if (!finished) {
            cleanup();
            if (signal.aborted) reject(signal.reason);
            else resolve();
          }
        },
        (error: unknown) => {
          if (!finished) {
            cleanup();
            reject(signal.aborted ? signal.reason : error);
          }
        },
      );
      if (signal.aborted) onAbort();
    });
  }

  // The host deadline includes auth, retries and body consumption.
  override async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const scope = createRequestScope(
      options?.signal,
      options?.timeout ?? this.config.timeout ?? 120000,
    );
    try {
      await this.refreshTokenIfNeeded(scope.signal);
      return await super.chat(messages, { ...options, signal: scope.signal });
    } catch (error) {
      if (error instanceof CopilotRefreshFailure) throw error.original;
      rethrowCancellation(error, scope.signal);
      throw error;
    } finally {
      scope.dispose();
    }
  }

  override async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    const scope = createRequestScope(
      options.signal,
      options.timeout ?? this.config.timeout ?? 120000,
    );
    try {
      await this.refreshTokenIfNeeded(scope.signal);
      return await super.chatWithTools(messages, { ...options, signal: scope.signal });
    } catch (error) {
      if (error instanceof CopilotRefreshFailure) throw error.original;
      rethrowCancellation(error, scope.signal);
      throw error;
    } finally {
      scope.dispose();
    }
  }

  override async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    const scope = createRequestScope(
      options?.signal,
      options?.timeout ?? this.config.timeout ?? 120000,
    );
    try {
      await this.refreshTokenIfNeeded(scope.signal);
      for await (const chunk of super.stream(messages, { ...options, signal: scope.signal })) {
        scope.signal.throwIfAborted();
        yield chunk;
        scope.signal.throwIfAborted();
      }
    } catch (error) {
      if (error instanceof CopilotRefreshFailure) throw error.original;
      rethrowCancellation(error, scope.signal);
      throw error;
    } finally {
      scope.dispose();
    }
  }

  override async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    const scope = createRequestScope(
      options.signal,
      options.timeout ?? this.config.timeout ?? 120000,
    );
    try {
      await this.refreshTokenIfNeeded(scope.signal);
      for await (const chunk of super.streamWithTools(messages, {
        ...options,
        signal: scope.signal,
      })) {
        scope.signal.throwIfAborted();
        yield chunk;
        scope.signal.throwIfAborted();
      }
    } catch (error) {
      if (error instanceof CopilotRefreshFailure) throw error.original;
      rethrowCancellation(error, scope.signal);
      throw error;
    } finally {
      scope.dispose();
    }
  }

  // --- Override metadata methods ---

  /**
   * Count tokens (approximate — Copilot models vary in tokenizer)
   */
  /**
   * The GitHub Copilot endpoint (api.githubcopilot.com) does not expose the
   * OpenAI Responses API (/v1/responses). Always use Chat Completions so that
   * gpt-5-mini and similar models work correctly with MCP tools.
   */
  protected override modelNeedsResponsesApi(_model: string): boolean {
    return false;
  }

  /**
   * Copilot's OpenAI-compatible endpoint currently routes through
   * Chat Completions. For GPT-5.x models, combining function tools with
   * reasoning_effort is rejected by the upstream API. Keep tools working by
   * omitting reasoning_effort on tool calls instead of advertising a broken
   * combination.
   */
  protected override getChatCompletionsReasoningEffort(
    _model: string,
    _thinking: ThinkingMode | undefined,
    hasTools: boolean,
  ): "low" | "medium" | "high" | undefined {
    if (hasTools) return undefined;
    return undefined;
  }

  override countTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Get context window for the current model
   */
  override getContextWindow(): number {
    const model = this.config.model ?? DEFAULT_MODEL;
    const catalogWindow = getCatalogContextWindow("copilot", model, 0);
    if (catalogWindow > 0) {
      return catalogWindow;
    }
    return CONTEXT_WINDOWS[model] ?? 128000;
  }

  /**
   * Check if Copilot credentials are available
   */
  override async isAvailable(): Promise<boolean> {
    const scope = createRequestScope(undefined, this.config.timeout ?? 120000);
    try {
      const tokenResult = await getValidCopilotToken(scope.signal);
      scope.signal.throwIfAborted();
      return tokenResult !== null;
    } catch {
      return false;
    } finally {
      scope.dispose();
    }
  }
}

/**
 * Create a Copilot provider
 */
export function createCopilotProvider(): CopilotProvider {
  return new CopilotProvider();
}
