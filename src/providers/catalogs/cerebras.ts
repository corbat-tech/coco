import type { ProviderCatalogEntry } from "../catalog.js";

export const cerebrasCatalog: ProviderCatalogEntry = {
  id: "cerebras",
  defaultModel: "qwen-3.8-27b",
  models: [
    {
      id: "gpt-oss-120b",
      name: "gpt-oss-120b",
      contextWindow: 131072,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "reasoning-effort"],
      source: {
        name: "Official model documentation",
        url: "https://inference-docs.cerebras.ai/models/overview",
        verifiedAt: "2026-10-07",
      },
      reasoning: {
        kind: "effort",
        levels: ["low", "medium", "high"],
        defaultMode: "medium",
        mandatory: true,
      },
    },
    {
      id: "qwen-3.8-27b",
      name: "qwen-3.8-27b",
      contextWindow: 131072,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "reasoning-effort", "vision"],
      source: {
        name: "cerebras official documentation",
        url: "https://inference-docs.cerebras.ai/resources/openai",
        verifiedAt: "2026-10-07",
      },
      reasoning: {
        kind: "effort",
        levels: ["off", "low", "medium", "high"],
        defaultMode: "high",
        mandatory: false,
      },
      recommended: true,
    },
  ],
};
