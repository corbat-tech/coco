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

// Codex provider (ChatGPT Plus/Pro via OAuth)
export { CodexProvider, createCodexProvider } from "./codex.js";

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

// Circuit breaker
export {
  CircuitBreaker,
  CircuitOpenError,
  createCircuitBreaker,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type CircuitState,
  type CircuitBreakerConfig,
} from "./circuit-breaker.js";

// Provider fallback
export {
  ProviderFallback,
  createProviderFallback,
  type ProviderFallbackConfig,
} from "./fallback.js";

// Provider registry
import type { LLMProvider, ProviderConfig } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider, createKimiProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { CodexProvider } from "./codex.js";
import { ProviderError } from "../utils/errors.js";
import { getApiKey, getBaseUrl, getDefaultModel } from "../config/env.js";

/**
 * Supported provider types
 */
export type ProviderType =
  | "anthropic"
  | "openai"
  | "codex"
  | "gemini"
  | "kimi"
  | "lmstudio"
  | "ollama"
  | "groq"
  | "openrouter"
  | "mistral"
  | "deepseek"
  | "together"
  | "huggingface";

/**
 * Create a provider by type
 */
export async function createProvider(
  type: ProviderType,
  config: ProviderConfig = {},
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

    case "codex":
      // Codex uses OAuth tokens from ChatGPT Plus/Pro
      provider = new CodexProvider();
      break;

    case "gemini":
      provider = new GeminiProvider();
      break;

    case "kimi":
      provider = createKimiProvider(mergedConfig);
      await provider.initialize(mergedConfig);
      return provider;

    case "lmstudio":
      // LM Studio uses OpenAI-compatible API
      provider = new OpenAIProvider("lmstudio", "LM Studio");
      mergedConfig.baseUrl = mergedConfig.baseUrl ?? "http://localhost:1234/v1";
      mergedConfig.apiKey = mergedConfig.apiKey ?? "lm-studio"; // LM Studio doesn't need real key
      break;

    case "ollama":
      // Ollama uses OpenAI-compatible API
      provider = new OpenAIProvider("ollama", "Ollama");
      mergedConfig.baseUrl = mergedConfig.baseUrl ?? "http://localhost:11434/v1";
      mergedConfig.apiKey = mergedConfig.apiKey ?? "ollama"; // Ollama doesn't need real key
      break;

    case "groq":
      provider = new OpenAIProvider("groq", "Groq");
      mergedConfig.baseUrl = mergedConfig.baseUrl ?? "https://api.groq.com/openai/v1";
      break;

    case "openrouter":
      provider = new OpenAIProvider("openrouter", "OpenRouter");
      mergedConfig.baseUrl = mergedConfig.baseUrl ?? "https://openrouter.ai/api/v1";
      break;

    case "mistral":
      provider = new OpenAIProvider("mistral", "Mistral AI");
      mergedConfig.baseUrl = mergedConfig.baseUrl ?? "https://api.mistral.ai/v1";
      break;

    case "deepseek":
      provider = new OpenAIProvider("deepseek", "DeepSeek");
      mergedConfig.baseUrl = mergedConfig.baseUrl ?? "https://api.deepseek.com/v1";
      break;

    case "together":
      provider = new OpenAIProvider("together", "Together AI");
      mergedConfig.baseUrl = mergedConfig.baseUrl ?? "https://api.together.xyz/v1";
      break;

    case "huggingface":
      provider = new OpenAIProvider("huggingface", "HuggingFace Inference");
      mergedConfig.baseUrl = mergedConfig.baseUrl ?? "https://api-inference.huggingface.co/v1";
      break;

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
export async function getDefaultProvider(config: ProviderConfig = {}): Promise<LLMProvider> {
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
    { id: "anthropic", name: "Anthropic Claude", configured: !!getApiKey("anthropic") },
    { id: "openai", name: "OpenAI (API Key)", configured: !!getApiKey("openai") },
    {
      id: "codex",
      name: "OpenAI Codex (ChatGPT Plus/Pro)",
      configured: false, // Will check OAuth tokens separately
    },
    { id: "gemini", name: "Google Gemini", configured: !!getApiKey("gemini") },
    { id: "kimi", name: "Kimi (Moonshot)", configured: !!getApiKey("kimi") },
    { id: "groq", name: "Groq", configured: !!getApiKey("groq") },
    { id: "openrouter", name: "OpenRouter", configured: !!getApiKey("openrouter") },
    { id: "mistral", name: "Mistral AI", configured: !!getApiKey("mistral") },
    { id: "deepseek", name: "DeepSeek", configured: !!getApiKey("deepseek") },
    { id: "together", name: "Together AI", configured: !!getApiKey("together") },
    { id: "huggingface", name: "HuggingFace Inference", configured: !!getApiKey("huggingface") },
    { id: "lmstudio", name: "LM Studio (Local)", configured: true },
    { id: "ollama", name: "Ollama (Local)", configured: true },
  ];
}
