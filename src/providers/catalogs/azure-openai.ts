import type { ProviderCatalogEntry } from "../catalog.js";

export const azureOpenaiCatalog: ProviderCatalogEntry = {
  id: "azure-openai",
  defaultModel: "gpt-6.1-sol",
  models: [
    {
      id: "gpt-6.1-sol",
      name: "gpt-6.1-sol",
      contextWindow: 1050000,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "openai-responses", "reasoning-effort"],
      source: {
        name: "Azure OpenAI Responses",
        url: "https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses",
        verifiedAt: "2026-10-07",
      },
      maxOutputTokens: 128000,
      reasoning: {
        kind: "effort",
        levels: ["low", "medium", "high", "xhigh", "max"],
        defaultMode: "medium",
        mandatory: true,
      },
      recommended: true,
    },
    {
      id: "gpt-6-astra",
      name: "gpt-6-astra",
      contextWindow: 1050000,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "openai-responses", "reasoning-effort"],
      source: {
        name: "Azure OpenAI Responses",
        url: "https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses",
        verifiedAt: "2026-10-07",
      },
      maxOutputTokens: 128000,
      reasoning: {
        kind: "effort",
        levels: ["low", "medium", "high", "xhigh", "max"],
        defaultMode: "medium",
        mandatory: true,
      },
    },
    {
      id: "gpt-6-luna",
      name: "gpt-6-luna",
      contextWindow: 1050000,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "openai-responses", "reasoning-effort"],
      source: {
        name: "Azure OpenAI Responses",
        url: "https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses",
        verifiedAt: "2026-10-07",
      },
      maxOutputTokens: 128000,
      reasoning: {
        kind: "effort",
        levels: ["off", "low", "medium", "high", "xhigh", "max"],
        defaultMode: "medium",
        mandatory: false,
      },
    },
  ],
};
