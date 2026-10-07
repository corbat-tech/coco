import type { ProviderCatalogEntry } from "../catalog.js";

export const kimiCodeCatalog: ProviderCatalogEntry = {
  id: "kimi-code",
  defaultModel: "kimi-for-coding",
  models: [
    {
      id: "kimi-for-coding",
      name: "Kimi for Coding",
      description: "Anthropic-compatible Kimi coding endpoint",
      contextWindow: 131072,
      maxOutputTokens: 32000,
      recommended: true,
      status: "current",
      capabilities: ["streaming", "tool-use", "anthropic-messages"],
      source: {
        name: "Moonshot AI docs",
        url: "https://platform.moonshot.ai/docs",
        verifiedAt: "2026-06-18",
      },
    },
  ],
};
