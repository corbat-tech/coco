/**
 * Google Vertex AI Gemini provider for Corbat-Coco
 *
 * Uses Vertex AI's Gemini API with either Google Cloud ADC or API key authentication.
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
  MessageContent,
  ImageContent,
  ToolResultContent,
  ToolUseContent,
} from "./types.js";
import { createRequestScope } from "../utils/request-scope.js";
import { rethrowCancellation } from "../utils/cancellation.js";
import { ProviderError } from "../utils/errors.js";
import { getCachedADCToken } from "../auth/gcloud.js";
import { resolveRetryConfig, withRetry, type RetryConfig, DEFAULT_RETRY_CONFIG } from "./retry.js";
import { getCatalogContextWindow, getCatalogDefaultModel } from "./catalog.js";

import { GoogleToolBatch } from "./google-tool-integrity.js";
import { ResponseIntegrityError } from "./response-integrity.js";

const DEFAULT_MODEL = getCatalogDefaultModel("vertex");
const DEFAULT_BASE_URL = "https://aiplatform.googleapis.com/v1";
const DEFAULT_LOCATION = "global";

const CONTEXT_WINDOWS: Record<string, number> = {
  "gemini-3-pro-preview": 1048576,
  "gemini-3-flash-preview": 1048576,
  "gemini-2.5-pro": 1048576,
  "gemini-2.5-flash": 1048576,
  "gemini-2.5-flash-lite": 1048576,
  "gemini-2.0-flash-001": 1048576,
  "gemini-2.0-flash-lite-001": 1048576,
};
const SKIP_THOUGHT_SIGNATURE_VALIDATOR = "skip_thought_signature_validator";

interface VertexInlineData {
  mimeType: string;
  data: string;
}

interface VertexFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  thoughtSignature?: string;
  thought_signature?: string;
}

interface VertexFunctionResponse {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

interface VertexPart {
  text?: string;
  inlineData?: VertexInlineData;
  functionCall?: VertexFunctionCall;
  functionResponse?: VertexFunctionResponse;
  thoughtSignature?: string;
  thought_signature?: string;
}

interface VertexContent {
  role: "user" | "model";
  parts: VertexPart[];
}

interface VertexCandidate {
  content?: {
    parts?: VertexPart[];
  };
  finishReason?: string;
}

interface VertexGenerateContentResponse {
  candidates?: VertexCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

function extractSseEventData(rawEvent: string): string | null {
  const dataLines = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join("\n");
}

export class VertexProvider implements LLMProvider {
  readonly id = "vertex";
  readonly name = "Google Vertex AI Gemini";

  private config: ProviderConfig = {};
  private project = "";
  private location = DEFAULT_LOCATION;
  private apiKey?: string;
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.project =
      config.project ??
      process.env["VERTEX_PROJECT"] ??
      process.env["GOOGLE_CLOUD_PROJECT"] ??
      process.env["GCLOUD_PROJECT"] ??
      "";
    this.location =
      config.location ??
      process.env["VERTEX_LOCATION"] ??
      process.env["GOOGLE_CLOUD_LOCATION"] ??
      DEFAULT_LOCATION;
    this.apiKey = config.apiKey ?? process.env["VERTEX_API_KEY"] ?? process.env["GOOGLE_API_KEY"];

    if (!this.project.trim()) {
      throw new ProviderError(
        "Vertex AI project not configured. Set provider.project, VERTEX_PROJECT, or GOOGLE_CLOUD_PROJECT.",
        { provider: this.id },
      );
    }

    if (this.apiKey?.trim()) {
      return;
    }

    const scope = createRequestScope(undefined, config.timeout ?? 120000);
    try {
      const token = await getCachedADCToken(scope.signal);
      scope.signal.throwIfAborted();
      if (!token) {
        throw new ProviderError(
          "Vertex AI authentication is not configured. Set VERTEX_API_KEY (or GOOGLE_API_KEY), or run `gcloud auth application-default login`.",
          { provider: this.id },
        );
      }
    } finally {
      scope.dispose();
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    this.ensureInitialized();
    const scope = createRequestScope(
      options?.signal,
      options?.timeout ?? this.config.timeout ?? 120000,
    );
    options = { ...options, signal: scope.signal };
    try {
      return await withRetry(
        async () => {
          const response = await this.generateContent(messages, options);
          return this.parseResponse(response, options?.model);
        },
        resolveRetryConfig(this.retryConfig, options?.maxRetries),
        options?.signal,
      );
    } catch (error) {
      rethrowCancellation(error, scope.signal);
      throw error;
    } finally {
      scope.dispose();
    }
  }

  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    this.ensureInitialized();
    const scope = createRequestScope(
      options?.signal,
      options?.timeout ?? this.config.timeout ?? 120000,
    );
    options = { ...options, signal: scope.signal };
    try {
      return await withRetry(
        async () => {
          const response = await this.generateContent(
            messages,
            options,
            options.tools,
            options.toolChoice,
          );
          return this.parseResponseWithTools(response, options.model);
        },
        resolveRetryConfig(this.retryConfig, options?.maxRetries),
        options?.signal,
      );
    } catch (error) {
      rethrowCancellation(error, scope.signal);
      throw error;
    } finally {
      scope.dispose();
    }
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    this.ensureInitialized();
    const scope = createRequestScope(
      options?.signal,
      options?.timeout ?? this.config.timeout ?? 120000,
    );
    options = { ...options, signal: scope.signal };
    try {
      const stream = await this.streamGenerateContent(messages, options);
      let stopReason: StreamChunk["stopReason"] = "end_turn";

      for await (const chunk of stream) {
        scope.signal.throwIfAborted();
        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) {
            scope.signal.throwIfAborted();
            yield { type: "text", text: part.text };
            scope.signal.throwIfAborted();
          }
        }
        stopReason = this.mapFinishReason(candidate?.finishReason);
      }

      scope.signal.throwIfAborted();

      yield { type: "done", stopReason };

      scope.signal.throwIfAborted();
    } catch (error) {
      rethrowCancellation(error, scope.signal);
      throw error;
    } finally {
      scope.dispose();
    }
  }

  async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    this.ensureInitialized();
    const scope = createRequestScope(
      options?.signal,
      options?.timeout ?? this.config.timeout ?? 120000,
    );
    options = { ...options, signal: scope.signal };
    try {
      const stream = await this.streamGenerateContent(
        messages,
        options,
        options.tools,
        options.toolChoice,
      );
      const batch = new GoogleToolBatch("vertex");
      for await (const chunk of stream) {
        scope.signal.throwIfAborted();
        if (chunk.error)
          throw new ResponseIntegrityError("Vertex stream reported failure", this.id);
        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        batch.add(parts, candidate?.finishReason);
        for (const part of parts) {
          if (part.text) {
            yield { type: "text", text: part.text };
            scope.signal.throwIfAborted();
          }
        }
      }
      scope.signal.throwIfAborted();
      const { toolCalls, stopReason } = batch.complete();
      for (const toolCall of toolCalls) {
        scope.signal.throwIfAborted();
        yield { type: "tool_use_start", toolCall };
        scope.signal.throwIfAborted();
        yield { type: "tool_use_end", toolCall };
      }
      scope.signal.throwIfAborted();
      yield { type: "done", stopReason };

      scope.signal.throwIfAborted();
    } catch (error) {
      rethrowCancellation(error, scope.signal);
      throw error;
    } finally {
      scope.dispose();
    }
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getContextWindow(): number {
    const model = this.config.model ?? DEFAULT_MODEL;
    const catalogWindow = getCatalogContextWindow("vertex", model, 0);
    if (catalogWindow > 0) {
      return catalogWindow;
    }
    return CONTEXT_WINDOWS[model] ?? 1048576;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.chat([{ role: "user", content: "hi" }], { maxTokens: 8, maxRetries: 0 });
      return true;
    } catch {
      return false;
    }
  }

  private ensureInitialized(): void {
    if (!this.project) {
      throw new ProviderError("Provider not initialized. Call initialize() first.", {
        provider: this.id,
      });
    }
  }

  private getModel(model?: string): string {
    return model ?? this.config.model ?? DEFAULT_MODEL;
  }

  private getResolvedBaseUrl(): string {
    if (this.config.baseUrl && this.config.baseUrl.trim()) {
      return this.config.baseUrl;
    }

    if (this.location === DEFAULT_LOCATION) {
      return DEFAULT_BASE_URL;
    }

    return `https://${encodeURIComponent(this.location)}-aiplatform.googleapis.com/v1`;
  }

  private buildEndpoint(model?: string, stream = false): string {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${this.getResolvedBaseUrl()}/projects/${encodeURIComponent(this.project)}/locations/${encodeURIComponent(this.location)}/publishers/google/models/${encodeURIComponent(this.getModel(model))}:${action}`;
  }

  private async getHeaders(signal?: AbortSignal): Promise<Record<string, string>> {
    if (this.apiKey?.trim()) {
      return {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
        "x-goog-user-project": this.project,
      };
    }

    const token = await getCachedADCToken(signal);
    signal?.throwIfAborted();
    if (!token) {
      throw new ProviderError(
        "Vertex AI token is unavailable. Re-authenticate with gcloud or configure VERTEX_API_KEY.",
        { provider: this.id },
      );
    }

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.accessToken}`,
      "x-goog-user-project": this.project,
    };
  }

  private extractSystem(messages: Message[], optionsSystem?: string): string | undefined {
    if (optionsSystem !== undefined) return optionsSystem;
    const systemMsg = messages.find((m) => m.role === "system");
    if (!systemMsg) return undefined;
    if (typeof systemMsg.content === "string") return systemMsg.content;
    const text = systemMsg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text || undefined;
  }

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

  private convertContents(messages: Message[]): VertexContent[] {
    const toolNameByUseId = this.buildToolUseNameMap(messages);
    const conversation = messages.filter((m) => m.role !== "system");
    const contents: VertexContent[] = [];

    for (let i = 0; i < conversation.length; i++) {
      const msg = conversation[i]!;
      if (msg.role === "user") {
        if (Array.isArray(msg.content) && msg.content[0]?.type === "tool_result") {
          const functionResponses: VertexPart[] = [];
          for (const block of msg.content) {
            if (block.type === "tool_result") {
              const toolResult = block as ToolResultContent;
              functionResponses.push({
                functionResponse: {
                  id: toolResult.tool_use_id,
                  name: toolNameByUseId.get(toolResult.tool_use_id) ?? toolResult.tool_use_id,
                  response: { result: toolResult.content },
                },
              });
            }
          }
          contents.push({ role: "user", parts: functionResponses });
        } else {
          contents.push({ role: "user", parts: this.convertContent(msg.content) });
        }
      } else if (msg.role === "assistant") {
        contents.push({ role: "model", parts: this.convertContent(msg.content) });
      }
    }

    return contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "" }] }];
  }

  private convertContent(content: MessageContent): VertexPart[] {
    if (typeof content === "string") return [{ text: content }];

    const parts: VertexPart[] = [];
    for (const block of content) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      } else if (block.type === "image") {
        const image = block as ImageContent;
        parts.push({
          inlineData: {
            data: image.source.data,
            mimeType: image.source.media_type,
          },
        });
      } else if (block.type === "tool_use") {
        const toolUse = block as ToolUseContent;
        const thoughtSignature = toolUse.geminiThoughtSignature ?? SKIP_THOUGHT_SIGNATURE_VALIDATOR;
        parts.push({
          functionCall: {
            id: toolUse.id,
            name: toolUse.name,
            args: toolUse.input,
          },
          thoughtSignature,
          thought_signature: thoughtSignature,
        });
      }
    }

    return parts.length > 0 ? parts : [{ text: "" }];
  }

  private convertTools(tools: ToolDefinition[]): Array<{
    functionDeclarations: Array<{
      name: string;
      description: string;
      parametersJsonSchema: Record<string, unknown>;
    }>;
  }> {
    return [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.input_schema,
        })),
      },
    ];
  }

  private convertToolChoice(
    choice: ChatWithToolsOptions["toolChoice"],
  ):
    | { functionCallingConfig: { mode: "AUTO" | "ANY"; allowedFunctionNames?: string[] } }
    | undefined {
    if (!choice || choice === "auto") {
      return { functionCallingConfig: { mode: "AUTO" } };
    }
    if (choice === "any") {
      return { functionCallingConfig: { mode: "ANY" } };
    }
    return { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.name] } };
  }

  private buildRequestBody(
    messages: Message[],
    options?: ChatOptions,
    tools?: ToolDefinition[],
    toolChoice?: ChatWithToolsOptions["toolChoice"],
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents: this.convertContents(messages),
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        temperature: options?.temperature ?? this.config.temperature ?? 0,
        stopSequences: options?.stopSequences,
      },
    };

    const systemInstruction = this.extractSystem(messages, options?.system);
    if (systemInstruction) {
      body["systemInstruction"] = {
        parts: [{ text: systemInstruction }],
      };
    }

    if (tools && tools.length > 0) {
      body["tools"] = this.convertTools(tools);
      const convertedChoice = this.convertToolChoice(toolChoice);
      if (convertedChoice) {
        body["toolConfig"] = convertedChoice;
      }
    }

    return body;
  }

  private async generateContent(
    messages: Message[],
    options?: ChatOptions,
    tools?: ToolDefinition[],
    toolChoice?: ChatWithToolsOptions["toolChoice"],
  ): Promise<VertexGenerateContentResponse> {
    options?.signal?.throwIfAborted();
    const headers = await this.getHeaders(options?.signal);
    options?.signal?.throwIfAborted();
    const response = await fetch(this.buildEndpoint(options?.model), {
      method: "POST",
      headers,
      body: JSON.stringify(this.buildRequestBody(messages, options, tools, toolChoice)),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw await this.buildHttpError(response);
    }

    const data = (await response.json()) as VertexGenerateContentResponse;
    if (data.error?.message) {
      throw new ProviderError(data.error.message, {
        provider: this.id,
        statusCode: data.error.code,
      });
    }
    return data;
  }

  private async *streamGenerateContent(
    messages: Message[],
    options?: ChatOptions,
    tools?: ToolDefinition[],
    toolChoice?: ChatWithToolsOptions["toolChoice"],
  ): AsyncIterable<VertexGenerateContentResponse> {
    options?.signal?.throwIfAborted();
    const headers = await this.getHeaders(options?.signal);
    options?.signal?.throwIfAborted();
    const response = await fetch(this.buildEndpoint(options?.model, true), {
      method: "POST",
      headers,
      body: JSON.stringify(this.buildRequestBody(messages, options, tools, toolChoice)),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw await this.buildHttpError(response);
    }

    if (!response.body) {
      throw new ProviderError("Vertex AI streaming response body is empty.", {
        provider: this.id,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        options?.signal?.throwIfAborted();
        const { value, done } = await reader.read();
        options?.signal?.throwIfAborted();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const boundaryMatch = /\r?\n\r?\n/.exec(buffer);
          if (!boundaryMatch || boundaryMatch.index === undefined) break;

          const rawEvent = buffer.slice(0, boundaryMatch.index);
          buffer = buffer.slice(boundaryMatch.index + boundaryMatch[0].length);
          const data = extractSseEventData(rawEvent);

          if (!data || data === "[DONE]") {
            if (data === "[DONE]") return;
            continue;
          }

          let parsed: VertexGenerateContentResponse;
          try {
            parsed = JSON.parse(data) as VertexGenerateContentResponse;
          } catch {
            if (tools) throw new ResponseIntegrityError("Invalid Vertex stream event", this.id);
            continue;
          }
          options?.signal?.throwIfAborted();
          yield parsed;
          options?.signal?.throwIfAborted();
        }
      }

      const trailingData = extractSseEventData(buffer.trim());
      if (trailingData && trailingData !== "[DONE]") {
        let parsed: VertexGenerateContentResponse;
        try {
          parsed = JSON.parse(trailingData) as VertexGenerateContentResponse;
        } catch {
          if (tools) throw new ResponseIntegrityError("Incomplete Vertex stream event", this.id);
          return;
        }
        options?.signal?.throwIfAborted();
        yield parsed;
        options?.signal?.throwIfAborted();
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* Preserve the original transport failure. */
      } finally {
        reader.releaseLock();
      }
    }
  }

  private parseResponse(response: VertexGenerateContentResponse, model?: string): ChatResponse {
    const candidate = response.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((part) => part.text)
      .map((part) => part.text)
      .join("");

    return {
      id: `vertex-${Date.now()}`,
      content: text,
      stopReason: this.mapFinishReason(candidate?.finishReason),
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: this.getModel(model),
    };
  }

  private parseResponseWithTools(
    response: VertexGenerateContentResponse,
    model?: string,
  ): ChatWithToolsResponse {
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const batch = new GoogleToolBatch("vertex");
    batch.add(parts, candidate?.finishReason);
    const { toolCalls, stopReason } = batch.complete();
    const textContent = parts.map((part) => part.text ?? "").join("");

    return {
      id: `vertex-${Date.now()}`,
      content: textContent,
      stopReason,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: this.getModel(model),
      toolCalls,
    };
  }

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

  private async buildHttpError(response: Response): Promise<ProviderError> {
    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    return new ProviderError(`Vertex AI error: ${response.status} - ${body}`, {
      provider: this.id,
      statusCode: response.status,
      retryable,
    });
  }
}

export function createVertexProvider(config?: ProviderConfig): VertexProvider {
  const provider = new VertexProvider();
  if (config) {
    provider.initialize(config).catch(() => {});
  }
  return provider;
}
