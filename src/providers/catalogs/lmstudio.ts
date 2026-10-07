import type { ProviderCatalogEntry } from "../catalog.js";

export const lmstudioCatalog: ProviderCatalogEntry = {
  id: "lmstudio",
  defaultModel: "local-model",
  models: [
    {
      id: "local-model",
      name: "Local model",
      description: "Model selected in LM Studio",
      contextWindow: 32768,
      maxOutputTokens: 8192,
      recommended: true,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "lmstudio official documentation",
        url: "https://lmstudio.ai/docs/developer/openai-compat",
        verifiedAt: "2026-06-18",
      },
    },
  ],
};
