/**
 * Unified thinking/reasoning mode support for all LLM providers.
 *
 * Normalizes three distinct API surfaces:
 *   - Anthropic: thinking.budget_tokens
 *   - OpenAI Chat Completions: reasoning_effort
 *   - OpenAI Responses API: reasoning.effort
 *   - Gemini: thinkingConfig.thinkingBudget
 *   - Kimi: thinking.type enabled/disabled
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Provider-agnostic thinking mode.
 * "off"    — disable thinking entirely (or keep disabled for models like Kimi)
 * "auto"   — provider default / dynamic budget
 * "low"    — minimal reasoning
 * "medium" — balanced reasoning
 * "high"   — maximum reasoning
 * { budget: N } — explicit token budget (Anthropic / Gemini only; rejected for effort-only providers)
 */
export type ThinkingMode = "off" | "auto" | "low" | "medium" | "high" | { budget: number };

/**
 * Whether this provider/model uses effort buckets (OpenAI) or token budgets (Anthropic, Gemini).
 */
export type ThinkingKind = "effort" | "budget";

export interface ThinkingCapability {
  /** True when the model supports configurable reasoning */
  supported: boolean;
  /** How the model expresses reasoning intensity */
  kinds: ThinkingKind[];
  /** Human-readable levels the user can pick */
  levels: readonly ThinkingMode[];
  /** Token budget range (only for "budget" kind) */
  budgetRange?: { min: number; max: number; default: number };
  /** Sensible default mode for this model */
  defaultMode: ThinkingMode;
}

// ─── Budget constants ─────────────────────────────────────────────────────────

const ANTHROPIC_BUDGET: Record<"low" | "medium" | "high", number> = {
  low: 2048,
  medium: 8000,
  high: 16000,
};

const GEMINI_BUDGET: Record<"low" | "medium" | "high", number> = {
  low: 2048,
  medium: 8000,
  high: 16000,
};

// ─── Capability detection ─────────────────────────────────────────────────────

function isAnthropicThinkingModel(model: string): boolean {
  const m = model.toLowerCase();
  // Models with extended thinking support (claude 3.7+, claude 4+)
  // Excludes claude-3-5-*, claude-3-haiku-*, claude-3-opus-*, claude-3-sonnet-*
  // Excludes kimi-for-coding (uses Anthropic SDK but different endpoint)
  if (m === "kimi-for-coding") return false;
  return (
    m.includes("claude-3-7") ||
    m.includes("claude-opus-4") ||
    m.includes("claude-sonnet-4") ||
    m.includes("claude-haiku-4-5") ||
    m.includes("claude-4")
  );
}

function isOpenAIReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return (
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4") ||
    m.startsWith("gpt-5") ||
    m.includes("codex")
  );
}

function isGeminiThinkingModel(model: string): boolean {
  const m = model.toLowerCase();
  return (
    m.includes("gemini-2.5-pro") ||
    m.includes("gemini-2.5-flash") ||
    (m.includes("gemini-3") && !m.includes("flash-lite")) ||
    m.includes("gemini-2.0-flash-thinking")
  );
}

function isKimiThinkingModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("kimi-k2") || m === "kimi-latest";
}

// ─── Public capability lookup ─────────────────────────────────────────────────

const UNSUPPORTED: ThinkingCapability = {
  supported: false,
  kinds: [],
  levels: ["off"],
  defaultMode: "off",
};

const ANTHROPIC_CAPABILITY: ThinkingCapability = {
  supported: true,
  kinds: ["budget"],
  levels: ["off", "auto", "low", "medium", "high"],
  budgetRange: { min: 1024, max: 64000, default: ANTHROPIC_BUDGET.medium },
  defaultMode: "off",
};

const OPENAI_CAPABILITY: ThinkingCapability = {
  supported: true,
  kinds: ["effort"],
  levels: ["off", "auto", "low", "medium", "high"],
  defaultMode: "medium",
};

const GEMINI_CAPABILITY: ThinkingCapability = {
  supported: true,
  kinds: ["budget"],
  levels: ["off", "auto", "low", "medium", "high"],
  budgetRange: { min: 0, max: 32000, default: GEMINI_BUDGET.medium },
  defaultMode: "auto",
};

const KIMI_CAPABILITY: ThinkingCapability = {
  supported: true,
  kinds: ["effort"],
  levels: ["off", "auto"],
  defaultMode: "off",
};

/**
 * Returns the thinking capability for a given (provider, model) pair.
 * `provider` here is the provider type string from ProviderType.
 */
export function getThinkingCapability(provider: string, model: string): ThinkingCapability {
  switch (provider) {
    case "anthropic":
    case "kimi-code":
      return isAnthropicThinkingModel(model) ? ANTHROPIC_CAPABILITY : UNSUPPORTED;

    case "openai":
    case "copilot":
    case "groq":
    case "openrouter":
    case "mistral":
    case "deepseek":
    case "together":
    case "huggingface":
    case "qwen":
      return isOpenAIReasoningModel(model) ? OPENAI_CAPABILITY : UNSUPPORTED;

    case "kimi":
      return isKimiThinkingModel(model) ? KIMI_CAPABILITY : UNSUPPORTED;

    case "gemini":
    case "vertex":
      return isGeminiThinkingModel(model) ? GEMINI_CAPABILITY : UNSUPPORTED;

    case "lmstudio":
    case "ollama":
    case "codex":
      return UNSUPPORTED;

    default:
      return UNSUPPORTED;
  }
}

/**
 * Returns the sensible default ThinkingMode for a (provider, model) pair.
 */
export function resolveDefaultThinking(provider: string, model: string): ThinkingMode {
  return getThinkingCapability(provider, model).defaultMode;
}

// ─── Format helper ────────────────────────────────────────────────────────────

/** Human-readable label for display in status bar and commands */
export function formatThinkingMode(mode: ThinkingMode): string {
  if (typeof mode === "object") return `${mode.budget}t`;
  return mode;
}

// ─── Provider mappers ─────────────────────────────────────────────────────────

/**
 * Map ThinkingMode → Anthropic `thinking` parameter shape.
 * Returns undefined when thinking should be omitted from the request.
 *
 * NOTE: When this returns a non-undefined value, the caller MUST also:
 *   - set temperature = 1 (Anthropic requirement)
 *   - ensure max_tokens > budget_tokens
 */
export function mapToAnthropic(
  mode: ThinkingMode | undefined,
  model: string,
): { type: "enabled"; budget_tokens: number } | undefined {
  if (!mode || mode === "off") return undefined;
  if (!isAnthropicThinkingModel(model)) return undefined;

  const cap = ANTHROPIC_CAPABILITY;
  const { min, max } = cap.budgetRange!;

  if (typeof mode === "object") {
    return { type: "enabled", budget_tokens: Math.min(Math.max(mode.budget, min), max) };
  }

  const budgetMap: Partial<Record<string, number>> = {
    auto: cap.budgetRange!.default,
    low: ANTHROPIC_BUDGET.low,
    medium: ANTHROPIC_BUDGET.medium,
    high: ANTHROPIC_BUDGET.high,
  };

  const budget = budgetMap[mode];
  if (budget === undefined) return undefined;
  return { type: "enabled", budget_tokens: budget };
}

/**
 * Map ThinkingMode → OpenAI `reasoning_effort` value.
 * Returns undefined when the field should be omitted from the request.
 */
export function mapToOpenAIEffort(
  mode: ThinkingMode | undefined,
  model: string,
): "low" | "medium" | "high" | undefined {
  if (!mode || mode === "off") return undefined;
  if (!isOpenAIReasoningModel(model)) return undefined;

  if (typeof mode === "object") {
    // Map budget → effort bucket
    const { budget } = mode;
    if (budget <= 2048) return "low";
    if (budget <= 8000) return "medium";
    return "high";
  }

  if (mode === "auto") return "medium";
  if (mode === "low" || mode === "medium" || mode === "high") return mode;
  return undefined;
}

/**
 * Map ThinkingMode → Gemini `thinkingBudget` value.
 * Returns undefined when thinkingConfig should be omitted.
 *   -1 = dynamic (auto)
 *    0 = disabled
 *   >0 = explicit token budget
 */
export function mapToGeminiBudget(
  mode: ThinkingMode | undefined,
  model: string,
): number | undefined {
  if (!isGeminiThinkingModel(model)) return undefined;
  if (!mode) return undefined;

  if (mode === "off") return 0;
  if (mode === "auto") return -1;

  const { min, max } = GEMINI_CAPABILITY.budgetRange!;

  if (typeof mode === "object") {
    return Math.min(Math.max(mode.budget, min), max);
  }

  const budgetMap: Partial<Record<string, number>> = {
    low: GEMINI_BUDGET.low,
    medium: GEMINI_BUDGET.medium,
    high: GEMINI_BUDGET.high,
  };

  return budgetMap[mode];
}

/**
 * Map ThinkingMode → Kimi `thinking` extra body field.
 * Returns undefined for non-Kimi models (callers should skip spreading).
 * Default (undefined mode) preserves today's disabled behavior.
 */
export function mapToKimiExtraBody(
  mode: ThinkingMode | undefined,
  model: string,
): { thinking: { type: "enabled" | "disabled" } } | undefined {
  if (!isKimiThinkingModel(model)) return undefined;

  // Default: disabled (preserves existing behavior)
  const effectiveMode = mode ?? "off";
  const enabled = effectiveMode !== "off";
  return { thinking: { type: enabled ? "enabled" : "disabled" } };
}
