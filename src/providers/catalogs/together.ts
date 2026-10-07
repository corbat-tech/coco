import type { ProviderCatalogEntry } from "../catalog.js";

export const togetherCatalog: ProviderCatalogEntry = {
  id: "together",
  defaultModel: "moonshotai/Kimi-K3",
  models: [
    {
      id: "Qwen/Qwen3.5-9B",
      name: "Qwen/Qwen3.5-9B",
      contextWindow: 262144,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "vision"],
      source: {
        name: "Official model documentation",
        url: "https://docs.together.ai/docs/serverless-models",
        verifiedAt: "2026-10-07",
      },
    },
    {
      id: "Qwen/Qwen3.6-Plus",
      name: "Qwen/Qwen3.6-Plus",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "vision"],
      source: {
        name: "Official model documentation",
        url: "https://docs.together.ai/docs/serverless-models",
        verifiedAt: "2026-10-07",
      },
    },
    {
      id: "MiniMaxAI/MiniMax-M3",
      name: "MiniMaxAI/MiniMax-M3",
      contextWindow: 524288,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat", "vision"],
      source: {
        name: "Official model documentation",
        url: "https://docs.together.ai/docs/serverless-models",
        verifiedAt: "2026-10-07",
      },
    },
    {
      id: "moonshotai/Kimi-K3",
      name: "moonshotai/Kimi-K3",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "openai-chat"],
      source: {
        name: "together official documentation",
        url: "https://docs.together.ai/docs/serverless/models",
        verifiedAt: "2026-10-07",
      },
      pricing: {
        inputPerMillion: 3,
        outputPerMillion: 15,
      },
      recommended: true,
    },
    {
      id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      name: "Llama 3.3 70B Instruct Turbo",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      status: "current",
      capabilities: ["streaming", "tool-use", "openai-chat"],
      source: {
        name: "together official documentation",
        url: "https://docs.together.ai/docs/serverless/models",
        verifiedAt: "2026-06-18",
      },
    },
  ],
};
