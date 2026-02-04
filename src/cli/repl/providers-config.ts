/**
 * Provider Configuration
 *
 * Inspired by OpenCode/Crush - Flexible provider management
 *
 * ============================================================================
 * HOW TO UPDATE MODELS AND PROVIDERS
 * ============================================================================
 *
 * This is the SINGLE SOURCE OF TRUTH for all provider and model definitions.
 * When you need to update models, only edit this file!
 *
 * To update models/providers, ask Claude:
 *
 *   "Actualiza los modelos de [proveedor] en providers-config.ts.
 *    Busca en internet los últimos modelos disponibles de [proveedor]
 *    y actualiza la lista de modelos con sus context windows."
 *
 * Or in English:
 *
 *   "Update the [provider] models in providers-config.ts.
 *    Search the internet for the latest available models from [provider]
 *    and update the models list with their context windows."
 *
 * Files that use this configuration (no need to update manually):
 * - src/cli/repl/commands/model.ts (uses getProviderDefinition)
 * - src/cli/repl/commands/provider.ts (uses getAllProviders)
 * - src/cli/repl/onboarding-v2.ts (uses getAllProviders, getRecommendedModel)
 * - src/cli/commands/config.ts (uses getAllProviders, formatModelInfo)
 *
 * Files that have their own CONTEXT_WINDOWS (may need sync):
 * - src/providers/openai.ts (CONTEXT_WINDOWS for Kimi models)
 * - src/providers/anthropic.ts (CONTEXT_WINDOWS for Claude models)
 * - src/providers/gemini.ts (CONTEXT_WINDOWS for Gemini models)
 *
 * ============================================================================
 */

import type { ProviderType } from "../../providers/index.js";

/**
 * Model definition
 */
export interface ModelDefinition {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  recommended?: boolean;
}

/**
 * Provider configuration
 */
export interface ProviderDefinition {
  id: ProviderType;
  name: string;
  emoji: string;
  description: string;
  envVar: string;
  apiKeyUrl: string;
  baseUrl: string;
  docsUrl: string;
  models: ModelDefinition[];
  supportsCustomModels: boolean;
  openaiCompatible: boolean;
  features: {
    streaming: boolean;
    functionCalling: boolean;
    vision: boolean;
  };
}

/**
 * Provider definitions with up-to-date models
 */
export const PROVIDER_DEFINITIONS: Record<ProviderType, ProviderDefinition> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    emoji: "🟠",
    description: "Most capable models for coding and reasoning",
    envVar: "ANTHROPIC_API_KEY",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    docsUrl: "https://docs.anthropic.com",
    baseUrl: "https://api.anthropic.com/v1",
    supportsCustomModels: true,
    openaiCompatible: false,
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    models: [
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        description: "Latest and most capable Sonnet model",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "claude-opus-4-20250514",
        name: "Claude Opus 4",
        description: "Maximum capability for complex reasoning",
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Intelligent model with extended thinking",
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Good balance of speed and intelligence",
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
      {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        description: "Fastest responses, good for simple tasks",
        contextWindow: 200000,
        maxOutputTokens: 4096,
      },
    ],
  },

  openai: {
    id: "openai",
    name: "OpenAI",
    emoji: "🟢",
    description: "GPT-4o and GPT-4 models",
    envVar: "OPENAI_API_KEY",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs",
    baseUrl: "https://api.openai.com/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    models: [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        description: "Most capable multimodal model",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        recommended: true,
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        description: "Fast and cost-effective",
        contextWindow: 128000,
        maxOutputTokens: 16384,
      },
      {
        id: "o1",
        name: "o1",
        description: "Reasoning model for complex tasks",
        contextWindow: 128000,
        maxOutputTokens: 32768,
      },
      {
        id: "o1-mini",
        name: "o1-mini",
        description: "Faster reasoning model",
        contextWindow: 128000,
        maxOutputTokens: 65536,
      },
      {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        description: "Legacy high-capability model",
        contextWindow: 128000,
        maxOutputTokens: 4096,
      },
      {
        id: "gpt-3.5-turbo",
        name: "GPT-3.5 Turbo",
        description: "Legacy fast and cheap model",
        contextWindow: 16385,
        maxOutputTokens: 4096,
      },
    ],
  },

  gemini: {
    id: "gemini",
    name: "Google Gemini",
    emoji: "🔵",
    description: "Gemini 2.0 and 1.5 models",
    envVar: "GEMINI_API_KEY",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    supportsCustomModels: true,
    openaiCompatible: false,
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    models: [
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Fast, capable, and cost-effective",
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "gemini-2.0-flash-lite",
        name: "Gemini 2.0 Flash Lite",
        description: "Fastest responses, lowest cost",
        contextWindow: 1000000,
        maxOutputTokens: 8192,
      },
      {
        id: "gemini-2.0-pro-exp-02-05",
        name: "Gemini 2.0 Pro Exp",
        description: "Experimental pro model with 2M context",
        contextWindow: 2000000,
        maxOutputTokens: 8192,
      },
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Legacy pro model",
        contextWindow: 2000000,
        maxOutputTokens: 8192,
      },
      {
        id: "gemini-1.5-flash",
        name: "Gemini 1.5 Flash",
        description: "Legacy fast model",
        contextWindow: 1000000,
        maxOutputTokens: 8192,
      },
    ],
  },

  // Kimi/Moonshot - OpenAI compatible
  kimi: {
    id: "kimi",
    name: "Moonshot Kimi",
    emoji: "🌙",
    description: "Kimi models via Moonshot AI (OpenAI compatible)",
    envVar: "KIMI_API_KEY",
    apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    docsUrl: "https://platform.moonshot.ai/docs",
    baseUrl: "https://api.moonshot.ai/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    features: {
      streaming: true,
      functionCalling: true,
      vision: true, // K2.5 supports vision
    },
    models: [
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        description: "Latest multimodal model with 256K context and vision",
        contextWindow: 262144,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "kimi-k2-0324",
        name: "Kimi K2",
        description: "Kimi K2 model with 128K context",
        contextWindow: 131072,
        maxOutputTokens: 8192,
      },
      {
        id: "kimi-latest",
        name: "Kimi Latest",
        description: "Always points to the latest Kimi model",
        contextWindow: 131072,
        maxOutputTokens: 8192,
      },
      {
        id: "moonshot-v1-128k",
        name: "Moonshot v1 128K",
        description: "128K context window (stable)",
        contextWindow: 131072,
        maxOutputTokens: 4096,
      },
      {
        id: "moonshot-v1-32k",
        name: "Moonshot v1 32K",
        description: "32K context window",
        contextWindow: 32768,
        maxOutputTokens: 4096,
      },
      {
        id: "moonshot-v1-8k",
        name: "Moonshot v1 8K",
        description: "8K context window (fastest)",
        contextWindow: 8192,
        maxOutputTokens: 4096,
      },
    ],
  },
};

/**
 * Get provider definition
 */
export function getProviderDefinition(type: ProviderType): ProviderDefinition {
  return PROVIDER_DEFINITIONS[type];
}

/**
 * Get all provider definitions
 */
export function getAllProviders(): ProviderDefinition[] {
  return Object.values(PROVIDER_DEFINITIONS);
}

/**
 * Get recommended model for a provider
 */
export function getRecommendedModel(type: ProviderType): ModelDefinition | undefined {
  const provider = PROVIDER_DEFINITIONS[type];
  return provider.models.find((m) => m.recommended) ?? provider.models[0];
}

/**
 * Get all available providers that have API keys configured
 */
export function getConfiguredProviders(): ProviderDefinition[] {
  return getAllProviders().filter((p) => !!process.env[p.envVar]);
}

/**
 * Check if a provider is configured
 */
export function isProviderConfigured(type: ProviderType): boolean {
  return !!process.env[PROVIDER_DEFINITIONS[type].envVar];
}

/**
 * Format model info for display
 */
export function formatModelInfo(model: ModelDefinition): string {
  let info = model.name;
  if (model.description) {
    info += ` - ${model.description}`;
  }
  if (model.contextWindow) {
    info += ` (${Math.round(model.contextWindow / 1000)}k ctx)`;
  }
  if (model.recommended) {
    info = `⭐ ${info}`;
  }
  return info;
}

/**
 * Get provider by ID
 */
export function getProviderById(id: string): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS[id as ProviderType];
}
