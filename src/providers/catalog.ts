/**
 * Provider and model catalog.
 *
 * This is the source of truth for model IDs, defaults, context windows,
 * pricing metadata, and provider capabilities. Endpoint adapters still own
 * request/response conversion, but they should read model metadata from here.
 */

import type { ProviderType } from "./provider-types.js";

export type ModelStatus = "current" | "legacy" | "deprecated" | "experimental" | "retired";

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
  | "gemini-generate-content"
  | "bedrock-converse";

export interface ProviderSource {
  name: string;
  url: string;
  verifiedAt: string;
}

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  longContext?: { threshold: number; inputPerMillion: number; outputPerMillion: number };
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
  reasoning?: {
    kind: "effort" | "budget";
    levels: string[];
    defaultMode: string;
    mandatory?: boolean;
  };
  availability?: "existing-users" | "deployment" | "account";
}

export interface ProviderCatalogEntry {
  id: ProviderType;
  defaultModel: string;
  models: ModelCatalogEntry[];
}

export type ProviderCatalog = Record<ProviderType, ProviderCatalogEntry>;

import { anthropicCatalog } from "./catalogs/anthropic.js";
import { openaiCatalog } from "./catalogs/openai.js";
import { codexCatalog } from "./catalogs/codex.js";
import { copilotCatalog } from "./catalogs/copilot.js";
import { geminiCatalog } from "./catalogs/gemini.js";
import { vertexCatalog } from "./catalogs/vertex.js";
import { kimiCatalog } from "./catalogs/kimi.js";
import { kimiCodeCatalog } from "./catalogs/kimi-code.js";
import { lmstudioCatalog } from "./catalogs/lmstudio.js";
import { ollamaCatalog } from "./catalogs/ollama.js";
import { groqCatalog } from "./catalogs/groq.js";
import { openrouterCatalog } from "./catalogs/openrouter.js";
import { mistralCatalog } from "./catalogs/mistral.js";
import { deepseekCatalog } from "./catalogs/deepseek.js";
import { togetherCatalog } from "./catalogs/together.js";
import { huggingfaceCatalog } from "./catalogs/huggingface.js";
import { qwenCatalog } from "./catalogs/qwen.js";
import { xaiCatalog } from "./catalogs/xai.js";
import { minimaxCatalog } from "./catalogs/minimax.js";
import { cerebrasCatalog } from "./catalogs/cerebras.js";
import { azureOpenaiCatalog } from "./catalogs/azure-openai.js";
import { bedrockCatalog } from "./catalogs/bedrock.js";

export const PROVIDER_CATALOG: ProviderCatalog = {
  anthropic: anthropicCatalog,
  openai: openaiCatalog,
  codex: codexCatalog,
  copilot: copilotCatalog,
  gemini: geminiCatalog,
  vertex: vertexCatalog,
  kimi: kimiCatalog,
  "kimi-code": kimiCodeCatalog,
  lmstudio: lmstudioCatalog,
  ollama: ollamaCatalog,
  groq: groqCatalog,
  openrouter: openrouterCatalog,
  mistral: mistralCatalog,
  deepseek: deepseekCatalog,
  together: togetherCatalog,
  huggingface: huggingfaceCatalog,
  qwen: qwenCatalog,
  xai: xaiCatalog,
  minimax: minimaxCatalog,
  cerebras: cerebrasCatalog,
  "azure-openai": azureOpenaiCatalog,
  bedrock: bedrockCatalog,
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
  return getProviderCatalogEntry(provider)?.models.find((modelEntry) => modelEntry.id === modelId);
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
