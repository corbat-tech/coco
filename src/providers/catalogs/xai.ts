import type { ProviderCatalogEntry } from "../catalog.js";

export const xaiCatalog: ProviderCatalogEntry = {
  id: "xai",
  defaultModel: "grok-4.7",
  models: [
    {
      id: "grok-4.7",
      name: "grok-4.7",
      contextWindow: 500000,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "openai-responses", "reasoning-effort"],
      source: {
        name: "xai official documentation",
        url: "https://docs.x.ai/developers/models",
        verifiedAt: "2026-10-07",
      },
      reasoning: {
        kind: "effort",
        levels: ["low", "medium", "high", "xhigh"],
        defaultMode: "high",
        mandatory: true,
      },
      recommended: true,
      pricing: {
        inputPerMillion: 2,
        outputPerMillion: 6,
      },
    },
  ],
};
