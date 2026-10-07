import type { ProviderCatalogEntry } from "../catalog.js";

export const huggingfaceCatalog: ProviderCatalogEntry = {
  id: "huggingface",
  defaultModel: "meta-llama/Llama-3.1-70B-Instruct",
  models: [
    {
      id: "meta-llama/Llama-3.1-70B-Instruct",
      name: "Llama 3.1 70B Instruct",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      recommended: true,
      status: "legacy",
      capabilities: ["streaming", "openai-chat"],
      source: {
        name: "huggingface official documentation",
        url: "https://huggingface.co/docs/inference-providers/en/index",
        verifiedAt: "2026-06-18",
      },
    },
  ],
};
