/**
 * Provider Configuration
 *
 * Inspired by OpenCode/Crush - Flexible provider management
 *
 * Model metadata is derived from src/providers/catalog.ts. Keep provider UI,
 * auth, and transport metadata here; do not maintain an independent model list.
 *
 * Update flow:
 * 1. Verify models against official provider docs or runtime discovery.
 * 2. Update src/providers/catalog.ts with defaults, status, capabilities,
 *    context windows, pricing, sourceUrl, and lastVerified.
 * 3. Keep transport-specific behavior in src/providers/{provider}.ts only when
 *    request/stream/tool-call semantics actually differ by provider.
 * 4. Run provider/catalog tests and pnpm check.
 *
 * If OAuth endpoints change, update:
 * - src/auth/oauth.ts (OAUTH_CONFIGS)
 * - src/auth/flow.ts (getProviderDisplayInfo)
 */

import { accessSync } from "node:fs";
import { getCopilotCredentialsPath } from "../../auth/copilot.js";
import type { ProviderType } from "../../providers/index.js";
import {
  PROVIDER_CATALOG,
  type ModelCapability,
  type ModelStatus,
  type ProviderSource,
} from "../../providers/catalog.js";

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
  status?: ModelStatus;
  capabilities?: ModelCapability[];
  sourceUrl?: string;
  lastVerified?: string;
}

/**
 * Provider payment type
 * - "api"      → pay per token (API key required)
 * - "sub"      → subscription required (e.g., ChatGPT Plus/Pro)
 * - "free"     → completely free (local providers)
 * - "freemium" → free tier available, paid tiers for higher limits
 */
export type ProviderPaymentType = "api" | "sub" | "free" | "freemium";

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
  /** Payment model: api, sub, free, or freemium */
  paymentType: ProviderPaymentType;
  /** Whether to ask for custom URL during setup (for proxies, local servers, etc.) */
  askForCustomUrl?: boolean;
  /** Whether API key is required (false for local providers like LM Studio) */
  requiresApiKey?: boolean;
  /** Whether provider supports gcloud ADC authentication */
  supportsGcloudADC?: boolean;
  /** Whether provider supports OAuth authentication */
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
const LEGACY_PROVIDER_DEFINITIONS: Record<ProviderType, ProviderDefinition> = {
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
    paymentType: "api",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    // Updated: March 2026 — from docs.anthropic.com/en/docs/about-claude/models
    models: [],
  },

  openai: {
    id: "openai",
    name: "OpenAI",
    emoji: "🟢",
    description: "GPT-5.3 Codex and reasoning models",
    envVar: "OPENAI_API_KEY",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs",
    baseUrl: "https://api.openai.com/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    askForCustomUrl: false, // OpenAI has fixed endpoint
    paymentType: "api",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    // Updated: March 2026 — from platform.openai.com/docs/models
    models: [],
  },

  // GitHub Copilot - Use your Copilot subscription to access multiple models
  copilot: {
    id: "copilot",
    name: "GitHub Copilot",
    emoji: "🐙",
    description: "Use your GitHub Copilot subscription — Claude, GPT, Gemini models",
    envVar: "GITHUB_TOKEN", // Optional override; primary auth is device flow
    apiKeyUrl: "https://github.com/settings/copilot",
    docsUrl: "https://docs.github.com/en/copilot",
    baseUrl: "https://api.githubcopilot.com",
    supportsCustomModels: true,
    openaiCompatible: true,
    requiresApiKey: false, // Uses GitHub device flow
    supportsOAuth: true, // Device flow auth
    paymentType: "sub",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    // Updated: April 2026 — from docs.github.com/en/copilot/reference/ai-models/supported-models
    // Premium request multipliers in descriptions are for paid Copilot plans.
    models: [],
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
    paymentType: "sub",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    models: [],
  },

  gemini: {
    id: "gemini",
    name: "Google Gemini",
    emoji: "🔵",
    description: "Gemini Developer API via AI Studio API key",
    envVar: "GEMINI_API_KEY",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    supportsCustomModels: true,
    openaiCompatible: false,
    paymentType: "freemium",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    // Updated: March 2026 — from ai.google.dev/gemini-api/docs/models
    // gemini-3-pro-preview deprecated March 9, 2026 → use 3.1-pro-preview
    models: [],
  },

  vertex: {
    id: "vertex",
    name: "Google Vertex AI Gemini",
    emoji: "☁️",
    description: "Gemini on Vertex AI with GCP project, IAM and ADC",
    envVar: "VERTEX_API_KEY",
    apiKeyUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys",
    docsUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart",
    baseUrl: "https://aiplatform.googleapis.com/v1",
    supportsCustomModels: true,
    openaiCompatible: false,
    supportsGcloudADC: true,
    paymentType: "api",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    models: [],
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
    paymentType: "api",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true, // K2.5 supports vision
    },
    models: [],
  },

  // Kimi Code - Kimi subscription endpoint
  "kimi-code": {
    id: "kimi-code",
    name: "Kimi Code",
    emoji: "🤖",
    description: "Kimi Code subscription — quota included in Kimi membership, no per-token cost",
    envVar: "KIMI_CODE_API_KEY",
    apiKeyUrl: "https://www.kimi.com/code",
    docsUrl: "https://www.kimi.com/code/docs/en/",
    baseUrl: "https://api.kimi.com/coding/v1",
    supportsCustomModels: false,
    openaiCompatible: true,
    paymentType: "sub",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    models: [],
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
    paymentType: "free",
    features: {
      streaming: true,
      functionCalling: true, // Some models support it
      vision: false, // Most local models don't support vision
    },
    // Updated: January 2026 - Qwen3-Coder is the new best
    // Search these names in LM Studio to download
    models: [],
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
    paymentType: "free",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    // Updated: February 2026 - qwen2.5-coder:14b is best balance for most users
    models: [],
  },

  // Groq - Ultra-fast inference API (freemium)
  groq: {
    id: "groq",
    name: "Groq",
    emoji: "⚡",
    description: "Ultra-fast inference — fastest API available",
    envVar: "GROQ_API_KEY",
    apiKeyUrl: "https://console.groq.com/keys",
    docsUrl: "https://console.groq.com/docs",
    baseUrl: "https://api.groq.com/openai/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "freemium",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    models: [],
  },

  // OpenRouter - Routes to 100+ models via one API
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    emoji: "🔀",
    description: "Access 100+ models from one API key",
    envVar: "OPENROUTER_API_KEY",
    apiKeyUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs",
    baseUrl: "https://openrouter.ai/api/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "api",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    models: [],
  },

  // Mistral AI - French AI lab, strong coding models
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    emoji: "🌊",
    description: "Codestral and Mistral models — European AI",
    envVar: "MISTRAL_API_KEY",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    docsUrl: "https://docs.mistral.ai",
    baseUrl: "https://api.mistral.ai/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "api",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    models: [],
  },

  // DeepSeek - Chinese AI lab, very competitive pricing
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    emoji: "🔍",
    description: "Excellent coding at ultra-low cost",
    envVar: "DEEPSEEK_API_KEY",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    docsUrl: "https://platform.deepseek.com/docs",
    baseUrl: "https://api.deepseek.com/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "api",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    models: [],
  },

  // Together AI - Fast inference, many open models
  together: {
    id: "together",
    name: "Together AI",
    emoji: "🤝",
    description: "Fast inference for open-source models",
    envVar: "TOGETHER_API_KEY",
    apiKeyUrl: "https://api.together.ai/settings/api-keys",
    docsUrl: "https://docs.together.ai",
    baseUrl: "https://api.together.xyz/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "api",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    models: [],
  },

  // Alibaba Qwen - DashScope API (OpenAI-compatible)
  qwen: {
    id: "qwen",
    name: "Alibaba Qwen",
    emoji: "🟦",
    description: "Qwen models via Alibaba DashScope — strong coding at low cost",
    envVar: "DASHSCOPE_API_KEY",
    apiKeyUrl: "https://modelstudio.console.alibabacloud.com",
    docsUrl: "https://help.aliyun.com/zh/model-studio/developer-reference/",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "api",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    models: [],
  },

  // HuggingFace Inference - Free tier for open models
  huggingface: {
    id: "huggingface",
    name: "HuggingFace Inference",
    emoji: "🤗",
    description: "Open models with free inference tier",
    envVar: "HF_TOKEN",
    apiKeyUrl: "https://huggingface.co/settings/tokens",
    docsUrl: "https://huggingface.co/docs/api-inference",
    baseUrl: "https://router.huggingface.co/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "freemium",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    models: [],
  },
  xai: {
    id: "xai",
    name: "xAI Grok",
    emoji: "\ud83c\udf10",
    description: "xAI Grok",
    envVar: "XAI_API_KEY",
    apiKeyUrl: "https://docs.x.ai/developers/models",
    baseUrl: "https://api.x.ai/v1",
    docsUrl: "https://docs.x.ai/developers/models",
    models: [],
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "api",
    askForCustomUrl: false,
    requiresApiKey: true,
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    emoji: "\ud83c\udf10",
    description: "MiniMax",
    envVar: "MINIMAX_API_KEY",
    apiKeyUrl: "https://platform.minimax.io/docs/api-reference/text-openai-api",
    baseUrl: "https://api.minimax.io/v1",
    docsUrl: "https://platform.minimax.io/docs/api-reference/text-openai-api",
    models: [],
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "api",
    askForCustomUrl: false,
    requiresApiKey: true,
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    emoji: "\ud83c\udf10",
    description: "Cerebras",
    envVar: "CEREBRAS_API_KEY",
    apiKeyUrl: "https://inference-docs.cerebras.ai/resources/openai",
    baseUrl: "https://api.cerebras.ai/v1",
    docsUrl: "https://inference-docs.cerebras.ai/resources/openai",
    models: [],
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "api",
    askForCustomUrl: false,
    requiresApiKey: true,
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
  },
  "azure-openai": {
    id: "azure-openai",
    name: "Azure OpenAI",
    emoji: "\ud83c\udf10",
    description: "Azure OpenAI",
    envVar: "AZURE_OPENAI_API_KEY",
    apiKeyUrl: "https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses",
    baseUrl: "",
    docsUrl: "https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses",
    models: [],
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "api",
    askForCustomUrl: true,
    requiresApiKey: true,
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
  },
  bedrock: {
    id: "bedrock",
    name: "Amazon Bedrock",
    emoji: "\ud83c\udf10",
    description: "Amazon Bedrock",
    envVar: "AWS_BEARER_TOKEN_BEDROCK",
    apiKeyUrl: "https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html",
    baseUrl: "",
    docsUrl: "https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html",
    models: [],
    supportsCustomModels: true,
    openaiCompatible: false,
    paymentType: "api",
    askForCustomUrl: false,
    requiresApiKey: false,
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
  },
};

function catalogModelToDefinition(model: {
  id: string;
  name: string;
  description?: string;
  contextWindow: number;
  maxOutputTokens?: number;
  recommended?: boolean;
  status: ModelStatus;
  capabilities: ModelCapability[];
  source: ProviderSource;
}): ModelDefinition {
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    recommended: model.recommended,
    status: model.status,
    capabilities: model.capabilities,
    sourceUrl: model.source.url,
    lastVerified: model.source.verifiedAt,
  };
}

export const PROVIDER_DEFINITIONS: Record<ProviderType, ProviderDefinition> = Object.fromEntries(
  Object.entries(LEGACY_PROVIDER_DEFINITIONS).map(([providerId, providerDefinition]) => {
    const catalogEntry = PROVIDER_CATALOG[providerId as ProviderType];
    return [
      providerId,
      {
        ...providerDefinition,
        models: catalogEntry.models.map(catalogModelToDefinition),
      },
    ];
  }),
) as Record<ProviderType, ProviderDefinition>;

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
 * Check if Copilot credentials file exists (sync check for UI)
 */
function hasCopilotCredentials(): boolean {
  try {
    accessSync(getCopilotCredentialsPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect whether a local provider was explicitly configured by the user.
 */
function hasLocalProviderConfig(type: "lmstudio" | "ollama"): boolean {
  if (type === "lmstudio") {
    return (
      process.env["COCO_PROVIDER"] === "lmstudio" ||
      !!process.env["LMSTUDIO_MODEL"] ||
      !!process.env["LMSTUDIO_BASE_URL"]
    );
  }
  return (
    process.env["COCO_PROVIDER"] === "ollama" ||
    !!process.env["OLLAMA_MODEL"] ||
    !!process.env["OLLAMA_BASE_URL"]
  );
}

/**
 * Get all available providers that have API keys configured.
 *
 * For most providers, checks env vars. For copilot, checks the
 * stored credentials file (since its primary auth is device flow).
 */
export function getConfiguredProviders(): ProviderDefinition[] {
  return getAllProviders().filter((p) => {
    if (p.id === "azure-openai" || p.id === "bedrock") return isProviderConfigured(p.id);
    if (p.id === "copilot") {
      return !!process.env["GITHUB_TOKEN"] || !!process.env["GH_TOKEN"] || hasCopilotCredentials();
    }
    if (p.id === "openai") {
      return (
        !!process.env[p.envVar] ||
        !!process.env["OPENAI_CODEX_TOKEN"] ||
        !!process.env["OPENAI_ACCESS_TOKEN"]
      );
    }
    if (p.id === "lmstudio" || p.id === "ollama") {
      return hasLocalProviderConfig(p.id);
    }
    if (p.id === "vertex") {
      return !!(
        process.env["VERTEX_API_KEY"] ??
        process.env["GOOGLE_API_KEY"] ??
        process.env["VERTEX_PROJECT"] ??
        process.env["GOOGLE_CLOUD_PROJECT"] ??
        process.env["GCLOUD_PROJECT"]
      );
    }
    return !!process.env[p.envVar];
  });
}

/**
 * Check if a provider is configured
 */
export function isProviderConfigured(type: ProviderType): boolean {
  if (type === "azure-openai")
    return !!process.env["AZURE_OPENAI_ENDPOINT"] && !!process.env["AZURE_OPENAI_DEPLOYMENT"];
  if (type === "bedrock") return !!(process.env["AWS_REGION"] || process.env["AWS_DEFAULT_REGION"]);
  if (type === "copilot") {
    return !!process.env["GITHUB_TOKEN"] || !!process.env["GH_TOKEN"] || hasCopilotCredentials();
  }
  if (type === "openai") {
    return (
      !!process.env["OPENAI_API_KEY"] ||
      !!process.env["OPENAI_CODEX_TOKEN"] ||
      !!process.env["OPENAI_ACCESS_TOKEN"]
    );
  }
  if (type === "lmstudio" || type === "ollama") {
    return hasLocalProviderConfig(type);
  }
  if (type === "vertex") {
    return !!(
      process.env["VERTEX_API_KEY"] ??
      process.env["GOOGLE_API_KEY"] ??
      process.env["VERTEX_PROJECT"] ??
      process.env["GOOGLE_CLOUD_PROJECT"] ??
      process.env["GCLOUD_PROJECT"]
    );
  }
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
