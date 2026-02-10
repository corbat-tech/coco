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
 * When you need to update models, edit this file AND sync the other files!
 *
 * === QUICK UPDATE COMMAND ===
 *
 * Just say: "Actualiza proveedores" and provide this context:
 *
 * 1. Search the web for latest models from each provider:
 *    - Anthropic: https://docs.anthropic.com/en/docs/about-claude/models
 *    - OpenAI: https://platform.openai.com/docs/models
 *    - Google Gemini: https://ai.google.dev/gemini-api/docs/models/gemini
 *    - Moonshot Kimi: https://platform.moonshot.ai/docs
 *    - LM Studio: Check popular models on Hugging Face
 *
 * 2. Update these files (in order):
 *    a) THIS FILE (providers-config.ts):
 *       - models[] array for each provider
 *       - contextWindow and maxOutputTokens
 *       - description with release date
 *       - recommended: true for best model
 *
 *    b) src/providers/{provider}.ts:
 *       - DEFAULT_MODEL constant
 *       - CONTEXT_WINDOWS record
 *
 *    c) src/config/env.ts:
 *       - getDefaultModel() switch cases
 *
 * 3. Verify:
 *    - apiKeyUrl is still valid
 *    - baseUrl hasn't changed
 *    - OAuth client IDs (if any) in src/auth/oauth.ts
 *
 * === FILES TO SYNC ===
 *
 * PRIMARY (edit first):
 * - src/cli/repl/providers-config.ts (this file)
 *
 * SECONDARY (sync DEFAULT_MODEL and CONTEXT_WINDOWS):
 * - src/providers/anthropic.ts
 * - src/providers/openai.ts
 * - src/providers/gemini.ts
 * - src/providers/codex.ts
 * - src/config/env.ts (getDefaultModel function)
 *
 * CONSUMERS (no changes needed, they read from this file):
 * - src/cli/repl/commands/model.ts
 * - src/cli/repl/commands/provider.ts
 * - src/cli/repl/onboarding-v2.ts
 * - src/cli/commands/config.ts
 *
 * === OAUTH CONFIG ===
 *
 * If OAuth endpoints change, update:
 * - src/auth/oauth.ts (OAUTH_CONFIGS)
 * - src/auth/flow.ts (getProviderDisplayInfo)
 *
 * ============================================================================
 * Last updated: February 5, 2026
 *
 * CURRENT MODELS (verified from official docs):
 * - Anthropic: claude-opus-4-6-20260115 (latest), claude-sonnet-4-5, claude-haiku-4-5
 * - OpenAI: gpt-5.2-codex, gpt-5.2-thinking, gpt-5.2-pro
 * - Gemini: gemini-3-flash-preview, gemini-3-pro-preview, gemini-2.5-pro
 * - Kimi: kimi-k2.5 (latest)
 * - LM Studio: qwen3-coder series (best local option)
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
  /** Whether to ask for custom URL during setup (for proxies, local servers, etc.) */
  askForCustomUrl?: boolean;
  /** Whether API key is required (false for local providers like LM Studio) */
  requiresApiKey?: boolean;
  /** Whether provider supports gcloud ADC authentication */
  supportsGcloudADC?: boolean;
  /** Whether provider supports OAuth authentication (e.g., Google account login for Gemini) */
  supportsOAuth?: boolean;
  /** Internal provider - not shown in user selection (e.g., "codex" is internal, "openai" is user-facing) */
  internal?: boolean;
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
    description: "Best for coding, agents, and reasoning",
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
    // Updated: February 2026 - Claude 4.6 is latest
    models: [
      {
        id: "claude-opus-4-6-20260115",
        name: "Claude Opus 4.6",
        description: "Most capable - coding, agents & complex tasks (Jan 2026)",
        contextWindow: 200000,
        maxOutputTokens: 128000,
        recommended: true,
      },
      {
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        description: "Best balance of speed and capability (Sep 2025)",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        description: "Fastest and cheapest (Oct 2025)",
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
      {
        id: "claude-opus-4-5-20251124",
        name: "Claude Opus 4.5",
        description: "Previous flagship (Nov 2025)",
        contextWindow: 200000,
        maxOutputTokens: 32000,
      },
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        description: "Stable production model (May 2025)",
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
    ],
  },

  openai: {
    id: "openai",
    name: "OpenAI",
    emoji: "🟢",
    description: "GPT-5.2 and Codex models",
    envVar: "OPENAI_API_KEY",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs",
    baseUrl: "https://api.openai.com/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    askForCustomUrl: false, // OpenAI has fixed endpoint
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    // Updated: January 2026 - GPT-5.2 series is latest
    models: [
      {
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        description: "Best for coding & software engineering (Jan 2026)",
        contextWindow: 400000,
        maxOutputTokens: 128000,
        recommended: true,
      },
      {
        id: "gpt-5.2-thinking",
        name: "GPT-5.2 Thinking",
        description: "Deep reasoning for complex tasks (Dec 2025)",
        contextWindow: 400000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5.2-instant",
        name: "GPT-5.2 Instant",
        description: "Fast everyday workhorse (Dec 2025)",
        contextWindow: 400000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5.2-pro",
        name: "GPT-5.2 Pro",
        description: "Most intelligent for hard problems (Dec 2025)",
        contextWindow: 400000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        description: "Legacy multimodal model (retiring Feb 2026)",
        contextWindow: 128000,
        maxOutputTokens: 16384,
      },
    ],
  },

  // Codex - ChatGPT Plus/Pro via OAuth (same models as OpenAI but uses subscription)
  codex: {
    id: "codex",
    name: "OpenAI Codex (ChatGPT Plus/Pro)",
    emoji: "🟣",
    description: "Use your ChatGPT Plus/Pro subscription via OAuth",
    envVar: "OPENAI_CODEX_TOKEN", // Not actually used, we use OAuth tokens
    apiKeyUrl: "https://chatgpt.com/",
    docsUrl: "https://openai.com/chatgpt/pricing",
    baseUrl: "https://chatgpt.com/backend-api/codex/responses",
    supportsCustomModels: false,
    openaiCompatible: false, // Uses different API format
    requiresApiKey: false, // Uses OAuth
    internal: true, // Hidden from user - use "openai" with OAuth instead
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    models: [
      {
        id: "gpt-5-codex",
        name: "GPT-5 Codex",
        description: "Best coding model via ChatGPT subscription",
        contextWindow: 200000,
        maxOutputTokens: 128000,
        recommended: true,
      },
      {
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        description: "Latest advanced coding model",
        contextWindow: 200000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5",
        name: "GPT-5",
        description: "General-purpose reasoning model",
        contextWindow: 200000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        description: "Latest general-purpose model",
        contextWindow: 200000,
        maxOutputTokens: 128000,
      },
    ],
  },

  gemini: {
    id: "gemini",
    name: "Google Gemini",
    emoji: "🔵",
    description: "Gemini 3 and 2.5 models",
    envVar: "GEMINI_API_KEY",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    supportsCustomModels: true,
    openaiCompatible: false,
    supportsGcloudADC: true, // Supports gcloud auth application-default login
    // NOTE: OAuth removed - Google's client ID is restricted to official apps only
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    // Updated: February 2026 - Gemini 3 series is latest (use -preview suffix)
    models: [
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        description: "Fast with PhD-level reasoning - 1M context (Jan 2026)",
        contextWindow: 1000000,
        maxOutputTokens: 65536,
        recommended: true,
      },
      {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        description: "Most powerful - beats 19/20 benchmarks (Jan 2026)",
        contextWindow: 1000000,
        maxOutputTokens: 65536,
      },
      {
        id: "gemini-2.5-pro-preview-05-06",
        name: "Gemini 2.5 Pro",
        description: "Production tier - complex reasoning & coding (stable)",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
      {
        id: "gemini-2.5-flash-preview-05-20",
        name: "Gemini 2.5 Flash",
        description: "Production tier - fast with thinking budgets",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Stable GA model - good for most tasks",
        contextWindow: 1048576,
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
    askForCustomUrl: true, // Some users may use proxies
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

  // LM Studio - Local models via OpenAI-compatible API
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio (Local)",
    emoji: "🖥️",
    description: "Run models locally - free, private, no API key needed",
    envVar: "LMSTUDIO_API_KEY", // Placeholder, not actually required
    apiKeyUrl: "https://lmstudio.ai/",
    docsUrl: "https://lmstudio.ai/docs",
    baseUrl: "http://localhost:1234/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    askForCustomUrl: true, // User might use different port
    requiresApiKey: false, // LM Studio doesn't need API key
    features: {
      streaming: true,
      functionCalling: true, // Some models support it
      vision: false, // Most local models don't support vision
    },
    // Updated: January 2026 - Qwen3-Coder is the new best
    // Search these names in LM Studio to download
    models: [
      // Qwen3-Coder - State of the art (July 2025)
      {
        id: "qwen3-coder-3b-instruct",
        name: "⚡ Qwen3 Coder 3B",
        description: "Search: 'qwen3 coder 3b' (8GB RAM)",
        contextWindow: 256000,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "qwen3-coder-8b-instruct",
        name: "🎯 Qwen3 Coder 8B",
        description: "Search: 'qwen3 coder 8b' (16GB RAM)",
        contextWindow: 256000,
        maxOutputTokens: 8192,
      },
      {
        id: "qwen3-coder-14b-instruct",
        name: "💪 Qwen3 Coder 14B",
        description: "Search: 'qwen3 coder 14b' (32GB RAM)",
        contextWindow: 256000,
        maxOutputTokens: 8192,
      },
      // DeepSeek - Great alternative
      {
        id: "deepseek-coder-v3-lite",
        name: "DeepSeek Coder V3 Lite",
        description: "Search: 'deepseek coder v3' (16GB RAM)",
        contextWindow: 128000,
        maxOutputTokens: 8192,
      },
      // Codestral - Mistral's coding model
      {
        id: "codestral-22b",
        name: "Codestral 22B",
        description: "Search: 'codestral' (24GB RAM)",
        contextWindow: 32768,
        maxOutputTokens: 8192,
      },
      // Legacy but still good
      {
        id: "qwen2.5-coder-7b-instruct",
        name: "Qwen 2.5 Coder 7B",
        description: "Search: 'qwen 2.5 coder 7b' (16GB RAM)",
        contextWindow: 32768,
        maxOutputTokens: 8192,
      },
    ],
  },

  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    emoji: "🦙",
    description: "Run models locally with Ollama - free, private, easy setup",
    envVar: "OLLAMA_API_KEY", // Placeholder, not actually required
    apiKeyUrl: "https://ollama.com/",
    docsUrl: "https://ollama.com/library",
    baseUrl: "http://localhost:11434/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    askForCustomUrl: true,
    requiresApiKey: false,
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    models: [
      {
        id: "qwen3:8b",
        name: "⚡ Qwen3 8B",
        description: "ollama pull qwen3:8b (16GB RAM)",
        contextWindow: 128000,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "deepseek-coder-v2:16b",
        name: "🎯 DeepSeek Coder V2 16B",
        description: "ollama pull deepseek-coder-v2:16b (32GB RAM)",
        contextWindow: 128000,
        maxOutputTokens: 8192,
      },
      {
        id: "codestral:22b",
        name: "Codestral 22B",
        description: "ollama pull codestral:22b (24GB RAM)",
        contextWindow: 32768,
        maxOutputTokens: 8192,
      },
      {
        id: "llama3.1:8b",
        name: "Llama 3.1 8B",
        description: "ollama pull llama3.1:8b (16GB RAM)",
        contextWindow: 128000,
        maxOutputTokens: 8192,
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
 * Get all provider definitions for user selection
 * Excludes internal providers like "codex" that shouldn't be shown to users
 */
export function getAllProviders(): ProviderDefinition[] {
  return Object.values(PROVIDER_DEFINITIONS).filter((p) => !p.internal);
}

/**
 * Get all provider definitions including internal ones
 * Use this for internal lookups (e.g., getProviderDefinition)
 */
export function getAllProvidersIncludingInternal(): ProviderDefinition[] {
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
