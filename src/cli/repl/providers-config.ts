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
 *    - Ollama: https://ollama.com/library (check coding models)
 *
 * 2. Update these files (in order):
 *    a) THIS FILE (providers-config.ts):
 *       - ADD new models to models[] array for each provider
 *       - contextWindow and maxOutputTokens
 *       - description with release date
 *       - recommended: true for best model
 *       - Move recommended to the new best model
 *
 *    b) src/providers/{provider}.ts:
 *       - DEFAULT_MODEL constant
 *       - CONTEXT_WINDOWS record
 *
 *    c) src/config/env.ts:
 *       - getDefaultModel() switch cases
 *
 *    d) src/providers/pricing.ts:
 *       - MODEL_PRICING entries for new models
 *
 * 3. Verify:
 *    - apiKeyUrl is still valid
 *    - baseUrl hasn't changed
 *    - OAuth client IDs (if any) in src/auth/oauth.ts
 *
 * === IMPORTANT RULES ===
 *
 * - NEVER remove models that are still available in the provider's API.
 *   Users may prefer older/cheaper models. Always ADD new models and
 *   reorder so the best is first (recommended: true), but keep all
 *   available models in the list. Only remove a model if the provider
 *   has fully retired/disabled it and it no longer works.
 * - Order models from best/newest to oldest/cheapest.
 * - Include RAM requirements in descriptions for local providers
 *   (Ollama, LM Studio) so users can choose based on their hardware.
 *
 * === FILES TO SYNC ===
 *
 * PRIMARY (edit first):
 * - src/cli/repl/providers-config.ts (this file)
 *
 * SECONDARY (sync DEFAULT_MODEL and CONTEXT_WINDOWS):
 * - src/providers/index.ts (ProviderType union, createProvider() switch, listProviders())
 * - src/providers/anthropic.ts
 * - src/providers/openai.ts
 * - src/providers/gemini.ts
 * - src/providers/codex.ts
 * - src/config/env.ts (ProviderType union, getApiKey, getBaseUrl, getDefaultModel, VALID_PROVIDERS)
 * - src/providers/pricing.ts (MODEL_PRICING for new models)
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
 * Last updated: March 5, 2026
 *
 * CURRENT MODELS (verified from official docs):
 * - Anthropic: claude-opus-4-6 (latest), claude-sonnet-4-6, claude-haiku-4-5
 * - OpenAI: gpt-5.3-codex (latest), gpt-5.2-codex, gpt-5.1-codex-max, gpt-4.1
 * - Gemini: gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-2.5-pro, gemini-2.5-flash
 * - Copilot: claude-sonnet-4.6, claude-opus-4.6, gpt-5.3-codex, gpt-4.1, gemini-3.1-pro-preview
 * - Kimi: kimi-k2.5, kimi-k2-thinking
 * - Qwen: qwen-coder-plus (recommended), qwen-max, qwen-plus, qwen-turbo, qwq-plus
 * - LM Studio: qwen3-coder series (best local option)
 * - Ollama: qwen2.5-coder:14b (recommended), qwen3-coder:30b
 * ============================================================================
 */

import { accessSync } from "node:fs";
import { getCopilotCredentialsPath } from "../../auth/copilot.js";
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
    paymentType: "api",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    // Updated: March 2026 — from docs.anthropic.com/en/docs/about-claude/models
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        description: "Most intelligent — agents, coding & complex tasks",
        contextWindow: 200000,
        maxOutputTokens: 128000,
        recommended: true,
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        description: "Best speed + intelligence balance (1M beta)",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        description: "Fastest and cheapest",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
      {
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        description: "Previous balanced model (Sep 2025)",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
      {
        id: "claude-opus-4-5-20251101",
        name: "Claude Opus 4.5",
        description: "Previous flagship (Nov 2025)",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
      {
        id: "claude-opus-4-1-20250805",
        name: "Claude Opus 4.1",
        description: "Legacy model (Aug 2025)",
        contextWindow: 200000,
        maxOutputTokens: 32000,
      },
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        description: "Stable production model (May 2025)",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
    ],
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
    models: [
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        description: "Latest agentic coding model (Feb 2026)",
        contextWindow: 400000,
        maxOutputTokens: 128000,
        recommended: true,
      },
      {
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        description: "Previous coding model — stable (Jan 2026)",
        contextWindow: 400000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5.1-codex-max",
        name: "GPT-5.1 Codex Max",
        description: "Frontier model for long-running project-scale work",
        contextWindow: 400000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        description: "Flagship reasoning model (Dec 2025)",
        contextWindow: 400000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5.1",
        name: "GPT-5.1",
        description: "General-purpose model (2025)",
        contextWindow: 400000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        description: "Best for long context — 1M window",
        contextWindow: 1048576,
        maxOutputTokens: 32768,
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        description: "Fast & cheap long context — 1M window",
        contextWindow: 1048576,
        maxOutputTokens: 32768,
      },
      {
        id: "o4-mini",
        name: "o4-mini",
        description: "Fast reasoning model",
        contextWindow: 200000,
        maxOutputTokens: 100000,
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        description: "Multimodal model — cheaper option (legacy)",
        contextWindow: 128000,
        maxOutputTokens: 16384,
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        description: "Cheapest OpenAI model (legacy)",
        contextWindow: 128000,
        maxOutputTokens: 16384,
      },
    ],
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
    // Updated: March 2026 — from docs.github.com/en/copilot/reference/ai-models/supported-models
    models: [
      // Anthropic models
      {
        id: "claude-sonnet-4.6",
        name: "Claude Sonnet 4.6",
        description: "Anthropic's latest balanced model via Copilot",
        contextWindow: 200000,
        maxOutputTokens: 64000,
        recommended: true,
      },
      {
        id: "claude-opus-4.6",
        name: "Claude Opus 4.6",
        description: "Anthropic's most intelligent model via Copilot",
        contextWindow: 200000,
        maxOutputTokens: 128000,
      },
      {
        id: "claude-sonnet-4.5",
        name: "Claude Sonnet 4.5",
        description: "Previous balanced Claude model via Copilot",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
      {
        id: "claude-opus-4.5",
        name: "Claude Opus 4.5",
        description: "Previous flagship Claude model via Copilot",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
      {
        id: "claude-haiku-4.5",
        name: "Claude Haiku 4.5",
        description: "Fast and affordable Claude model via Copilot",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
      // OpenAI models (Codex/GPT-5+ use /responses API, others use /chat/completions)
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        description: "OpenAI's latest coding model via Copilot",
        contextWindow: 400000,
        maxOutputTokens: 128000,
        recommended: true,
      },
      {
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        description: "OpenAI's previous coding model via Copilot",
        contextWindow: 400000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5.1-codex-max",
        name: "GPT-5.1 Codex Max",
        description: "Frontier agentic coding model via Copilot",
        contextWindow: 400000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        description: "OpenAI long-context model via Copilot (1M)",
        contextWindow: 1048576,
        maxOutputTokens: 32768,
      },
      // Google models
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro",
        description: "Google's latest model via Copilot (1M)",
        contextWindow: 1000000,
        maxOutputTokens: 64000,
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        description: "Google's fast model via Copilot (1M)",
        contextWindow: 1000000,
        maxOutputTokens: 64000,
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Google stable model via Copilot (1M)",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
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
    paymentType: "sub",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    models: [
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        description: "Latest coding model via ChatGPT subscription (Feb 2026)",
        contextWindow: 200000,
        maxOutputTokens: 128000,
        recommended: true,
      },
      {
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        description: "Previous coding model - stable",
        contextWindow: 200000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5-codex",
        name: "GPT-5 Codex",
        description: "Original GPT-5 coding model",
        contextWindow: 200000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        description: "General-purpose reasoning model",
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
    paymentType: "freemium",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    // Updated: March 2026 — from ai.google.dev/gemini-api/docs/models
    // gemini-3-pro-preview deprecated March 9, 2026 → use 3.1-pro-preview
    models: [
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro",
        description: "Most powerful — agentic & coding (1M context)",
        contextWindow: 1000000,
        maxOutputTokens: 64000,
        recommended: true,
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        description: "Fast frontier-class performance (1M context)",
        contextWindow: 1000000,
        maxOutputTokens: 64000,
      },
      {
        id: "gemini-3.1-flash-lite-preview",
        name: "Gemini 3.1 Flash-Lite",
        description: "Cost-efficient workhorse model (1M context)",
        contextWindow: 1000000,
        maxOutputTokens: 64000,
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Production stable — complex reasoning & coding (GA)",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Production stable — fast with thinking budgets (GA)",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
      {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash-Lite",
        description: "Cheapest stable option (GA)",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
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
    paymentType: "api",
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
        id: "kimi-k2-thinking",
        name: "Kimi K2 Thinking",
        description: "Reasoning variant with extended thinking (256K context)",
        contextWindow: 262144,
        maxOutputTokens: 8192,
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
    models: [
      {
        id: "kimi-for-coding",
        name: "Kimi for Coding",
        description: "Kimi Code model optimised for programming tasks",
        contextWindow: 131072,
        maxOutputTokens: 8192,
        recommended: true,
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
    paymentType: "free",
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
        name: "Qwen3 Coder 3B",
        description: "Search: 'qwen3 coder 3b' (8GB RAM)",
        contextWindow: 256000,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "qwen3-coder-8b-instruct",
        name: "Qwen3 Coder 8B",
        description: "Search: 'qwen3 coder 8b' (16GB RAM)",
        contextWindow: 256000,
        maxOutputTokens: 8192,
      },
      {
        id: "qwen3-coder-14b-instruct",
        name: "Qwen3 Coder 14B",
        description: "Search: 'qwen3 coder 14b' (32GB RAM)",
        contextWindow: 256000,
        maxOutputTokens: 8192,
      },
      {
        id: "qwen3-coder-30b-a3b-instruct",
        name: "Qwen3 Coder 30B MoE",
        description: "Search: 'qwen3 coder 30b' — MoE 30B/3B active (24GB RAM)",
        contextWindow: 262000,
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
    paymentType: "free",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    // Updated: February 2026 - qwen2.5-coder:14b is best balance for most users
    models: [
      {
        id: "qwen2.5-coder:14b",
        name: "Qwen 2.5 Coder 14B",
        description: "Best coding model (16GB RAM)",
        contextWindow: 32768,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "qwen3-coder:30b",
        name: "Qwen3 Coder 30B",
        description: "MoE 30B/3B active, 262K context (24GB RAM)",
        contextWindow: 262144,
        maxOutputTokens: 8192,
      },
      {
        id: "deepseek-r1:14b",
        name: "DeepSeek R1 14B",
        description: "Advanced reasoning model (16GB RAM)",
        contextWindow: 128000,
        maxOutputTokens: 8192,
      },
      {
        id: "codestral:22b",
        name: "Codestral 22B",
        description: "ollama pull codestral:22b — Mistral's coding model (24GB RAM)",
        contextWindow: 32768,
        maxOutputTokens: 8192,
      },
      {
        id: "llama3.1:8b",
        name: "Llama 3.1 8B",
        description: "ollama pull llama3.1:8b — lightest option (8GB RAM)",
        contextWindow: 128000,
        maxOutputTokens: 8192,
      },
    ],
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
    models: [
      {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B Versatile",
        description: "Best for complex tasks — free tier (128K context)",
        contextWindow: 128000,
        maxOutputTokens: 32768,
        recommended: true,
      },
      {
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B Instant",
        description: "Fastest responses — ideal for simple tasks (128K)",
        contextWindow: 128000,
        maxOutputTokens: 8192,
      },
      {
        id: "mixtral-8x7b-32768",
        name: "Mixtral 8x7B",
        description: "Mistral's MoE model — good balance (32K context)",
        contextWindow: 32768,
        maxOutputTokens: 4096,
      },
      {
        id: "gemma2-9b-it",
        name: "Gemma 2 9B",
        description: "Google's compact model (8K context)",
        contextWindow: 8192,
        maxOutputTokens: 4096,
      },
    ],
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
    models: [
      {
        id: "anthropic/claude-opus-4-6",
        name: "Claude Opus 4.6 (via OR)",
        description: "Anthropic's best — via OpenRouter (200K context)",
        contextWindow: 200000,
        maxOutputTokens: 128000,
        recommended: true,
      },
      {
        id: "openai/gpt-5.3-codex",
        name: "GPT-5.3 Codex (via OR)",
        description: "OpenAI's coding model — via OpenRouter",
        contextWindow: 400000,
        maxOutputTokens: 128000,
      },
      {
        id: "google/gemini-3-flash-preview",
        name: "Gemini 3 Flash (via OR)",
        description: "Google's fast model — via OpenRouter (1M context)",
        contextWindow: 1000000,
        maxOutputTokens: 65536,
      },
      {
        id: "meta-llama/llama-3.3-70b-instruct",
        name: "Llama 3.3 70B (via OR)",
        description: "Meta's open model — often free routes available",
        contextWindow: 128000,
        maxOutputTokens: 32768,
      },
    ],
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
    models: [
      {
        id: "codestral-latest",
        name: "Codestral Latest",
        description: "Best coding model — fill-in-middle support (32K)",
        contextWindow: 32768,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "mistral-large-latest",
        name: "Mistral Large",
        description: "Most capable — complex reasoning (128K context)",
        contextWindow: 131072,
        maxOutputTokens: 4096,
      },
      {
        id: "mistral-small-latest",
        name: "Mistral Small",
        description: "Fast and cost-efficient (128K context)",
        contextWindow: 131072,
        maxOutputTokens: 4096,
      },
      {
        id: "open-mixtral-8x22b",
        name: "Mixtral 8x22B",
        description: "Large MoE model — powerful open weights (64K)",
        contextWindow: 65536,
        maxOutputTokens: 4096,
      },
    ],
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
    models: [
      {
        id: "deepseek-coder",
        name: "DeepSeek Coder",
        description: "Specialized coding model — best value (128K context)",
        contextWindow: 128000,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        description: "General purpose — instruction following (64K context)",
        contextWindow: 65536,
        maxOutputTokens: 8192,
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner (R1)",
        description: "Chain-of-thought reasoning model (64K context)",
        contextWindow: 65536,
        maxOutputTokens: 8192,
      },
    ],
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
    models: [
      {
        id: "Qwen/Qwen2.5-Coder-32B-Instruct",
        name: "Qwen 2.5 Coder 32B",
        description: "Best open coding model — 32K context",
        contextWindow: 32768,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "meta-llama/Meta-Llama-3.1-70B-Instruct",
        name: "Llama 3.1 70B",
        description: "Meta's open model — 128K context",
        contextWindow: 128000,
        maxOutputTokens: 8192,
      },
      {
        id: "mistralai/Mixtral-8x7B-Instruct-v0.1",
        name: "Mixtral 8x7B",
        description: "Mistral MoE — fast & capable (32K context)",
        contextWindow: 32768,
        maxOutputTokens: 4096,
      },
    ],
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
    models: [
      {
        id: "qwen-coder-plus",
        name: "Qwen Coder Plus",
        description: "Best coding model — Qwen3 based, 131K context",
        contextWindow: 131072,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "qwen-max",
        name: "Qwen Max",
        description: "Most capable general model — 32K context",
        contextWindow: 32768,
        maxOutputTokens: 8192,
      },
      {
        id: "qwen-plus",
        name: "Qwen Plus",
        description: "Good balance of speed and quality — 131K context",
        contextWindow: 131072,
        maxOutputTokens: 8192,
      },
      {
        id: "qwen-turbo",
        name: "Qwen Turbo",
        description: "Fastest and cheapest — 1M context",
        contextWindow: 1000000,
        maxOutputTokens: 8192,
      },
      {
        id: "qwen2.5-coder-32b-instruct",
        name: "Qwen 2.5 Coder 32B",
        description: "Open weights coding model — 32K context",
        contextWindow: 32768,
        maxOutputTokens: 8192,
      },
      {
        id: "qwq-plus",
        name: "QwQ Plus",
        description: "Reasoning model — chain-of-thought, 131K context",
        contextWindow: 131072,
        maxOutputTokens: 8192,
      },
    ],
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
    baseUrl: "https://api-inference.huggingface.co/v1",
    supportsCustomModels: true,
    openaiCompatible: true,
    paymentType: "freemium",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    models: [
      {
        id: "Qwen/Qwen2.5-Coder-32B-Instruct",
        name: "Qwen 2.5 Coder 32B",
        description: "Best coding model — free tier available (32K)",
        contextWindow: 32768,
        maxOutputTokens: 8192,
        recommended: true,
      },
      {
        id: "meta-llama/Llama-3.3-70B-Instruct",
        name: "Llama 3.3 70B",
        description: "Meta's latest — strong reasoning (128K)",
        contextWindow: 128000,
        maxOutputTokens: 8192,
      },
      {
        id: "microsoft/Phi-4",
        name: "Phi-4",
        description: "Microsoft's small but capable model (16K)",
        contextWindow: 16384,
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
 * Get all available providers that have API keys configured.
 *
 * For most providers, checks env vars. For copilot, checks the
 * stored credentials file (since its primary auth is device flow).
 */
export function getConfiguredProviders(): ProviderDefinition[] {
  return getAllProviders().filter((p) => {
    if (p.id === "copilot") {
      return !!process.env["GITHUB_TOKEN"] || !!process.env["GH_TOKEN"] || hasCopilotCredentials();
    }
    return !!process.env[p.envVar];
  });
}

/**
 * Check if a provider is configured
 */
export function isProviderConfigured(type: ProviderType): boolean {
  if (type === "copilot") {
    return (
      !!process.env["GITHUB_TOKEN"] || !!process.env["GH_TOKEN"] || hasCopilotCredentials()
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
