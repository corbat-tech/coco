import type { ProviderCatalogEntry } from "../catalog.js";

export const qwenCatalog: ProviderCatalogEntry = {
  id: "qwen",
  defaultModel: "qwen3.8-max",
  models: [
    {
      id: "qwen3.8-max",
      name: "qwen3.8-max",
      contextWindow: 1000000,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "vision", "reasoning-effort"],
      source: {
        name: "Official model documentation",
        url: "https://www.alibabacloud.com/help/en/model-studio/newly-released-models",
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
      id: "qwen3-coder-next",
      name: "qwen3-coder-next",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "Official model documentation",
        url: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
        verifiedAt: "2026-10-07",
      },
      pricing: {
        inputPerMillion: 0.3,
        outputPerMillion: 1.5,
      },
    },
    {
      id: "qwen-coder-plus",
      name: "Qwen Coder Plus",
      contextWindow: 131072,
      maxOutputTokens: 8192,
      status: "legacy",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "Alibaba Cloud Model Studio docs",
        url: "https://www.alibabacloud.com/help/en/model-studio/",
        verifiedAt: "2026-06-18",
      },
    },
    {
      id: "qwen-max",
      name: "Qwen Max",
      contextWindow: 131072,
      maxOutputTokens: 8192,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "Alibaba Cloud Model Studio docs",
        url: "https://www.alibabacloud.com/help/en/model-studio/",
        verifiedAt: "2026-06-18",
      },
    },
  ],
};
