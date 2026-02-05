/**
 * LLM Provider types for Corbat-Coco
 */

/**
 * Message role
 */
export type MessageRole = "system" | "user" | "assistant";

/**
 * Message content types
 */
export type MessageContent =
  | string
  | Array<TextContent | ImageContent | ToolUseContent | ToolResultContent>;

/**
 * Text content block
 */
export interface TextContent {
  type: "text";
  text: string;
}

/**
 * Image content block
 */
export interface ImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

/**
 * Tool use content block
 */
export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result content block
 */
export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Chat message
 */
export interface Message {
  role: MessageRole;
  content: MessageContent;
}

/**
 * Tool definition for LLM
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Chat options
 */
export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  system?: string;
  timeout?: number;
}

/**
 * Chat response
 */
export interface ChatResponse {
  id: string;
  content: string;
  stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
}

/**
 * Chat with tools options
 */
export interface ChatWithToolsOptions extends ChatOptions {
  tools: ToolDefinition[];
  toolChoice?: "auto" | "any" | { type: "tool"; name: string };
}

/**
 * Chat with tools response
 */
export interface ChatWithToolsResponse extends ChatResponse {
  toolCalls: ToolCall[];
}

/**
 * Stream chunk
 */
export interface StreamChunk {
  type: "text" | "tool_use_start" | "tool_use_delta" | "tool_use_end" | "done";
  text?: string;
  toolCall?: Partial<ToolCall>;
}

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  /**
   * Provider identifier
   */
  id: string;

  /**
   * Provider display name
   */
  name: string;

  /**
   * Initialize the provider
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Send a chat message
   */
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;

  /**
   * Send a chat message with tool use
   */
  chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResponse>;

  /**
   * Stream a chat response
   */
  stream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk>;

  /**
   * Stream a chat response with tool use
   */
  streamWithTools(messages: Message[], options: ChatWithToolsOptions): AsyncIterable<StreamChunk>;

  /**
   * Count tokens in text
   */
  countTokens(text: string): number;

  /**
   * Get context window size
   */
  getContextWindow(): number;

  /**
   * Check if provider is available
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  /** Internal: flag to indicate using Google Cloud ADC */
  useADC?: boolean;
}

/**
 * Provider factory
 */
export type ProviderFactory = (config: ProviderConfig) => LLMProvider;
