/**
 * Provider and model catalog.
 *
 * This is the source of truth for model IDs, defaults, context windows,
 * pricing metadata, and provider capabilities. Endpoint adapters still own
 * request/response conversion, but they should read model metadata from here.
 */

import type { ProviderType } from "./index.js";

export type ModelStatus = "current" | "legacy" | "deprecated" | "experimental";

export type ModelCapability =
  | "streaming"
  | "tool-use"
  | "vision"
  | "reasoning-effort"
  | "adaptive-thinking"
  | "thinking-budget"
  | "openai-responses"
  | "openai-chat"
  | "anthropic-messages"
  | "gemini-generate-content";

export interface ProviderSource {
  name: string;
  url: string;
  verifiedAt: string;
}

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  description?: string;
  contextWindow: number;
  maxOutputTokens?: number;
  recommended?: boolean;
  status: ModelStatus;
  capabilities: ModelCapability[];
  pricing?: ModelPricing;
  source: ProviderSource;
}

export interface ProviderCatalogEntry {
  id: ProviderType;
  defaultModel: string;
  models: ModelCatalogEntry[];
}

export type ProviderCatalog = Record<ProviderType, ProviderCatalogEntry>;

const VERIFIED_AT = "2026-06-18";

const SOURCES = {
  openaiModels: {
    name: "OpenAI models",
    url: "https://developers.openai.com/api/docs/models",
    verifiedAt: VERIFIED_AT,
  },
  openaiAllModels: {
    name: "OpenAI all models",
    url: "https://developers.openai.com/api/docs/models/all",
    verifiedAt: VERIFIED_AT,
  },
  codexModels: {
    name: "OpenAI Codex models",
    url: "https://developers.openai.com/codex/models",
    verifiedAt: VERIFIED_AT,
  },
  anthropicModels: {
    name: "Anthropic models overview",
    url: "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    verifiedAt: VERIFIED_AT,
  },
  anthropicDeprecations: {
    name: "Anthropic model deprecations",
    url: "https://docs.anthropic.com/en/docs/about-claude/model-deprecations",
    verifiedAt: VERIFIED_AT,
  },
  geminiModels: {
    name: "Gemini API models",
    url: "https://ai.google.dev/gemini-api/docs/models",
    verifiedAt: VERIFIED_AT,
  },
  geminiGuide: {
    name: "Gemini 3 developer guide",
    url: "https://ai.google.dev/gemini-api/docs/gemini-3",
    verifiedAt: VERIFIED_AT,
  },
  githubCopilotModels: {
    name: "GitHub Copilot supported models",
    url: "https://docs.github.com/copilot/reference/ai-models/supported-models",
    verifiedAt: VERIFIED_AT,
  },
  githubCopilotComparison: {
    name: "GitHub Copilot model comparison",
    url: "https://docs.github.com/en/copilot/reference/ai-models/model-comparison",
    verifiedAt: VERIFIED_AT,
  },
  moonshotDocs: {
    name: "Moonshot AI docs",
    url: "https://platform.moonshot.ai/docs",
    verifiedAt: VERIFIED_AT,
  },
  qwenDocs: {
    name: "Alibaba Cloud Model Studio docs",
    url: "https://www.alibabacloud.com/help/en/model-studio/",
    verifiedAt: VERIFIED_AT,
  },
  providerDocs: {
    name: "Provider API documentation",
    url: "https://github.com/corbat/corbat-coco/blob/main/docs/guides/PROVIDERS.md",
    verifiedAt: VERIFIED_AT,
  },
} satisfies Record<string, ProviderSource>;

function model(
  entry: Omit<ModelCatalogEntry, "source"> & { source?: ProviderSource },
): ModelCatalogEntry {
  return {
    ...entry,
    source: entry.source ?? SOURCES.providerDocs,
  };
}

export const PROVIDER_CATALOG: ProviderCatalog = {
  anthropic: {
    id: "anthropic",
    defaultModel: "claude-sonnet-4-6",
    models: [
      model({
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        description: "Most capable Opus-tier model for complex agentic work",
        contextWindow: 200000,
        maxOutputTokens: 128000,
        status: "current",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "adaptive-thinking",
          "reasoning-effort",
          "anthropic-messages",
        ],
        source: SOURCES.anthropicModels,
      }),
      model({
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        description: "Balanced default for coding, tool use, and long-running tasks",
        contextWindow: 200000,
        maxOutputTokens: 128000,
        recommended: true,
        status: "current",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "adaptive-thinking",
          "reasoning-effort",
          "anthropic-messages",
        ],
        pricing: { inputPerMillion: 3, outputPerMillion: 15 },
        source: SOURCES.anthropicModels,
      }),
      model({
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        description: "Legacy Opus option; prefer Opus 4.8 for new configurations",
        contextWindow: 200000,
        maxOutputTokens: 128000,
        status: "legacy",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "adaptive-thinking",
          "reasoning-effort",
          "anthropic-messages",
        ],
        pricing: { inputPerMillion: 5, outputPerMillion: 25 },
        source: SOURCES.anthropicModels,
      }),
      model({
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        description: "Fast low-cost Claude model",
        contextWindow: 200000,
        maxOutputTokens: 64000,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "anthropic-messages"],
        pricing: { inputPerMillion: 1, outputPerMillion: 5 },
        source: SOURCES.anthropicModels,
      }),
      model({
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        description: "Retired on the Claude API; kept for config migration warnings",
        contextWindow: 200000,
        maxOutputTokens: 64000,
        status: "deprecated",
        capabilities: ["streaming", "tool-use", "vision", "thinking-budget", "anthropic-messages"],
        pricing: { inputPerMillion: 3, outputPerMillion: 15 },
        source: SOURCES.anthropicDeprecations,
      }),
      model({
        id: "claude-opus-4-20250514",
        name: "Claude Opus 4",
        description: "Retired on the Claude API; kept for config migration warnings",
        contextWindow: 200000,
        maxOutputTokens: 64000,
        status: "deprecated",
        capabilities: ["streaming", "tool-use", "vision", "thinking-budget", "anthropic-messages"],
        pricing: { inputPerMillion: 15, outputPerMillion: 75 },
        source: SOURCES.anthropicDeprecations,
      }),
    ],
  },
  openai: {
    id: "openai",
    defaultModel: "gpt-5.5",
    models: [
      model({
        id: "gpt-5.5",
        name: "GPT-5.5",
        description: "Default for complex coding, agentic workflows, and tool-heavy tasks",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "reasoning-effort", "openai-responses"],
        pricing: { inputPerMillion: 5, outputPerMillion: 30 },
        source: SOURCES.openaiModels,
      }),
      model({
        id: "gpt-5.4",
        name: "GPT-5.4",
        description: "Affordable model for coding and professional work",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "reasoning-effort", "openai-responses"],
        source: SOURCES.openaiAllModels,
      }),
      model({
        id: "gpt-5.4-mini",
        name: "GPT-5.4 mini",
        description: "Fast model for lighter coding tasks and subagents",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "reasoning-effort", "openai-responses"],
        source: SOURCES.openaiAllModels,
      }),
      model({
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        description: "Agentic coding model; keep separate from older ChatGPT-only aliases",
        contextWindow: 400000,
        maxOutputTokens: 128000,
        status: "current",
        capabilities: ["streaming", "tool-use", "reasoning-effort", "openai-responses"],
        source: SOURCES.openaiAllModels,
      }),
      model({
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        description: "Deprecated Codex model retained for existing configs",
        contextWindow: 400000,
        maxOutputTokens: 128000,
        status: "deprecated",
        capabilities: ["streaming", "tool-use", "reasoning-effort", "openai-responses"],
        source: SOURCES.openaiAllModels,
      }),
      model({
        id: "gpt-4.1",
        name: "GPT-4.1",
        description: "Legacy long-context non-reasoning model",
        contextWindow: 1048576,
        maxOutputTokens: 32768,
        status: "legacy",
        capabilities: ["streaming", "tool-use", "vision", "openai-chat"],
        pricing: { inputPerMillion: 2, outputPerMillion: 8 },
        source: SOURCES.openaiAllModels,
      }),
    ],
  },
  codex: {
    id: "codex",
    defaultModel: "gpt-5.5",
    models: [
      model({
        id: "gpt-5.5",
        name: "GPT-5.5",
        description: "Recommended Codex model for complex coding work",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "reasoning-effort", "openai-responses"],
        source: SOURCES.codexModels,
      }),
      model({
        id: "gpt-5.4-mini",
        name: "GPT-5.4 mini",
        description: "Faster Codex option for lighter work and subagents",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        status: "current",
        capabilities: ["streaming", "tool-use", "reasoning-effort", "openai-responses"],
        source: SOURCES.codexModels,
      }),
      model({
        id: "gpt-5.3-codex-spark",
        name: "GPT-5.3 Codex Spark",
        description: "Research preview for near-instant coding iteration",
        contextWindow: 400000,
        maxOutputTokens: 128000,
        status: "experimental",
        capabilities: ["streaming", "tool-use", "reasoning-effort", "openai-responses"],
        source: SOURCES.codexModels,
      }),
      model({
        id: "codex-mini-latest",
        name: "Codex mini latest",
        description: "Deprecated fast Codex CLI model retained for existing configs",
        contextWindow: 128000,
        maxOutputTokens: 32000,
        status: "deprecated",
        capabilities: ["streaming", "tool-use", "reasoning-effort", "openai-responses"],
        source: SOURCES.openaiAllModels,
      }),
    ],
  },
  copilot: {
    id: "copilot",
    defaultModel: "claude-sonnet-4.6",
    models: [
      model({
        id: "claude-sonnet-4.6",
        name: "Claude Sonnet 4.6",
        description: "Reliable Copilot default for coding and review",
        contextWindow: 168000,
        maxOutputTokens: 64000,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "openai-chat"],
        source: SOURCES.githubCopilotComparison,
      }),
      model({
        id: "gpt-5.5",
        name: "GPT-5.5",
        description: "Copilot model for complex reasoning and technical decisions",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "openai-chat"],
        source: SOURCES.githubCopilotComparison,
      }),
      model({
        id: "gpt-5.4",
        name: "GPT-5.4",
        description: "Copilot coding model",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "openai-chat"],
        source: SOURCES.githubCopilotModels,
      }),
      model({
        id: "gpt-5.4-mini",
        name: "GPT-5.4 mini",
        description: "Fast Copilot model for interactive coding",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "openai-chat"],
        source: SOURCES.githubCopilotModels,
      }),
      model({
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        description: "Copilot agentic coding model",
        contextWindow: 400000,
        maxOutputTokens: 128000,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
        source: SOURCES.githubCopilotModels,
      }),
      model({
        id: "claude-opus-4.8",
        name: "Claude Opus 4.8",
        description: "Most capable Anthropic model exposed by Copilot when available",
        contextWindow: 168000,
        maxOutputTokens: 64000,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "openai-chat"],
        source: SOURCES.githubCopilotModels,
      }),
      model({
        id: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        description: "Gemini model exposed by Copilot",
        contextWindow: 1000000,
        maxOutputTokens: 64000,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "openai-chat"],
        source: SOURCES.githubCopilotModels,
      }),
      model({
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        description: "Fast Gemini model exposed by Copilot",
        contextWindow: 1000000,
        maxOutputTokens: 64000,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "openai-chat"],
        source: SOURCES.githubCopilotModels,
      }),
    ],
  },
  gemini: {
    id: "gemini",
    defaultModel: "gemini-3.1-pro-preview",
    models: [
      model({
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        description: "Most capable Gemini 3 model for agentic and coding workflows",
        contextWindow: 1000000,
        maxOutputTokens: 64000,
        recommended: true,
        status: "experimental",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "thinking-budget",
          "gemini-generate-content",
        ],
        source: SOURCES.geminiGuide,
      }),
      model({
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview",
        description: "Fast Gemini 3 preview model",
        contextWindow: 1000000,
        maxOutputTokens: 64000,
        status: "experimental",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "thinking-budget",
          "gemini-generate-content",
        ],
        source: SOURCES.geminiGuide,
      }),
      model({
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Stable Gemini Pro model",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        status: "current",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "thinking-budget",
          "gemini-generate-content",
        ],
        source: SOURCES.geminiModels,
      }),
      model({
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Stable fast Gemini model",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        status: "current",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "thinking-budget",
          "gemini-generate-content",
        ],
        source: SOURCES.geminiModels,
      }),
      model({
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash-Lite",
        description: "Lowest-cost stable Gemini option",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        status: "current",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "thinking-budget",
          "gemini-generate-content",
        ],
        source: SOURCES.geminiModels,
      }),
    ],
  },
  vertex: {
    id: "vertex",
    defaultModel: "gemini-2.5-pro",
    models: [
      model({
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Stable Vertex model for coding and complex reasoning",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        recommended: true,
        status: "current",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "thinking-budget",
          "gemini-generate-content",
        ],
        source: SOURCES.geminiModels,
      }),
      model({
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro Preview",
        description: "Preview Vertex Gemini 3 model",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        status: "experimental",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "thinking-budget",
          "gemini-generate-content",
        ],
        source: SOURCES.geminiGuide,
      }),
      model({
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview",
        description: "Fast preview Vertex Gemini 3 model",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        status: "experimental",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "thinking-budget",
          "gemini-generate-content",
        ],
        source: SOURCES.geminiGuide,
      }),
      model({
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Fast stable Vertex Gemini model",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        status: "current",
        capabilities: [
          "streaming",
          "tool-use",
          "vision",
          "thinking-budget",
          "gemini-generate-content",
        ],
        source: SOURCES.geminiModels,
      }),
    ],
  },
  kimi: {
    id: "kimi",
    defaultModel: "kimi-k2.5",
    models: [
      model({
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        description: "Moonshot model for coding and agentic work",
        contextWindow: 262144,
        maxOutputTokens: 32000,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
        source: SOURCES.moonshotDocs,
      }),
      model({
        id: "kimi-k2-thinking",
        name: "Kimi K2 Thinking",
        description: "Reasoning variant",
        contextWindow: 262144,
        maxOutputTokens: 32000,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
        source: SOURCES.moonshotDocs,
      }),
      model({
        id: "moonshot-v1-128k",
        name: "Moonshot v1 128K",
        description: "Legacy long-context Moonshot model",
        contextWindow: 131072,
        maxOutputTokens: 8192,
        status: "legacy",
        capabilities: ["streaming", "tool-use", "openai-chat"],
        pricing: { inputPerMillion: 6, outputPerMillion: 6 },
        source: SOURCES.moonshotDocs,
      }),
    ],
  },
  "kimi-code": {
    id: "kimi-code",
    defaultModel: "kimi-for-coding",
    models: [
      model({
        id: "kimi-for-coding",
        name: "Kimi for Coding",
        description: "Anthropic-compatible Kimi coding endpoint",
        contextWindow: 131072,
        maxOutputTokens: 32000,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "anthropic-messages"],
        source: SOURCES.moonshotDocs,
      }),
    ],
  },
  lmstudio: {
    id: "lmstudio",
    defaultModel: "local-model",
    models: [
      model({
        id: "local-model",
        name: "Local model",
        description: "Model selected in LM Studio",
        contextWindow: 32768,
        maxOutputTokens: 8192,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
      }),
    ],
  },
  ollama: {
    id: "ollama",
    defaultModel: "llama3.2",
    models: [
      model({
        id: "llama3.2",
        name: "Llama 3.2",
        description: "Default local Ollama model",
        contextWindow: 128000,
        maxOutputTokens: 8192,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
      }),
      model({
        id: "qwen2.5-coder:14b",
        name: "Qwen2.5 Coder 14B",
        description: "Local coding model",
        contextWindow: 32768,
        maxOutputTokens: 8192,
        status: "legacy",
        capabilities: ["streaming", "tool-use", "openai-chat"],
      }),
    ],
  },
  groq: {
    id: "groq",
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      model({
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B Versatile",
        contextWindow: 128000,
        maxOutputTokens: 8192,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
      }),
    ],
  },
  openrouter: {
    id: "openrouter",
    defaultModel: "anthropic/claude-sonnet-4.6",
    models: [
      model({
        id: "anthropic/claude-sonnet-4.6",
        name: "Claude Sonnet 4.6 via OpenRouter",
        contextWindow: 200000,
        maxOutputTokens: 64000,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "vision", "openai-chat"],
      }),
    ],
  },
  mistral: {
    id: "mistral",
    defaultModel: "mistral-large-latest",
    models: [
      model({
        id: "mistral-large-latest",
        name: "Mistral Large latest",
        contextWindow: 131072,
        maxOutputTokens: 8192,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
      }),
      model({
        id: "codestral-latest",
        name: "Codestral latest",
        contextWindow: 32768,
        maxOutputTokens: 8192,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
      }),
    ],
  },
  deepseek: {
    id: "deepseek",
    defaultModel: "deepseek-chat",
    models: [
      model({
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        contextWindow: 65536,
        maxOutputTokens: 8192,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
      }),
      model({
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        contextWindow: 65536,
        maxOutputTokens: 8192,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
      }),
    ],
  },
  together: {
    id: "together",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: [
      model({
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        name: "Llama 3.3 70B Instruct Turbo",
        contextWindow: 128000,
        maxOutputTokens: 8192,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
      }),
    ],
  },
  huggingface: {
    id: "huggingface",
    defaultModel: "meta-llama/Llama-3.1-70B-Instruct",
    models: [
      model({
        id: "meta-llama/Llama-3.1-70B-Instruct",
        name: "Llama 3.1 70B Instruct",
        contextWindow: 128000,
        maxOutputTokens: 8192,
        recommended: true,
        status: "legacy",
        capabilities: ["streaming", "openai-chat"],
      }),
    ],
  },
  qwen: {
    id: "qwen",
    defaultModel: "qwen-coder-plus",
    models: [
      model({
        id: "qwen-coder-plus",
        name: "Qwen Coder Plus",
        contextWindow: 131072,
        maxOutputTokens: 8192,
        recommended: true,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
        source: SOURCES.qwenDocs,
      }),
      model({
        id: "qwen-max",
        name: "Qwen Max",
        contextWindow: 131072,
        maxOutputTokens: 8192,
        status: "current",
        capabilities: ["streaming", "tool-use", "openai-chat"],
        source: SOURCES.qwenDocs,
      }),
    ],
  },
};

export function getProviderCatalogEntry(provider: ProviderType): ProviderCatalogEntry {
  return PROVIDER_CATALOG[provider];
}

export function getCatalogDefaultModel(provider: ProviderType): string {
  return getProviderCatalogEntry(provider).defaultModel;
}

export function getCatalogModel(
  provider: ProviderType,
  modelId: string,
): ModelCatalogEntry | undefined {
  return getProviderCatalogEntry(provider).models.find((modelEntry) => modelEntry.id === modelId);
}

export function getCatalogRecommendedModel(provider: ProviderType): ModelCatalogEntry {
  const entry = getProviderCatalogEntry(provider);
  return entry.models.find((modelEntry) => modelEntry.recommended) ?? entry.models[0]!;
}

export function getCatalogContextWindow(
  provider: ProviderType,
  modelId: string | undefined,
  fallback: number,
): number {
  if (!modelId) return fallback;
  const exact = getCatalogModel(provider, modelId);
  if (exact) return exact.contextWindow;

  return fallback;
}

export function getCatalogModelPricingMap(): Record<
  string,
  ModelPricing & { contextWindow: number }
> {
  const pricing: Record<string, ModelPricing & { contextWindow: number }> = {};
  for (const provider of Object.values(PROVIDER_CATALOG)) {
    for (const modelEntry of provider.models) {
      if (!modelEntry.pricing) continue;
      pricing[modelEntry.id] = {
        ...modelEntry.pricing,
        contextWindow: modelEntry.contextWindow,
      };
    }
  }
  return pricing;
}
