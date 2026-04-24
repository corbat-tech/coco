import { describe, it, expect } from "vitest";
import { getModelTier, getTierConfig } from "./model-tier.js";

describe("getModelTier", () => {
  describe("Anthropic models", () => {
    it("classifies haiku as mini", () => {
      expect(getModelTier("anthropic", "claude-haiku-4-5")).toBe("mini");
      expect(getModelTier("anthropic", "claude-3-haiku-20240307")).toBe("mini");
    });

    it("classifies sonnet as standard", () => {
      expect(getModelTier("anthropic", "claude-sonnet-4-6")).toBe("standard");
      expect(getModelTier("anthropic", "claude-3-5-sonnet-20241022")).toBe("standard");
      expect(getModelTier("anthropic", "claude-3-7-sonnet-20250219")).toBe("standard");
    });

    it("classifies opus as advanced", () => {
      expect(getModelTier("anthropic", "claude-opus-4-6")).toBe("advanced");
      expect(getModelTier("anthropic", "claude-opus-4")).toBe("advanced");
      expect(getModelTier("anthropic", "claude-3-opus-20240229")).toBe("advanced");
    });

    it("falls back to standard for unknown anthropic models", () => {
      expect(getModelTier("anthropic", "claude-future-9")).toBe("standard");
    });
  });

  describe("OpenAI models", () => {
    it("classifies mini models correctly", () => {
      expect(getModelTier("openai", "gpt-4o-mini")).toBe("mini");
      expect(getModelTier("openai", "gpt-5-mini")).toBe("mini");
      expect(getModelTier("openai", "o3-mini")).toBe("mini");
    });

    it("classifies standard models correctly", () => {
      expect(getModelTier("openai", "gpt-4o")).toBe("standard");
      expect(getModelTier("openai", "gpt-4")).toBe("standard");
    });

    it("classifies advanced/reasoning models correctly", () => {
      expect(getModelTier("openai", "o3")).toBe("advanced");
      expect(getModelTier("openai", "o4-mini")).toBe("advanced");
      expect(getModelTier("openai", "gpt-4.1")).toBe("advanced");
      expect(getModelTier("openai", "gpt-5.4")).toBe("advanced");
      expect(getModelTier("openai", "gpt-5.4-codex")).toBe("advanced");
    });
  });

  describe("Copilot models (dot-notation)", () => {
    it("classifies claude models via Anthropic tier table", () => {
      expect(getModelTier("copilot", "claude-sonnet-4.6")).toBe("standard");
      expect(getModelTier("copilot", "claude-opus-4.6")).toBe("advanced");
      expect(getModelTier("copilot", "claude-haiku-4.5")).toBe("mini");
    });

    it("classifies GPT models", () => {
      expect(getModelTier("copilot", "gpt-5-mini")).toBe("mini");
      expect(getModelTier("copilot", "gpt-4o")).toBe("standard");
      expect(getModelTier("copilot", "gpt-4.1")).toBe("advanced");
    });

    it("classifies eval models", () => {
      expect(getModelTier("copilot", "grok-code-fast-1")).toBe("standard");
      expect(getModelTier("copilot", "raptor-mini")).toBe("mini");
    });
  });

  describe("Gemini models", () => {
    it("classifies flash as mini", () => {
      expect(getModelTier("gemini", "gemini-2.5-flash")).toBe("mini");
      expect(getModelTier("gemini", "gemini-3-flash")).toBe("mini");
      expect(getModelTier("gemini", "gemini-3-flash-preview")).toBe("mini");
    });

    it("classifies pro as standard or advanced", () => {
      expect(getModelTier("gemini", "gemini-2.5-pro")).toBe("standard");
      expect(getModelTier("gemini", "gemini-3.1-pro")).toBe("advanced");
      expect(getModelTier("gemini", "gemini-3-pro")).toBe("advanced");
    });
  });

  describe("Kimi models", () => {
    it("classifies kimi-for-coding and kimi-k2 as advanced", () => {
      expect(getModelTier("kimi", "kimi-for-coding")).toBe("advanced");
      expect(getModelTier("kimi-code", "kimi-for-coding")).toBe("advanced");
    });
  });

  describe("Edge cases", () => {
    it("returns standard for empty model string", () => {
      expect(getModelTier("openai", "")).toBe("standard");
    });

    it("returns standard for unknown provider", () => {
      expect(getModelTier("future-provider", "some-model")).toBe("standard");
    });

    it("is case-insensitive for model names", () => {
      expect(getModelTier("openai", "GPT-4O-MINI")).toBe("mini");
    });
  });
});

describe("getTierConfig", () => {
  it("mini tier has reduced maxTools and no parallel calls", () => {
    const config = getTierConfig("openai", "gpt-5-mini");
    expect(config.maxTools).toBeLessThanOrEqual(12);
    expect(config.parallelToolCalls).toBe(false);
    expect(config.compactionThreshold).toBeLessThan(0.75);
    expect(config.supportsCoT).toBe(false);
  });

  it("advanced tier has high maxTools and parallel calls", () => {
    const config = getTierConfig("openai", "o3");
    expect(config.maxTools).toBeGreaterThan(40);
    expect(config.parallelToolCalls).toBe(true);
    expect(config.supportsCoT).toBe(true);
  });

  it("standard tier is in between", () => {
    const config = getTierConfig("openai", "gpt-4o");
    expect(config.maxTools).toBeGreaterThan(12);
    expect(config.maxTools).toBeLessThanOrEqual(40);
    expect(config.parallelToolCalls).toBe(true);
    expect(config.supportsCoT).toBe(true);
  });
});
