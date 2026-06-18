import { describe, expect, it } from "vitest";
import type { ProviderType } from "./index.js";
import {
  PROVIDER_CATALOG,
  getCatalogDefaultModel,
  getCatalogModel,
  getCatalogRecommendedModel,
  getCatalogContextWindow,
  getCatalogModelPricingMap,
} from "./catalog.js";

describe("provider catalog", () => {
  it("has a valid default model for every provider", () => {
    for (const [providerId, provider] of Object.entries(PROVIDER_CATALOG)) {
      const defaultModel = getCatalogDefaultModel(providerId as ProviderType);

      expect(provider.models.some((model) => model.id === defaultModel)).toBe(true);
    }
  });

  it("has unique model IDs per provider", () => {
    for (const provider of Object.values(PROVIDER_CATALOG)) {
      const ids = provider.models.map((model) => model.id);

      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("requires source metadata for every model", () => {
    for (const provider of Object.values(PROVIDER_CATALOG)) {
      for (const model of provider.models) {
        expect(model.source.url).toMatch(/^https:\/\//);
        expect(model.source.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("keeps deprecated models available without recommending them", () => {
    const sonnet4 = getCatalogModel("anthropic", "claude-sonnet-4-20250514");

    expect(sonnet4?.status).toBe("deprecated");
    expect(getCatalogRecommendedModel("anthropic").id).toBe("claude-sonnet-4-6");
  });

  it("resolves context windows from the catalog", () => {
    expect(getCatalogContextWindow("openai", "gpt-5.5", 128000)).toBe(1000000);
    expect(getCatalogContextWindow("copilot", "claude-sonnet-4.6", 128000)).toBe(168000);
    expect(getCatalogContextWindow("openai", "unknown-model", 128000)).toBe(128000);
  });

  it("exports pricing only for explicitly priced models", () => {
    const pricing = getCatalogModelPricingMap();

    expect(pricing["gpt-5.5"]).toEqual({
      inputPerMillion: 5,
      outputPerMillion: 30,
      contextWindow: 1000000,
    });
    expect(pricing["claude-sonnet-4-6"]).toBeDefined();
    expect(pricing["gpt-5.4"]).toBeUndefined();
  });
});
