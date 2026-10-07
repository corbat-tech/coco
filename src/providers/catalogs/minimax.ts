import type { ProviderCatalogEntry } from "../catalog.js";

export const minimaxCatalog: ProviderCatalogEntry = {
  id: "minimax",
  defaultModel: "MiniMax-M3",
  models: [
    {
      id: "MiniMax-M3",
      name: "MiniMax-M3",
      contextWindow: 1000000,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "openai-chat", "reasoning-effort"],
      source: {
        name: "minimax official documentation",
        url: "https://platform.minimax.io/docs/api-reference/text-openai-api",
        verifiedAt: "2026-10-07",
      },
      reasoning: {
        kind: "effort",
        levels: ["off", "auto"],
        defaultMode: "auto",
        mandatory: false,
      },
      recommended: true,
    },
    {
      id: "MiniMax-M3.1-Flash-Preview",
      name: "MiniMax-M3.1-Flash-Preview",
      contextWindow: 1000000,
      status: "experimental",
      capabilities: ["streaming", "tool-use", "vision", "openai-chat", "reasoning-effort"],
      source: {
        name: "minimax official documentation",
        url: "https://platform.minimax.io/docs/api-reference/text-openai-api",
        verifiedAt: "2026-10-07",
      },
      reasoning: {
        kind: "effort",
        levels: ["low", "medium", "high", "xhigh", "max"],
        defaultMode: "max",
        mandatory: true,
      },
    },
    {
      id: "MiniMax-M2.7",
      name: "MiniMax-M2.7",
      contextWindow: 204800,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "reasoning-effort"],
      source: {
        name: "minimax official documentation",
        url: "https://platform.minimax.io/docs/api-reference/text-openai-api",
        verifiedAt: "2026-10-07",
      },
      reasoning: {
        kind: "effort",
        levels: ["auto"],
        defaultMode: "auto",
        mandatory: true,
      },
    },
  ],
};
