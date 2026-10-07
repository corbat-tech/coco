import type { ProviderCatalogEntry } from "../catalog.js";

export const groqCatalog: ProviderCatalogEntry = {
  id: "groq",
  defaultModel: "openai/gpt-oss-120b",
  models: [
    {
      id: "openai/gpt-oss-120b",
      name: "openai/gpt-oss-120b",
      contextWindow: 131072,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "reasoning-effort"],
      source: {
        name: "groq official documentation",
        url: "https://console.groq.com/docs/models",
        verifiedAt: "2026-10-07",
      },
      maxOutputTokens: 65536,
      reasoning: {
        kind: "effort",
        levels: ["low", "medium", "high"],
        defaultMode: "medium",
        mandatory: true,
      },
      pricing: {
        inputPerMillion: 0.15,
        outputPerMillion: 0.6,
      },
      recommended: true,
    },
    {
      id: "openai/gpt-oss-20b",
      name: "openai/gpt-oss-20b",
      contextWindow: 131072,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "reasoning-effort"],
      source: {
        name: "groq official documentation",
        url: "https://console.groq.com/docs/models",
        verifiedAt: "2026-10-07",
      },
      maxOutputTokens: 65536,
      reasoning: {
        kind: "effort",
        levels: ["low", "medium", "high"],
        defaultMode: "medium",
        mandatory: true,
      },
      pricing: {
        inputPerMillion: 0.075,
        outputPerMillion: 0.3,
      },
    },
    {
      id: "llama-3.1-8b-instant",
      name: "llama-3.1-8b-instant",
      contextWindow: 131072,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "groq official documentation",
        url: "https://console.groq.com/docs/models",
        verifiedAt: "2026-10-07",
      },
      maxOutputTokens: 131072,
    },
    {
      id: "llama-3.3-70b-versatile",
      name: "Llama 3.3 70B Versatile",
      contextWindow: 131072,
      maxOutputTokens: 32768,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "groq official documentation",
        url: "https://console.groq.com/docs/models",
        verifiedAt: "2026-06-18",
      },
    },
  ],
};
