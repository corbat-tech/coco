/**
 * Model Tier Registry
 *
 * Classifies every supported model into one of three capability tiers:
 *   - mini     : Small/cheap models (haiku, flash, 4o-mini, gpt-5-mini)
 *   - standard : Mid-range models (sonnet, gpt-4o, gemini-2.5-pro)
 *   - advanced : Frontier/reasoning models (opus, o3, o4-*, gpt-4.1, gpt-5+)
 *
 * The tier drives per-request adaptations:
 *   - maxTools              : cap to prevent wrong-tool selection
 *   - parallelToolCalls     : mini models are less reliable with parallel calls
 *   - compactionThreshold   : mini models suffer "context rot" earlier
 *   - supportsCoT           : CoT prompting helps large models; hurts small ones
 */

export type ModelTier = "mini" | "standard" | "advanced";

export interface TierConfig {
  /** Maximum number of tools to pass per request */
  maxTools: number;
  /** Whether to allow parallel tool calls */
  parallelToolCalls: boolean;
  /** Context usage fraction (0-1) at which to trigger compaction */
  compactionThreshold: number;
  /**
   * Whether chain-of-thought scaffolding benefits this tier.
   * Research: CoT only reliably helps at ≥100B parameter scale; smaller models
   * perform better with direct, imperative instructions.
   */
  supportsCoT: boolean;
}

export const TIER_CONFIGS: Record<ModelTier, TierConfig> = {
  mini: {
    maxTools: 12,
    parallelToolCalls: false,
    compactionThreshold: 0.5,
    supportsCoT: false,
  },
  standard: {
    maxTools: 40,
    parallelToolCalls: true,
    compactionThreshold: 0.75,
    supportsCoT: true,
  },
  advanced: {
    maxTools: 128,
    parallelToolCalls: true,
    compactionThreshold: 0.8,
    supportsCoT: true,
  },
};

// ---------------------------------------------------------------------------
// Per-provider tier tables
// ---------------------------------------------------------------------------

/** Anthropic model tier table (keys are model name prefixes / exact names) */
const ANTHROPIC_TIERS: Array<{ prefix: string; tier: ModelTier }> = [
  // Haiku — mini tier
  { prefix: "claude-haiku", tier: "mini" },
  { prefix: "claude-3-haiku", tier: "mini" },
  // Sonnet / Claude 3.5 — standard tier
  { prefix: "claude-3-5-sonnet", tier: "standard" },
  { prefix: "claude-3-7-sonnet", tier: "standard" },
  { prefix: "claude-sonnet", tier: "standard" },
  // Opus — advanced tier
  { prefix: "claude-opus", tier: "advanced" },
  { prefix: "claude-3-opus", tier: "advanced" },
  // claude-4+ (future) — default to standard unless matched above
];

/** OpenAI / Codex / Copilot model tier table */
const OPENAI_TIERS: Array<{ prefix: string; tier: ModelTier }> = [
  // Mini models
  { prefix: "gpt-4o-mini", tier: "mini" },
  { prefix: "gpt-5-mini", tier: "mini" },
  { prefix: "gpt-5.4-mini", tier: "mini" },
  { prefix: "gpt-5.3-mini", tier: "mini" },
  { prefix: "o1-mini", tier: "mini" },
  { prefix: "o3-mini", tier: "mini" },
  // Advanced / reasoning models
  { prefix: "o1", tier: "advanced" },
  { prefix: "o3", tier: "advanced" },
  { prefix: "o4", tier: "advanced" },
  { prefix: "gpt-4.1", tier: "advanced" },
  { prefix: "gpt-5.4-codex", tier: "advanced" },
  { prefix: "gpt-5.3-codex", tier: "advanced" },
  { prefix: "gpt-5.2-codex", tier: "advanced" },
  { prefix: "gpt-5.1-codex", tier: "advanced" },
  { prefix: "gpt-5.4", tier: "advanced" },
  { prefix: "gpt-5.3", tier: "advanced" },
  { prefix: "gpt-5.2", tier: "advanced" },
  { prefix: "gpt-5.1", tier: "advanced" },
  // GPT-5 catch-all (non-mini/codex) — advanced
  { prefix: "gpt-5", tier: "advanced" },
  // GPT-4o — standard
  { prefix: "gpt-4o", tier: "standard" },
  // GPT-4 — standard
  { prefix: "gpt-4", tier: "standard" },
];

/** Gemini model tier table */
const GEMINI_TIERS: Array<{ prefix: string; tier: ModelTier }> = [
  // Flash — mini tier
  { prefix: "gemini-3-flash", tier: "mini" },
  { prefix: "gemini-2.5-flash", tier: "mini" },
  { prefix: "gemini-2.0-flash", tier: "mini" },
  { prefix: "gemini-1.5-flash", tier: "mini" },
  // Pro — standard/advanced
  { prefix: "gemini-3.1-pro", tier: "advanced" },
  { prefix: "gemini-3-pro", tier: "advanced" },
  { prefix: "gemini-2.5-pro", tier: "standard" },
  { prefix: "gemini-2.0-pro", tier: "standard" },
  { prefix: "gemini-1.5-pro", tier: "standard" },
];

/** Kimi / Moonshot model tier table */
const KIMI_TIERS: Array<{ prefix: string; tier: ModelTier }> = [
  { prefix: "kimi-for-coding", tier: "advanced" },
  { prefix: "kimi-k2", tier: "advanced" },
  { prefix: "kimi-latest", tier: "standard" },
  { prefix: "kimi", tier: "standard" },
];

/** Evaluation / experimental models (Copilot) */
const EVAL_TIERS: Array<{ prefix: string; tier: ModelTier }> = [
  { prefix: "grok-code", tier: "standard" },
  { prefix: "raptor", tier: "mini" },
  { prefix: "goldeneye", tier: "standard" },
];

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function matchTier(
  model: string,
  table: Array<{ prefix: string; tier: ModelTier }>,
): ModelTier | null {
  const lower = model.toLowerCase();
  // Longest-prefix-first matching for specificity
  const sorted = [...table].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const { prefix, tier } of sorted) {
    if (lower.startsWith(prefix.toLowerCase())) return tier;
  }
  return null;
}

/**
 * Returns the capability tier for a given provider + model combination.
 *
 * Falls back to "standard" for any unknown model — this is the safest default
 * (no tool limiting, standard compaction, CoT enabled).
 */
export function getModelTier(provider: string, model: string): ModelTier {
  if (!model) return "standard";
  const p = provider.toLowerCase();

  if (p === "anthropic") {
    return matchTier(model, ANTHROPIC_TIERS) ?? "standard";
  }

  // kimi-code uses the Anthropic SDK protocol but with kimi-specific models
  if (p === "kimi-code") {
    return matchTier(model, KIMI_TIERS) ?? matchTier(model, ANTHROPIC_TIERS) ?? "standard";
  }

  if (p === "openai" || p === "copilot" || p === "codex") {
    // Copilot uses dot-notation model names (claude-sonnet-4.6) — map to Anthropic tier
    if (model.startsWith("claude-")) {
      return matchTier(model, ANTHROPIC_TIERS) ?? "standard";
    }
    const evalMatch = matchTier(model, EVAL_TIERS);
    if (evalMatch) return evalMatch;
    return matchTier(model, OPENAI_TIERS) ?? "standard";
  }

  if (p === "gemini" || p === "vertex") {
    return matchTier(model, GEMINI_TIERS) ?? "standard";
  }

  if (p === "kimi" || p === "moonshot") {
    return matchTier(model, KIMI_TIERS) ?? "standard";
  }

  return "standard";
}

/**
 * Returns the TierConfig for a given provider + model.
 */
export function getTierConfig(provider: string, model: string): TierConfig {
  return TIER_CONFIGS[getModelTier(provider, model)];
}
