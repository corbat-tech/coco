/**
 * Provider pricing and cost estimation
 *
 * Prices are in USD per million tokens (as of 2025)
 */

import type { ProviderType } from "./index.js";
import { getCatalogModelPricingMap } from "./catalog.js";

/**
 * Model pricing info
 */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  contextWindow: number;
}

/**
 * Pricing table for all supported models
 */
export const MODEL_PRICING: Record<string, ModelPricing> = getCatalogModelPricingMap();

/**
 * Default pricing per provider (used when model not found)
 */
export const DEFAULT_PRICING: Record<ProviderType, ModelPricing> = {
  anthropic: { inputPerMillion: 3, outputPerMillion: 15, contextWindow: 200000 },
  openai: { inputPerMillion: 2.5, outputPerMillion: 10, contextWindow: 128000 },
  codex: { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 128000 }, // ChatGPT Plus/Pro subscription
  gemini: { inputPerMillion: 0.1, outputPerMillion: 0.4, contextWindow: 1000000 },
  vertex: { inputPerMillion: 0.1, outputPerMillion: 0.4, contextWindow: 1048576 },
  kimi: { inputPerMillion: 1.2, outputPerMillion: 1.2, contextWindow: 8192 },
  "kimi-code": { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 131072 }, // Included in subscription
  copilot: { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 200000 }, // Included in subscription
  lmstudio: { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 32768 }, // Free - local models
  ollama: { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 128000 }, // Free - local models
  groq: { inputPerMillion: 0.05, outputPerMillion: 0.08, contextWindow: 128000 }, // Free tier available
  openrouter: { inputPerMillion: 2, outputPerMillion: 8, contextWindow: 200000 }, // Varies by model
  mistral: { inputPerMillion: 0.25, outputPerMillion: 0.75, contextWindow: 32768 },
  deepseek: { inputPerMillion: 0.14, outputPerMillion: 0.28, contextWindow: 128000 }, // Very cheap
  together: { inputPerMillion: 0.2, outputPerMillion: 0.2, contextWindow: 32768 },
  huggingface: { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 32768 }, // Free tier
  qwen: { inputPerMillion: 0.3, outputPerMillion: 1.2, contextWindow: 131072 }, // qwen-coder-plus pricing
};

/**
 * Cost estimation result
 */
export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  currency: "USD";
}

/**
 * Estimate cost for a request
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  provider?: ProviderType,
): CostEstimate {
  const pricing =
    MODEL_PRICING[model] ?? (provider ? DEFAULT_PRICING[provider] : DEFAULT_PRICING.anthropic);

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    inputTokens,
    outputTokens,
    model,
    currency: "USD",
  };
}

/**
 * Format cost as string
 */
export function formatCost(cost: number): string {
  if (cost < 0.0001) {
    return "<$0.0001";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Get pricing for a model
 */
export function getModelPricing(model: string, provider?: ProviderType): ModelPricing {
  return MODEL_PRICING[model] ?? (provider ? DEFAULT_PRICING[provider] : DEFAULT_PRICING.anthropic);
}

/**
 * Check if model has known pricing
 */
export function hasKnownPricing(model: string): boolean {
  return model in MODEL_PRICING;
}

/**
 * List all models with pricing
 */
export function listModelsWithPricing(): Array<{ model: string; pricing: ModelPricing }> {
  return Object.entries(MODEL_PRICING).map(([model, pricing]) => ({
    model,
    pricing,
  }));
}
