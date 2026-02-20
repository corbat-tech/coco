/**
 * Provider pricing and cost estimation
 *
 * Prices are in USD per million tokens (as of 2025)
 */

import type { ProviderType } from "./index.js";

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
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude models
  "claude-opus-4-20250514": { inputPerMillion: 15, outputPerMillion: 75, contextWindow: 200000 },
  "claude-sonnet-4-20250514": { inputPerMillion: 3, outputPerMillion: 15, contextWindow: 200000 },
  "claude-3-5-sonnet-20241022": { inputPerMillion: 3, outputPerMillion: 15, contextWindow: 200000 },
  "claude-3-5-haiku-20241022": { inputPerMillion: 0.8, outputPerMillion: 4, contextWindow: 200000 },
  "claude-3-opus-20240229": { inputPerMillion: 15, outputPerMillion: 75, contextWindow: 200000 },
  "claude-3-sonnet-20240229": { inputPerMillion: 3, outputPerMillion: 15, contextWindow: 200000 },
  "claude-3-haiku-20240307": {
    inputPerMillion: 0.25,
    outputPerMillion: 1.25,
    contextWindow: 200000,
  },

  // OpenAI models
  "gpt-5.3-codex": { inputPerMillion: 2, outputPerMillion: 8, contextWindow: 400000 },
  "gpt-5.2-codex": { inputPerMillion: 2, outputPerMillion: 8, contextWindow: 400000 },
  "gpt-5.2-thinking": { inputPerMillion: 3, outputPerMillion: 12, contextWindow: 400000 },
  "gpt-5.2-pro": { inputPerMillion: 3, outputPerMillion: 12, contextWindow: 400000 },
  "gpt-5.2-instant": { inputPerMillion: 1, outputPerMillion: 4, contextWindow: 400000 },
  "gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8, contextWindow: 1048576 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6, contextWindow: 1048576 },
  "o4-mini": { inputPerMillion: 1.1, outputPerMillion: 4.4, contextWindow: 200000 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10, contextWindow: 128000 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6, contextWindow: 128000 },
  "gpt-4-turbo": { inputPerMillion: 10, outputPerMillion: 30, contextWindow: 128000 },
  "gpt-4": { inputPerMillion: 30, outputPerMillion: 60, contextWindow: 8192 },
  "gpt-3.5-turbo": { inputPerMillion: 0.5, outputPerMillion: 1.5, contextWindow: 16384 },
  o1: { inputPerMillion: 15, outputPerMillion: 60, contextWindow: 200000 },
  "o1-mini": { inputPerMillion: 3, outputPerMillion: 12, contextWindow: 128000 },

  // Google Gemini models
  "gemini-3-flash-preview": {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    contextWindow: 1000000,
  },
  "gemini-3-pro-preview": { inputPerMillion: 1.25, outputPerMillion: 5, contextWindow: 1000000 },
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 5, contextWindow: 1048576 },
  "gemini-2.5-flash": { inputPerMillion: 0.15, outputPerMillion: 0.6, contextWindow: 1048576 },
  "gemini-2.0-flash": { inputPerMillion: 0.1, outputPerMillion: 0.4, contextWindow: 1048576 },
  "gemini-1.5-flash": { inputPerMillion: 0.075, outputPerMillion: 0.3, contextWindow: 1000000 },
  "gemini-1.5-pro": { inputPerMillion: 1.25, outputPerMillion: 5, contextWindow: 2000000 },

  // Kimi/Moonshot models
  "kimi-k2.5": { inputPerMillion: 2, outputPerMillion: 2, contextWindow: 262144 },
  "kimi-k2-thinking": { inputPerMillion: 2, outputPerMillion: 2, contextWindow: 262144 },
  "moonshot-v1-8k": { inputPerMillion: 1.2, outputPerMillion: 1.2, contextWindow: 8192 },
  "moonshot-v1-32k": { inputPerMillion: 2.4, outputPerMillion: 2.4, contextWindow: 32768 },
  "moonshot-v1-128k": { inputPerMillion: 6, outputPerMillion: 6, contextWindow: 131072 },
};

/**
 * Default pricing per provider (used when model not found)
 */
export const DEFAULT_PRICING: Record<ProviderType, ModelPricing> = {
  anthropic: { inputPerMillion: 3, outputPerMillion: 15, contextWindow: 200000 },
  openai: { inputPerMillion: 2.5, outputPerMillion: 10, contextWindow: 128000 },
  codex: { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 128000 }, // ChatGPT Plus/Pro subscription
  gemini: { inputPerMillion: 0.1, outputPerMillion: 0.4, contextWindow: 1000000 },
  kimi: { inputPerMillion: 1.2, outputPerMillion: 1.2, contextWindow: 8192 },
  "kimi-code": { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 131072 }, // Included in subscription
  lmstudio: { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 32768 }, // Free - local models
  ollama: { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 128000 }, // Free - local models
  groq: { inputPerMillion: 0.05, outputPerMillion: 0.08, contextWindow: 128000 }, // Free tier available
  openrouter: { inputPerMillion: 2, outputPerMillion: 8, contextWindow: 200000 }, // Varies by model
  mistral: { inputPerMillion: 0.25, outputPerMillion: 0.75, contextWindow: 32768 },
  deepseek: { inputPerMillion: 0.14, outputPerMillion: 0.28, contextWindow: 128000 }, // Very cheap
  together: { inputPerMillion: 0.2, outputPerMillion: 0.2, contextWindow: 32768 },
  huggingface: { inputPerMillion: 0, outputPerMillion: 0, contextWindow: 32768 }, // Free tier
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
