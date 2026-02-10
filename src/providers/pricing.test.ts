/**
 * Tests for provider pricing and cost estimation
 */

import { describe, it, expect } from "vitest";
import {
  MODEL_PRICING,
  DEFAULT_PRICING,
  estimateCost,
  formatCost,
  getModelPricing,
  hasKnownPricing,
  listModelsWithPricing,
} from "./pricing.js";

describe("MODEL_PRICING", () => {
  it("should have pricing for Claude models", () => {
    expect(MODEL_PRICING["claude-sonnet-4-20250514"]).toBeDefined();
    expect(MODEL_PRICING["claude-opus-4-20250514"]).toBeDefined();
    expect(MODEL_PRICING["claude-3-5-sonnet-20241022"]).toBeDefined();
  });

  it("should have pricing for OpenAI models", () => {
    expect(MODEL_PRICING["gpt-5.3-codex"]).toBeDefined();
    expect(MODEL_PRICING["gpt-4.1"]).toBeDefined();
    expect(MODEL_PRICING["o1"]).toBeDefined();
  });

  it("should have pricing for Gemini models", () => {
    expect(MODEL_PRICING["gemini-2.5-pro"]).toBeDefined();
    expect(MODEL_PRICING["gemini-1.5-pro"]).toBeDefined();
  });

  it("should have pricing for Kimi models", () => {
    expect(MODEL_PRICING["moonshot-v1-8k"]).toBeDefined();
    expect(MODEL_PRICING["moonshot-v1-128k"]).toBeDefined();
  });

  it("should have valid pricing structure", () => {
    for (const [_model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.inputPerMillion).toBeGreaterThan(0);
      expect(pricing.outputPerMillion).toBeGreaterThan(0);
      expect(pricing.contextWindow).toBeGreaterThan(0);
    }
  });
});

describe("DEFAULT_PRICING", () => {
  it("should have defaults for all provider types", () => {
    expect(DEFAULT_PRICING.anthropic).toBeDefined();
    expect(DEFAULT_PRICING.openai).toBeDefined();
    expect(DEFAULT_PRICING.gemini).toBeDefined();
    expect(DEFAULT_PRICING.kimi).toBeDefined();
  });
});

describe("estimateCost", () => {
  it("should calculate cost for known model", () => {
    const result = estimateCost("claude-sonnet-4-20250514", 1000, 500);

    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.currency).toBe("USD");
    expect(result.totalCost).toBe(result.inputCost + result.outputCost);
  });

  it("should calculate correct cost for Claude Sonnet", () => {
    // Claude Sonnet: $3/1M input, $15/1M output
    const result = estimateCost("claude-sonnet-4-20250514", 1_000_000, 1_000_000);

    expect(result.inputCost).toBe(3);
    expect(result.outputCost).toBe(15);
    expect(result.totalCost).toBe(18);
  });

  it("should calculate correct cost for GPT-5.3 Codex", () => {
    // GPT-5.3 Codex: $2/1M input, $8/1M output
    const result = estimateCost("gpt-5.3-codex", 1_000_000, 1_000_000);

    expect(result.inputCost).toBe(2);
    expect(result.outputCost).toBe(8);
    expect(result.totalCost).toBe(10);
  });

  it("should use default pricing for unknown model", () => {
    const result = estimateCost("unknown-model", 1000, 500, "anthropic");

    expect(result.totalCost).toBeGreaterThan(0);
  });

  it("should handle zero tokens", () => {
    const result = estimateCost("claude-sonnet-4-20250514", 0, 0);

    expect(result.inputCost).toBe(0);
    expect(result.outputCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  it("should handle small token counts", () => {
    const result = estimateCost("claude-sonnet-4-20250514", 100, 50);

    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.totalCost).toBeLessThan(0.01);
  });
});

describe("formatCost", () => {
  it("should format very small costs", () => {
    expect(formatCost(0.00001)).toBe("<$0.0001");
    expect(formatCost(0.00005)).toBe("<$0.0001");
  });

  it("should format small costs with 4 decimals", () => {
    expect(formatCost(0.001)).toBe("$0.0010");
    expect(formatCost(0.0099)).toBe("$0.0099");
  });

  it("should format larger costs with 2 decimals", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(10.567)).toBe("$10.57");
  });

  it("should format zero", () => {
    expect(formatCost(0)).toBe("<$0.0001");
  });
});

describe("getModelPricing", () => {
  it("should return pricing for known model", () => {
    const pricing = getModelPricing("claude-sonnet-4-20250514");

    expect(pricing.inputPerMillion).toBe(3);
    expect(pricing.outputPerMillion).toBe(15);
    expect(pricing.contextWindow).toBe(200000);
  });

  it("should return default pricing for unknown model", () => {
    const pricing = getModelPricing("unknown-model", "openai");

    expect(pricing).toEqual(DEFAULT_PRICING.openai);
  });

  it("should return anthropic default for unknown model without provider", () => {
    const pricing = getModelPricing("unknown-model");

    expect(pricing).toEqual(DEFAULT_PRICING.anthropic);
  });
});

describe("hasKnownPricing", () => {
  it("should return true for known models", () => {
    expect(hasKnownPricing("claude-sonnet-4-20250514")).toBe(true);
    expect(hasKnownPricing("gpt-5.3-codex")).toBe(true);
    expect(hasKnownPricing("gemini-2.5-pro")).toBe(true);
  });

  it("should return false for unknown models", () => {
    expect(hasKnownPricing("unknown-model")).toBe(false);
    expect(hasKnownPricing("my-custom-model")).toBe(false);
  });
});

describe("listModelsWithPricing", () => {
  it("should return array of all models", () => {
    const models = listModelsWithPricing();

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  it("should include model name and pricing", () => {
    const models = listModelsWithPricing();
    const first = models[0];

    expect(first).toHaveProperty("model");
    expect(first).toHaveProperty("pricing");
    expect(first?.pricing).toHaveProperty("inputPerMillion");
    expect(first?.pricing).toHaveProperty("outputPerMillion");
    expect(first?.pricing).toHaveProperty("contextWindow");
  });

  it("should include all known models", () => {
    const models = listModelsWithPricing();
    const modelNames = models.map((m) => m.model);

    expect(modelNames).toContain("claude-sonnet-4-20250514");
    expect(modelNames).toContain("gpt-5.3-codex");
    expect(modelNames).toContain("gemini-2.5-pro");
  });
});
