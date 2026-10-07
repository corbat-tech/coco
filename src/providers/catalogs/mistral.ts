import type { ProviderCatalogEntry } from "../catalog.js";

export const mistralCatalog: ProviderCatalogEntry = {
  id: "mistral",
  defaultModel: "mistral-large-4-0",
  models: [
    {
      id: "mistral-large-4-0",
      name: "mistral-large-4-0",
      contextWindow: 1000000,
      status: "experimental",
      capabilities: ["streaming", "tool-use", "openai-chat", "vision", "reasoning-effort"],
      source: {
        name: "Official model documentation",
        url: "https://docs.mistral.ai/models/mistral-large",
        verifiedAt: "2026-10-07",
      },
      pricing: {
        inputPerMillion: 0.68,
        outputPerMillion: 2.09,
      },
      recommended: true,
      reasoning: {
        kind: "effort",
        levels: ["off", "high"],
        defaultMode: "high",
        mandatory: false,
      },
    },
    {
      id: "mistral-medium-3-5",
      name: "mistral-medium-3-5",
      contextWindow: 262144,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "vision", "reasoning-effort"],
      source: {
        name: "Official model documentation",
        url: "https://docs.mistral.ai/models/mistral-medium-3-5-26-04",
        verifiedAt: "2026-10-07",
      },
      pricing: {
        inputPerMillion: 1.5,
        outputPerMillion: 7.5,
      },
      reasoning: {
        kind: "effort",
        levels: ["off", "high"],
        defaultMode: "high",
        mandatory: false,
      },
    },
    {
      id: "mistral-small-2603",
      name: "mistral-small-2603",
      contextWindow: 262144,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "vision", "reasoning-effort"],
      source: {
        name: "Official model documentation",
        url: "https://docs.mistral.ai/models/mistral-small-4-0-26-03",
        verifiedAt: "2026-10-07",
      },
      pricing: {
        inputPerMillion: 0.15,
        outputPerMillion: 0.6,
      },
      reasoning: {
        kind: "effort",
        levels: ["off", "high"],
        defaultMode: "high",
        mandatory: false,
      },
    },
    {
      id: "mistral-large-latest",
      name: "Mistral Large latest",
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      status: "legacy",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "mistral official documentation",
        url: "https://docs.mistral.ai/models",
        verifiedAt: "2026-06-18",
      },
    },
    {
      id: "codestral-latest",
      name: "Codestral latest",
      contextWindow: 256000,
      maxOutputTokens: 8192,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "mistral official documentation",
        url: "https://docs.mistral.ai/models",
        verifiedAt: "2026-06-18",
      },
    },
  ],
};
