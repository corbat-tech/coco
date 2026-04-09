/**
 * Google Gemini provider for Corbat-Coco
 *
 * Uses the official Google GenAI SDK.
 */

import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Part,
  type Tool,
} from "@google/genai";
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
  ToolUseContent,
} from "./types.js";
import { ProviderError } from "../utils/errors.js";

const DEFAULT_MODEL = "gemini-3.1-pro-preview";

const CONTEXT_WINDOWS: Record<string, number> = {
  "gemini-3.1-pro-preview": 1000000,
  "gemini-3.1-flash-lite-preview": 1000000,
  "gemini-3-flash-preview": 1000000,
  "gemini-2.5-pro": 1048576,
  "gemini-2.5-flash": 1048576,
  "gemini-2.5-flash-lite": 1048576,
  "gemini-1.5-flash": 1000000,
  "gemini-1.5-pro": 2000000,
};

export class GeminiProvider implements LLMProvider {
  readonly id = "gemini";
  readonly name = "Google Gemini";

  private client: GoogleGenAI | null = null;
  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    const apiKey = config.apiKey ?? process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];

    if (!apiKey) {
      throw new ProviderError(
        "Gemini Developer API key not provided. Set GEMINI_API_KEY or GOOGLE_API_KEY.",
        { provider: this.id },
      );
    }

    this.client = new GoogleGenAI({ apiKey });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    this.ensureInitialized();

    try {
      const response = await this.client!.models.generateContent({
        model: this.getModel(options?.model),
        contents: this.convertContents(messages),
        config: this.buildConfig(messages, options),
      });

      return this.parseResponse(response, options?.model);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async chatWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResponse> {
    this.ensureInitialized();

    try {
      const response = await this.client!.models.generateContent({
        model: this.getModel(options.model),
        contents: this.convertContents(messages),
        config: this.buildConfig(messages, options, options.tools, options.toolChoice),
      });

      return this.parseResponseWithTools(response, options.model);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    this.ensureInitialized();

    try {
      const stream = await this.client!.models.generateContentStream({
        model: this.getModel(options?.model),
        contents: this.convertContents(messages),
        config: this.buildConfig(messages, options),
      });

      let streamStopReason: StreamChunk["stopReason"] = "end_turn";

      for await (const chunk of stream) {
        const text = chunk.text;
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

  async *streamWithTools(
    messages: Message[],
    options: ChatWithToolsOptions,
  ): AsyncIterable<StreamChunk> {
    this.ensureInitialized();

    try {
      const stream = await this.client!.models.generateContentStream({
        model: this.getModel(options.model),
        contents: this.convertContents(messages),
        config: this.buildConfig(messages, options, options.tools, options.toolChoice),
      });

      let streamStopReason: StreamChunk["stopReason"] = "end_turn";
      let fallbackToolCounter = 0;
      const emittedToolIds = new Set<string>();

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          yield { type: "text", text };
        }

        const functionCalls = this.extractFunctionCalls(chunk);
        for (const functionCall of functionCalls) {
          const toolCallId = functionCall.id ?? `gemini_call_${++fallbackToolCounter}`;
          if (emittedToolIds.has(toolCallId)) continue;
          emittedToolIds.add(toolCallId);

          const toolCall: ToolCall = {
            id: toolCallId,
            name: functionCall.name ?? "unknown_function",
            input: (functionCall.args ?? {}) as Record<string, unknown>,
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

        const finishReason = chunk.candidates?.[0]?.finishReason;
        if (functionCalls.length > 0) {
          streamStopReason = "tool_use";
        } else if (finishReason) {
          streamStopReason = this.mapFinishReason(finishReason);
        }
      }

      yield { type: "done", stopReason: streamStopReason };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  countTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

  getContextWindow(): number {
    const model = this.config.model ?? DEFAULT_MODEL;
    return CONTEXT_WINDOWS[model] ?? 1000000;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.client) return false;

    try {
      await this.client.models.generateContent({
        model: this.getModel(),
        contents: "hi",
      });
      return true;
    } catch {
      return false;
    }
  }

  private ensureInitialized(): void {
    if (!this.client) {
      throw new ProviderError("Provider not initialized. Call initialize() first.", {
        provider: this.id,
      });
    }
  }

  private getModel(model?: string): string {
    return model ?? this.config.model ?? DEFAULT_MODEL;
  }

  private buildConfig(
    messages: Message[],
    options?: ChatOptions,
    tools?: ToolDefinition[],
    toolChoice?: ChatWithToolsOptions["toolChoice"],
  ): {
    maxOutputTokens: number;
    temperature: number;
    stopSequences?: string[];
    systemInstruction?: string;
    tools?: Tool[];
    toolConfig?: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode;
        allowedFunctionNames?: string[];
      };
    };
  } {
    const config: {
      maxOutputTokens: number;
      temperature: number;
      stopSequences?: string[];
      systemInstruction?: string;
      tools?: Tool[];
      toolConfig?: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode;
          allowedFunctionNames?: string[];
        };
      };
    } = {
      maxOutputTokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
      temperature: options?.temperature ?? this.config.temperature ?? 0,
      stopSequences: options?.stopSequences,
      systemInstruction: this.extractSystem(messages, options?.system),
    };

    if (tools && tools.length > 0) {
      config.tools = [{ functionDeclarations: this.convertTools(tools) }];
      config.toolConfig = {
        functionCallingConfig: this.convertToolChoice(toolChoice),
      };
    }

    return config;
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

  private convertContents(messages: Message[]): Content[] {
    const toolNameByUseId = this.buildToolUseNameMap(messages);
    const conversation = messages.filter((m) => m.role !== "system");
    const contents: Content[] = [];

    for (const msg of conversation) {
      if (msg.role === "user") {
        if (Array.isArray(msg.content) && msg.content[0]?.type === "tool_result") {
          const parts: Part[] = [];
          for (const block of msg.content) {
            if (block.type === "tool_result") {
              const toolResult = block as ToolResultContent;
              parts.push({
                functionResponse: {
                  id: toolResult.tool_use_id,
                  name: toolNameByUseId.get(toolResult.tool_use_id) ?? toolResult.tool_use_id,
                  response: { result: toolResult.content },
                },
              });
            }
          }
          contents.push({ role: "user", parts });
        } else {
          contents.push({ role: "user", parts: this.convertContent(msg.content) });
        }
      } else if (msg.role === "assistant") {
        contents.push({ role: "model", parts: this.convertContent(msg.content) });
      }
    }

    return contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "" }] }];
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

  private convertContent(content: MessageContent): Part[] {
    if (typeof content === "string") {
      return [{ text: content }];
    }

    const parts: Part[] = [];
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
        parts.push({
          functionCall: {
            id: toolUse.id,
            name: toolUse.name,
            args: toolUse.input,
          },
        });
      }
    }

    return parts.length > 0 ? parts : [{ text: "" }];
  }

  private convertTools(tools: ToolDefinition[]): FunctionDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema as unknown as FunctionDeclaration["parameters"],
    }));
  }

  private convertToolChoice(
    choice: ChatWithToolsOptions["toolChoice"],
  ): {
    mode: FunctionCallingConfigMode;
    allowedFunctionNames?: string[];
  } {
    if (!choice || choice === "auto") {
      return { mode: FunctionCallingConfigMode.AUTO };
    }
    if (choice === "any") {
      return { mode: FunctionCallingConfigMode.ANY };
    }
    return {
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: [choice.name],
    };
  }

  private extractFunctionCalls(response: GenerateContentResponse): FunctionCall[] {
    if (response.functionCalls && response.functionCalls.length > 0) {
      return response.functionCalls;
    }

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    return parts
      .filter((part) => !!part.functionCall)
      .map((part) => part.functionCall!)
      .filter(Boolean);
  }

  private parseResponse(response: GenerateContentResponse, model?: string): ChatResponse {
    const usage = response.usageMetadata;

    return {
      id: `gemini-${Date.now()}`,
      content: response.text ?? "",
      stopReason: this.mapFinishReason(response.candidates?.[0]?.finishReason),
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      },
      model: this.getModel(model),
    };
  }

  private parseResponseWithTools(
    response: GenerateContentResponse,
    model?: string,
  ): ChatWithToolsResponse {
    const usage = response.usageMetadata;
    const toolCalls = this.extractFunctionCalls(response).map((functionCall, index) => ({
      id: functionCall.id ?? `gemini_call_${index + 1}`,
      name: functionCall.name ?? "unknown_function",
      input: (functionCall.args ?? {}) as Record<string, unknown>,
    }));

    return {
      id: `gemini-${Date.now()}`,
      content: response.text ?? "",
      stopReason:
        toolCalls.length > 0
          ? "tool_use"
          : this.mapFinishReason(response.candidates?.[0]?.finishReason),
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
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

  private handleError(error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    const msg = message.toLowerCase();

    let retryable = message.includes("429") || message.includes("500");

    if (
      msg.includes("quota") ||
      msg.includes("billing") ||
      msg.includes("usage limit") ||
      msg.includes("insufficient quota")
    ) {
      retryable = false;
    }

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

export function createGeminiProvider(config?: ProviderConfig): GeminiProvider {
  const provider = new GeminiProvider();
  if (config) {
    provider.initialize(config).catch(() => {});
  }
  return provider;
}
