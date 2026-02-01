/**
 * Provider exports for Corbat-Coco
 */

// Types
export type {
  LLMProvider,
  ProviderConfig,
  ProviderFactory,
  Message,
  MessageRole,
  MessageContent,
  TextContent,
  ImageContent,
  ToolUseContent,
  ToolResultContent,
  ToolDefinition,
  ToolCall,
  ChatOptions,
  ChatResponse,
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  StreamChunk,
} from "./types.js";

// Anthropic provider
export { AnthropicProvider, createAnthropicProvider } from "./anthropic.js";

// Provider registry
import type { LLMProvider, ProviderConfig } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { ProviderError } from "../utils/errors.js";

/**
 * Supported provider types
 */
export type ProviderType = "anthropic" | "openai" | "local";

/**
 * Create a provider by type
 */
export async function createProvider(
  type: ProviderType,
  config: ProviderConfig = {}
): Promise<LLMProvider> {
  let provider: LLMProvider;

  switch (type) {
    case "anthropic":
      provider = new AnthropicProvider();
      break;

    case "openai":
      // TODO: Implement OpenAI provider
      throw new ProviderError("OpenAI provider not yet implemented", {
        provider: "openai",
      });

    case "local":
      // TODO: Implement local provider (Ollama)
      throw new ProviderError("Local provider not yet implemented", {
        provider: "local",
      });

    default:
      throw new ProviderError(`Unknown provider type: ${type}`, {
        provider: type,
      });
  }

  await provider.initialize(config);
  return provider;
}

/**
 * Get default provider (Anthropic)
 */
export async function getDefaultProvider(
  config: ProviderConfig = {}
): Promise<LLMProvider> {
  return createProvider("anthropic", config);
}
