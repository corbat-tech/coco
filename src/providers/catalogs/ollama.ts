import type { ProviderCatalogEntry } from "../catalog.js";

export const ollamaCatalog: ProviderCatalogEntry = {
  id: "ollama",
  defaultModel: "llama3.2",
  models: [
    {
      id: "llama3.2",
      name: "Llama 3.2",
      description: "Default local Ollama model",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      recommended: true,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "ollama official documentation",
        url: "https://docs.ollama.com/api/openai-compatibility",
        verifiedAt: "2026-06-18",
      },
    },
    {
      id: "qwen2.5-coder:14b",
      name: "Qwen2.5 Coder 14B",
      description: "Local coding model",
      contextWindow: 32768,
      maxOutputTokens: 8192,
      status: "legacy",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "ollama official documentation",
        url: "https://docs.ollama.com/api/openai-compatibility",
        verifiedAt: "2026-06-18",
      },
    },
  ],
};
