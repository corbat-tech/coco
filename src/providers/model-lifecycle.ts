import { getCatalogModel, type ModelStatus } from "./catalog.js";
import type { ProviderType } from "./provider-types.js";

export interface ModelRetirement {
  provider: ProviderType;
  model: string;
  status: Extract<ModelStatus, "deprecated" | "retired">;
  retirementDate: string;
  replacement?: string;
  sourceUrl: string;
}

/** Lifecycle is specific to the serving platform, never inferred from a model's age. */
export const MODEL_RETIREMENTS: readonly ModelRetirement[] = [
  ...["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"].map((model) => ({
    provider: "vertex" as const,
    model,
    status: "deprecated" as const,
    retirementDate: "2026-10-20",
    replacement: "gemini-3.8-flash",
    sourceUrl:
      "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
  })),
  {
    provider: "vertex",
    model: "gemini-2.0-flash",
    status: "retired",
    retirementDate: "2026-06-01",
    replacement: "gemini-3.1-flash-lite",
    sourceUrl:
      "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
  },
  {
    provider: "gemini",
    model: "gemini-3-pro-preview",
    status: "retired",
    retirementDate: "2026-03-09",
    replacement: "gemini-3.1-pro-preview",
    sourceUrl: "https://ai.google.dev/gemini-api/docs/deprecations",
  },
  {
    provider: "gemini",
    model: "gemini-3.1-flash-lite-preview",
    status: "retired",
    retirementDate: "2026-05-25",
    replacement: "gemini-3.1-flash-lite",
    sourceUrl: "https://ai.google.dev/gemini-api/docs/deprecations",
  },

  {
    provider: "anthropic",
    model: "claude-opus-4-1-20250805",
    status: "retired",
    retirementDate: "2026-08-05",
    replacement: "claude-opus-4-8",
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  },
  ...["gpt-5.2-chat-latest", "gpt-5.3-chat-latest"].map((model) => ({
    provider: "openai" as const,
    model,
    status: "retired" as const,
    retirementDate: "2026-08-10",
    replacement: "gpt-5.6-sol",
    sourceUrl: "https://developers.openai.com/api/docs/deprecations",
  })),
  ...[
    "gpt-5-chat-latest",
    "gpt-5-codex",
    "gpt-5.1-chat-latest",
    "gpt-5.1-codex",
    "gpt-5.1-codex-max",
  ].map((model) => ({
    provider: "openai" as const,
    model,
    status: "retired" as const,
    retirementDate: "2026-07-23",
    replacement: "gpt-5.6-sol",
    sourceUrl: "https://developers.openai.com/api/docs/deprecations",
  })),
  {
    provider: "openai",
    model: "gpt-5.1-codex-mini",
    status: "retired",
    retirementDate: "2026-07-23",
    replacement: "gpt-5.6-terra",
    sourceUrl: "https://developers.openai.com/api/docs/deprecations",
  },
  {
    provider: "gemini",
    model: "gemini-2.0-flash-001",
    status: "retired",
    retirementDate: "2026-06-01",
    replacement: "gemini-3.6-flash",
    sourceUrl: "https://ai.google.dev/gemini-api/docs/deprecations",
  },
  ...["gemini-2.0-flash-lite", "gemini-2.0-flash-lite-001"].map((model) => ({
    provider: "gemini" as const,
    model,
    status: "retired" as const,
    retirementDate: "2026-06-01",
    replacement: "gemini-3.1-flash-lite",
    sourceUrl: "https://ai.google.dev/gemini-api/docs/deprecations",
  })),
  ...[
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
  ].map((model) => ({
    provider: "deepseek" as const,
    model,
    status: "retired" as const,
    retirementDate: model.startsWith("deepseek-v4") ? "2026-09-10" : "2026-07-24",
    replacement: "deepseek-flash",
    sourceUrl: "https://api-docs.deepseek.com/updates/",
  })),
  ...["claude-sonnet-4-20250514", "claude-opus-4-20250514"].map((model, i) => ({
    provider: "anthropic" as const,
    model,
    status: "retired" as const,
    retirementDate: "2026-06-15",
    replacement: i === 0 ? "claude-sonnet-4-6" : "claude-opus-4-8",
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  })),
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    status: "deprecated",
    retirementDate: "2026-11-30",
    replacement: "claude-sonnet-5-5",
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  },
  {
    provider: "openai",
    model: "gpt-5.2-codex",
    status: "retired",
    retirementDate: "2026-07-23",
    replacement: "gpt-5.6-sol",
    sourceUrl: "https://developers.openai.com/api/docs/deprecations",
  },
  {
    provider: "openai",
    model: "codex-mini-latest",
    status: "retired",
    retirementDate: "2026-02-12",
    replacement: "gpt-5-codex-mini",
    sourceUrl: "https://developers.openai.com/api/docs/deprecations",
  },
  {
    provider: "openai",
    model: "gpt-5-codex-mini",
    status: "retired",
    retirementDate: "2026-07-23",
    replacement: "gpt-5.6-terra",
    sourceUrl: "https://developers.openai.com/api/docs/deprecations",
  },
  {
    provider: "gemini",
    model: "gemini-2.0-flash",
    status: "retired",
    retirementDate: "2026-06-01",
    replacement: "gemini-3.6-flash",
    sourceUrl: "https://ai.google.dev/gemini-api/docs/deprecations",
  },
];

/** Resolve known retirements before inference; custom models are left untouched. */
export function resolveModelMigration(
  provider: ProviderType,
  model: string,
): { model: string; warning?: string } {
  let current = model;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(current)) throw new Error(`Circular model migration for ${provider}/${model}`);
    visited.add(current);
    const retired = MODEL_RETIREMENTS.find(
      (entry) => entry.provider === provider && entry.model === current,
    );
    if (!retired) break;
    if (!retired.replacement)
      throw new Error(`${provider}/${current} is ${retired.status}. Select another model.`);
    current = retired.replacement;
  }
  if (current === model) return { model };
  const entry = getCatalogModel(provider, current);
  if (!entry || ["retired", "deprecated"].includes(entry.status)) {
    throw new Error(
      `${provider}/${model} is unavailable. Select a supported replacement (official recommendation: ${current}).`,
    );
  }
  return {
    model: current,
    warning: `Model ${provider}/${model} is deprecated or retired; using ${current}. Pricing and capabilities may differ.`,
  };
}
