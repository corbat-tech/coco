import { describe, it, expect } from "vitest";
import {
  getThinkingCapability,
  resolveDefaultThinking,
  formatThinkingMode,
  mapToAnthropic,
  mapToOpenAIEffort,
  mapToGeminiBudget,
  mapToKimiExtraBody,
} from "./thinking.js";

describe("getThinkingCapability", () => {
  describe("Anthropic provider", () => {
    it("returns supported for claude-opus-4-6", () => {
      const cap = getThinkingCapability("anthropic", "claude-opus-4-6");
      expect(cap.supported).toBe(true);
      expect(cap.kinds).toContain("budget");
    });

    it("returns supported for claude-3-7-sonnet-20250219", () => {
      const cap = getThinkingCapability("anthropic", "claude-3-7-sonnet-20250219");
      expect(cap.supported).toBe(true);
    });

    it("returns unsupported for claude-3-5-sonnet (legacy)", () => {
      const cap = getThinkingCapability("anthropic", "claude-3-5-sonnet-20241022");
      expect(cap.supported).toBe(false);
    });

    it("returns unsupported for kimi-for-coding (Anthropic endpoint)", () => {
      const cap = getThinkingCapability("kimi-code", "kimi-for-coding");
      expect(cap.supported).toBe(false);
    });

    it("defaultMode is off (preserves cost behavior)", () => {
      const cap = getThinkingCapability("anthropic", "claude-opus-4-6");
      expect(cap.defaultMode).toBe("off");
    });

    it("includes budgetRange", () => {
      const cap = getThinkingCapability("anthropic", "claude-opus-4-6");
      expect(cap.budgetRange).toBeDefined();
      expect(cap.budgetRange!.min).toBeGreaterThan(0);
      expect(cap.budgetRange!.max).toBeGreaterThan(cap.budgetRange!.min);
    });
  });

  describe("OpenAI provider", () => {
    it("returns supported for o3", () => {
      const cap = getThinkingCapability("openai", "o3");
      expect(cap.supported).toBe(true);
      expect(cap.kinds).toContain("effort");
    });

    it("returns supported for o4-mini", () => {
      const cap = getThinkingCapability("openai", "o4-mini");
      expect(cap.supported).toBe(true);
    });

    it("returns supported for gpt-5.3-codex", () => {
      const cap = getThinkingCapability("openai", "gpt-5.3-codex");
      expect(cap.supported).toBe(true);
    });

    it("returns unsupported for gpt-4o", () => {
      const cap = getThinkingCapability("openai", "gpt-4o");
      expect(cap.supported).toBe(false);
    });

    it("returns unsupported for gpt-4.1", () => {
      const cap = getThinkingCapability("openai", "gpt-4.1");
      expect(cap.supported).toBe(false);
    });

    it("defaultMode is medium for o-series", () => {
      const cap = getThinkingCapability("openai", "o3");
      expect(cap.defaultMode).toBe("medium");
    });

    it("is inherited by copilot provider for reasoning models", () => {
      const cap = getThinkingCapability("copilot", "o4-mini");
      expect(cap.supported).toBe(true);
    });
  });

  describe("Gemini provider", () => {
    it("returns supported for gemini-2.5-pro", () => {
      const cap = getThinkingCapability("gemini", "gemini-2.5-pro");
      expect(cap.supported).toBe(true);
      expect(cap.kinds).toContain("budget");
    });

    it("returns supported for gemini-2.5-flash", () => {
      const cap = getThinkingCapability("gemini", "gemini-2.5-flash");
      expect(cap.supported).toBe(true);
    });

    it("returns unsupported for gemini-1.5-pro", () => {
      const cap = getThinkingCapability("gemini", "gemini-1.5-pro");
      expect(cap.supported).toBe(false);
    });

    it("defaultMode is auto", () => {
      const cap = getThinkingCapability("gemini", "gemini-2.5-pro");
      expect(cap.defaultMode).toBe("auto");
    });
  });

  describe("Kimi provider", () => {
    it("returns supported for kimi-k2.5", () => {
      const cap = getThinkingCapability("kimi", "kimi-k2.5");
      expect(cap.supported).toBe(true);
    });

    it("returns supported for kimi-latest", () => {
      const cap = getThinkingCapability("kimi", "kimi-latest");
      expect(cap.supported).toBe(true);
    });

    it("defaultMode is off", () => {
      const cap = getThinkingCapability("kimi", "kimi-k2.5");
      expect(cap.defaultMode).toBe("off");
    });
  });

  describe("local providers", () => {
    it("ollama is unsupported", () => {
      expect(getThinkingCapability("ollama", "llama3").supported).toBe(false);
    });

    it("lmstudio is unsupported", () => {
      expect(getThinkingCapability("lmstudio", "any-model").supported).toBe(false);
    });
  });
});

describe("resolveDefaultThinking", () => {
  it("returns off for unsupported Anthropic models", () => {
    expect(resolveDefaultThinking("anthropic", "claude-3-5-sonnet-20241022")).toBe("off");
  });

  it("returns off for supported Anthropic models (preserve cost behavior)", () => {
    expect(resolveDefaultThinking("anthropic", "claude-opus-4-6")).toBe("off");
  });

  it("returns medium for o3", () => {
    expect(resolveDefaultThinking("openai", "o3")).toBe("medium");
  });

  it("returns auto for gemini-2.5-pro", () => {
    expect(resolveDefaultThinking("gemini", "gemini-2.5-pro")).toBe("auto");
  });
});

describe("formatThinkingMode", () => {
  it("formats string modes as-is", () => {
    expect(formatThinkingMode("off")).toBe("off");
    expect(formatThinkingMode("high")).toBe("high");
    expect(formatThinkingMode("auto")).toBe("auto");
  });

  it("formats budget objects with t suffix", () => {
    expect(formatThinkingMode({ budget: 8000 })).toBe("8000t");
    expect(formatThinkingMode({ budget: 2048 })).toBe("2048t");
  });
});

describe("mapToAnthropic", () => {
  const model = "claude-opus-4-6";

  it("returns undefined for off", () => {
    expect(mapToAnthropic("off", model)).toBeUndefined();
  });

  it("returns undefined for undefined mode", () => {
    expect(mapToAnthropic(undefined, model)).toBeUndefined();
  });

  it("returns budget for low", () => {
    const result = mapToAnthropic("low", model);
    expect(result).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  it("returns budget for medium", () => {
    const result = mapToAnthropic("medium", model);
    expect(result).toEqual({ type: "enabled", budget_tokens: 8000 });
  });

  it("returns budget for high", () => {
    const result = mapToAnthropic("high", model);
    expect(result).toEqual({ type: "enabled", budget_tokens: 16000 });
  });

  it("returns default budget for auto", () => {
    const result = mapToAnthropic("auto", model);
    expect(result?.type).toBe("enabled");
    expect(result?.budget_tokens).toBeGreaterThan(0);
  });

  it("passes through numeric budget", () => {
    const result = mapToAnthropic({ budget: 12000 }, model);
    expect(result).toEqual({ type: "enabled", budget_tokens: 12000 });
  });

  it("clamps budget to max", () => {
    const result = mapToAnthropic({ budget: 999999 }, model);
    expect(result!.budget_tokens).toBeLessThanOrEqual(64000);
  });

  it("clamps budget to min", () => {
    const result = mapToAnthropic({ budget: 10 }, model);
    expect(result!.budget_tokens).toBeGreaterThanOrEqual(1024);
  });

  it("returns undefined for unsupported model", () => {
    expect(mapToAnthropic("high", "claude-3-5-sonnet-20241022")).toBeUndefined();
  });

  it("returns undefined for kimi-for-coding (Anthropic endpoint)", () => {
    expect(mapToAnthropic("high", "kimi-for-coding")).toBeUndefined();
  });
});

describe("mapToOpenAIEffort", () => {
  const model = "o4-mini";

  it("returns undefined for off", () => {
    expect(mapToOpenAIEffort("off", model)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(mapToOpenAIEffort(undefined, model)).toBeUndefined();
  });

  it("maps low → low", () => {
    expect(mapToOpenAIEffort("low", model)).toBe("low");
  });

  it("maps medium → medium", () => {
    expect(mapToOpenAIEffort("medium", model)).toBe("medium");
  });

  it("maps high → high", () => {
    expect(mapToOpenAIEffort("high", model)).toBe("high");
  });

  it("maps auto → medium", () => {
    expect(mapToOpenAIEffort("auto", model)).toBe("medium");
  });

  it("maps small budget to low", () => {
    expect(mapToOpenAIEffort({ budget: 1000 }, model)).toBe("low");
  });

  it("maps medium budget to medium", () => {
    expect(mapToOpenAIEffort({ budget: 5000 }, model)).toBe("medium");
  });

  it("maps large budget to high", () => {
    expect(mapToOpenAIEffort({ budget: 20000 }, model)).toBe("high");
  });

  it("returns undefined for unsupported model (gpt-4o)", () => {
    expect(mapToOpenAIEffort("high", "gpt-4o")).toBeUndefined();
  });
});

describe("mapToGeminiBudget", () => {
  const model = "gemini-2.5-pro";

  it("returns 0 for off", () => {
    expect(mapToGeminiBudget("off", model)).toBe(0);
  });

  it("returns -1 for auto", () => {
    expect(mapToGeminiBudget("auto", model)).toBe(-1);
  });

  it("returns low budget for low", () => {
    expect(mapToGeminiBudget("low", model)).toBe(2048);
  });

  it("returns medium budget for medium", () => {
    expect(mapToGeminiBudget("medium", model)).toBe(8000);
  });

  it("returns high budget for high", () => {
    expect(mapToGeminiBudget("high", model)).toBe(16000);
  });

  it("passes through numeric budget", () => {
    expect(mapToGeminiBudget({ budget: 12000 }, model)).toBe(12000);
  });

  it("returns undefined for unsupported model", () => {
    expect(mapToGeminiBudget("high", "gemini-1.5-pro")).toBeUndefined();
  });

  it("returns undefined for undefined mode", () => {
    expect(mapToGeminiBudget(undefined, model)).toBeUndefined();
  });
});

describe("mapToKimiExtraBody", () => {
  it("disables thinking for off mode", () => {
    const result = mapToKimiExtraBody("off", "kimi-k2.5");
    expect(result).toEqual({ thinking: { type: "disabled" } });
  });

  it("disables thinking for undefined mode (default preserve)", () => {
    const result = mapToKimiExtraBody(undefined, "kimi-k2.5");
    expect(result).toEqual({ thinking: { type: "disabled" } });
  });

  it("enables thinking for auto mode", () => {
    const result = mapToKimiExtraBody("auto", "kimi-k2.5");
    expect(result).toEqual({ thinking: { type: "enabled" } });
  });

  it("enables thinking for high mode", () => {
    const result = mapToKimiExtraBody("high", "kimi-k2.5");
    expect(result).toEqual({ thinking: { type: "enabled" } });
  });

  it("returns undefined for non-Kimi model", () => {
    expect(mapToKimiExtraBody("auto", "gpt-4o")).toBeUndefined();
  });

  it("returns undefined for kimi-for-coding (not a thinking model)", () => {
    expect(mapToKimiExtraBody("auto", "kimi-for-coding")).toBeUndefined();
  });
});
