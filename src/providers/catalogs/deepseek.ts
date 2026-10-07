import type { ProviderCatalogEntry } from "../catalog.js";

export const deepseekCatalog: ProviderCatalogEntry = {
  id: "deepseek",
  defaultModel: "deepseek-flash",
  models: [
    {
      id: "deepseek-flash",
      name: "deepseek-flash",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "vision", "reasoning-effort"],
      source: {
        name: "Official model documentation",
        url: "https://api-docs.deepseek.com/api/list-models/",
        verifiedAt: "2026-10-07",
      },
      reasoning: {
        kind: "effort",
        levels: ["off", "low", "high", "max"],
        defaultMode: "high",
        mandatory: false,
      },
      maxOutputTokens: 393216,
      recommended: true,
    },
    {
      id: "deepseek-v4-pro",
      name: "deepseek-v4-pro",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "reasoning-effort"],
      source: {
        name: "Official model documentation",
        url: "https://api-docs.deepseek.com/api/list-models/",
        verifiedAt: "2026-10-07",
      },
      reasoning: {
        kind: "effort",
        levels: ["off", "low", "high", "max"],
        defaultMode: "high",
        mandatory: false,
      },
      maxOutputTokens: 393216,
    },
  ],
};
