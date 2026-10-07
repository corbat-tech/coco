import type { ProviderCatalogEntry } from "../catalog.js";

export const bedrockCatalog: ProviderCatalogEntry = {
  id: "bedrock",
  defaultModel: "anthropic.claude-sonnet-5-5",
  models: [
    {
      id: "anthropic.claude-sonnet-5-5",
      name: "anthropic.claude-sonnet-5-5",
      contextWindow: 1000000,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "bedrock-converse", "reasoning-effort"],
      source: {
        name: "bedrock official documentation",
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html",
        verifiedAt: "2026-10-07",
      },
      maxOutputTokens: 128000,
      reasoning: {
        kind: "effort",
        levels: ["low", "medium", "high", "xhigh", "max"],
        defaultMode: "high",
        mandatory: false,
      },
      recommended: true,
    },
    {
      id: "anthropic.claude-opus-5-5",
      name: "anthropic.claude-opus-5-5",
      contextWindow: 1000000,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "bedrock-converse", "reasoning-effort"],
      source: {
        name: "bedrock official documentation",
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html",
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
      id: "anthropic.claude-fable-5-1",
      name: "anthropic.claude-fable-5-1",
      contextWindow: 1000000,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "bedrock-converse", "reasoning-effort"],
      source: {
        name: "bedrock official documentation",
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html",
        verifiedAt: "2026-10-07",
      },
      maxOutputTokens: 128000,
      reasoning: {
        kind: "effort",
        levels: ["low", "medium", "high", "xhigh", "max"],
        defaultMode: "high",
        mandatory: true,
      },
    },
    {
      id: "anthropic.claude-haiku-5-5",
      name: "anthropic.claude-haiku-5-5",
      contextWindow: 1000000,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "bedrock-converse", "reasoning-effort"],
      source: {
        name: "bedrock official documentation",
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html",
        verifiedAt: "2026-10-07",
      },
      maxOutputTokens: 128000,
      reasoning: {
        kind: "effort",
        levels: ["low", "medium", "high", "xhigh", "max"],
        defaultMode: "medium",
        mandatory: false,
      },
    },
  ],
};
