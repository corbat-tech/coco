import type { ProviderCatalogEntry } from "../catalog.js";

export const vertexCatalog: ProviderCatalogEntry = {
  id: "vertex",
  defaultModel: "gemini-3.5-flash",
  models: [
    {
      id: "gemini-3.5-flash",
      name: "gemini-3.5-flash",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "gemini-generate-content"],
      source: {
        name: "Google Cloud model lifecycle",
        url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
        verifiedAt: "2026-10-07",
      },
      recommended: true,
    },
    {
      id: "gemini-3.8-flash",
      name: "gemini-3.8-flash",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "gemini-generate-content"],
      source: {
        name: "Google Cloud model lifecycle",
        url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
        verifiedAt: "2026-10-07",
      },
    },
    {
      id: "gemini-3.7-flash",
      name: "gemini-3.7-flash",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "gemini-generate-content"],
      source: {
        name: "Google Cloud model lifecycle",
        url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
        verifiedAt: "2026-10-07",
      },
    },
    {
      id: "gemini-3.6-flash",
      name: "gemini-3.6-flash",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "gemini-generate-content"],
      source: {
        name: "Google Cloud model lifecycle",
        url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
        verifiedAt: "2026-10-07",
      },
    },
    {
      id: "gemini-3.5-flash-lite",
      name: "gemini-3.5-flash-lite",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "gemini-generate-content"],
      source: {
        name: "Google Cloud model lifecycle",
        url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
        verifiedAt: "2026-10-07",
      },
    },
    {
      id: "gemini-3.1-flash-lite",
      name: "gemini-3.1-flash-lite",
      contextWindow: 1048576,
      status: "current",
      capabilities: ["streaming", "tool-use", "vision", "gemini-generate-content"],
      source: {
        name: "Google Cloud model lifecycle",
        url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
        verifiedAt: "2026-10-07",
      },
    },
  ],
};
