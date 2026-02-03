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

// OpenAI provider
export { OpenAIProvider, createOpenAIProvider, createKimiProvider } from "./openai.js";

// Gemini provider
export { GeminiProvider, createGeminiProvider } from "./gemini.js";

// Retry utilities
export {
  withRetry,
  isRetryableError,
  createRetryableMethod,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from "./retry.js";

// Pricing and cost estimation
export {
  MODEL_PRICING,
  DEFAULT_PRICING,
  estimateCost,
  formatCost,
  getModelPricing,
  hasKnownPricing,
  listModelsWithPricing,
  type ModelPricing,
  type CostEstimate,
} from "./pricing.js";

// Provider registry
import type { LLMProvider, ProviderConfig } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider, createKimiProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { ProviderError } from "../utils/errors.js";
import { getApiKey, getBaseUrl, getDefaultModel } from "../config/env.js";

/**
 * Supported provider types
 */
export type ProviderType = "anthropic" | "openai" | "gemini" | "kimi";

/**
 * Create a provider by type
 */
export async function createProvider(
  type: ProviderType,
  config: ProviderConfig = {}
): Promise<LLMProvider> {
  let provider: LLMProvider;

  // Merge config with environment defaults
  const mergedConfig: ProviderConfig = {
    apiKey: config.apiKey ?? getApiKey(type),
    baseUrl: config.baseUrl ?? getBaseUrl(type),
    model: config.model ?? getDefaultModel(type),
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    timeout: config.timeout,
  };

  switch (type) {
    case "anthropic":
      provider = new AnthropicProvider();
      break;

    case "openai":
      provider = new OpenAIProvider();
      break;

    case "gemini":
      provider = new GeminiProvider();
      break;

    case "kimi":
      provider = createKimiProvider(mergedConfig);
      await provider.initialize(mergedConfig);
      return provider;

    default:
      throw new ProviderError(`Unknown provider type: ${type}`, {
        provider: type,
      });
  }

  await provider.initialize(mergedConfig);
  return provider;
}

/**
 * Get default provider (from environment or Anthropic)
 */
export async function getDefaultProvider(
  config: ProviderConfig = {}
): Promise<LLMProvider> {
  const { getDefaultProvider: getEnvProvider } = await import("../config/env.js");
  const providerType = getEnvProvider();
  return createProvider(providerType, config);
}

/**
 * List available providers with their status
 */
export function listProviders(): Array<{
  id: ProviderType;
  name: string;
  configured: boolean;
}> {
  return [
    {
      id: "anthropic",
      name: "Anthropic Claude",
      configured: !!getApiKey("anthropic"),
    },
    {
      id: "openai",
      name: "OpenAI",
      configured: !!getApiKey("openai"),
    },
    {
      id: "gemini",
      name: "Google Gemini",
      configured: !!getApiKey("gemini"),
    },
    {
      id: "kimi",
      name: "Kimi (Moonshot)",
      configured: !!getApiKey("kimi"),
    },
  ];
}
