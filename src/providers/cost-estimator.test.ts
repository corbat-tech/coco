/**
 * Tests for Cost Estimator
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  estimateTokens,
  estimateCost,
  formatCostEstimate,
  BudgetTracker,
} from "./cost-estimator.js";
import type { CostEstimate } from "./cost-estimator.js";

describe("estimateTokens", () => {
  it("should estimate tokens based on ~4 chars per token", () => {
    const text = "hello world"; // 11 chars
    expect(estimateTokens(text)).toBe(Math.ceil(11 / 4));
  });

  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should round up fractional tokens", () => {
    // 5 chars => 5/4 = 1.25, ceil = 2
    expect(estimateTokens("hello")).toBe(2);
  });

  it("should handle long text", () => {
    const text = "a".repeat(10000);
    expect(estimateTokens(text)).toBe(2500);
  });

  it("should handle single character", () => {
    expect(estimateTokens("x")).toBe(1);
  });
});

describe("estimateCost", () => {
  it("should estimate cost for a known model (claude-sonnet-4)", () => {
    const result = estimateCost("test prompt", "claude-sonnet-4");
    expect(result.estimatedInputTokens).toBeGreaterThan(0);
    expect(result.estimatedOutputTokens).toBeGreaterThan(0);
    expect(result.minCost).toBeGreaterThan(0);
    expect(result.maxCost).toBeGreaterThan(result.minCost);
    expect(result.expectedCost).toBeGreaterThan(result.minCost);
    expect(result.expectedCost).toBeLessThan(result.maxCost);
  });

  it("should use default mid-tier cost for unknown model", () => {
    const result = estimateCost("test prompt", "unknown-model-xyz");
    // Default is input: 3, output: 15 (same as claude-sonnet-4)
    const knownResult = estimateCost("test prompt", "claude-sonnet-4");
    expect(result.expectedCost).toBe(knownResult.expectedCost);
  });

  it("should apply partial model name matching", () => {
    // "my-gpt-4-turbo-v2" contains "gpt-4-turbo"
    const result = estimateCost("test prompt", "my-gpt-4-turbo-v2");
    const directResult = estimateCost("test prompt", "gpt-4-turbo");
    expect(result.expectedCost).toBe(directResult.expectedCost);
  });

  it("should multiply cost for COCO mode with iterations", () => {
    const single = estimateCost("test prompt", "claude-sonnet-4");
    const coco = estimateCost("test prompt", "claude-sonnet-4", {
      cocoMode: true,
      iterations: 3,
    });

    expect(coco.expectedCost).toBeCloseTo(single.expectedCost * 3, 10);
    expect(coco.estimatedInputTokens).toBe(single.estimatedInputTokens * 3);
    expect(coco.estimatedOutputTokens).toBe(single.estimatedOutputTokens * 3);
  });

  it("should default to 3 iterations in COCO mode when not specified", () => {
    const coco = estimateCost("test prompt", "claude-sonnet-4", {
      cocoMode: true,
    });
    const single = estimateCost("test prompt", "claude-sonnet-4");

    expect(coco.expectedCost).toBeCloseTo(single.expectedCost * 3, 10);
  });

  it("should not multiply cost when cocoMode is false", () => {
    const result = estimateCost("test prompt", "claude-sonnet-4", {
      cocoMode: false,
      iterations: 5,
    });
    const single = estimateCost("test prompt", "claude-sonnet-4");

    expect(result.expectedCost).toBe(single.expectedCost);
  });

  it("should set warning to true when expected cost > $0.50", () => {
    const longPrompt = "a".repeat(100000);
    const result = estimateCost(longPrompt, "claude-opus-4");
    expect(result.warning).toBe(true);
  });

  it("should set warning to false for small prompts", () => {
    const result = estimateCost("small prompt", "claude-haiku-4");
    expect(result.warning).toBe(false);
  });

  it("should handle gemini-flash model pricing", () => {
    const result = estimateCost("test", "gemini-flash");
    expect(result.expectedCost).toBeGreaterThan(0);
  });

  it("should return consistent output token estimates (2x input)", () => {
    const result = estimateCost("test prompt data", "claude-sonnet-4");
    expect(result.estimatedOutputTokens).toBe(result.estimatedInputTokens * 2);
  });
});

describe("formatCostEstimate", () => {
  it("should format cost estimate with expected cost", () => {
    const estimate: CostEstimate = {
      estimatedInputTokens: 100,
      estimatedOutputTokens: 200,
      minCost: 0.001,
      maxCost: 0.003,
      expectedCost: 0.002,
      warning: false,
    };

    const output = formatCostEstimate(estimate);
    expect(output).toContain("$0.002");
    expect(output).toContain("$0.001");
    expect(output).toContain("$0.003");
    expect(output).toContain("~100 in");
    expect(output).toContain("~200 out");
  });

  it("should include warning when warning is true", () => {
    const estimate: CostEstimate = {
      estimatedInputTokens: 100,
      estimatedOutputTokens: 200,
      minCost: 0.3,
      maxCost: 1.0,
      expectedCost: 0.6,
      warning: true,
    };

    const output = formatCostEstimate(estimate);
    expect(output).toContain(">$0.50");
  });

  it("should not include warning when warning is false", () => {
    const estimate: CostEstimate = {
      estimatedInputTokens: 10,
      estimatedOutputTokens: 20,
      minCost: 0.0001,
      maxCost: 0.0003,
      expectedCost: 0.0002,
      warning: false,
    };

    const output = formatCostEstimate(estimate);
    expect(output).not.toContain(">$0.50");
  });
});

describe("BudgetTracker", () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    tracker = new BudgetTracker();
  });

  it("should start with zero budget and zero spent", () => {
    expect(tracker.getRemaining()).toBe(0);
    expect(tracker.getPercentage()).toBe(0);
  });

  it("should set budget", () => {
    tracker.setBudget(10);
    expect(tracker.getRemaining()).toBe(10);
  });

  it("should track spending", () => {
    tracker.setBudget(10);
    tracker.addSpent(3);
    expect(tracker.getRemaining()).toBe(7);
  });

  it("should accumulate spending across multiple calls", () => {
    tracker.setBudget(10);
    tracker.addSpent(2);
    tracker.addSpent(3);
    expect(tracker.getRemaining()).toBe(5);
  });

  it("should calculate percentage correctly", () => {
    tracker.setBudget(100);
    tracker.addSpent(25);
    expect(tracker.getPercentage()).toBe(25);
  });

  it("should return 0 percentage when budget is 0", () => {
    expect(tracker.getPercentage()).toBe(0);
  });

  it("should warn at 80% usage", () => {
    tracker.setBudget(100);
    tracker.addSpent(80);
    expect(tracker.shouldWarn()).toBe(true);
  });

  it("should not warn below 80% usage", () => {
    tracker.setBudget(100);
    tracker.addSpent(79);
    expect(tracker.shouldWarn()).toBe(false);
  });

  it("should pause at 95% usage", () => {
    tracker.setBudget(100);
    tracker.addSpent(95);
    expect(tracker.shouldPause()).toBe(true);
  });

  it("should not pause below 95% usage", () => {
    tracker.setBudget(100);
    tracker.addSpent(94);
    expect(tracker.shouldPause()).toBe(false);
  });

  it("should handle over-budget spending", () => {
    tracker.setBudget(10);
    tracker.addSpent(15);
    expect(tracker.getRemaining()).toBe(-5);
    expect(tracker.getPercentage()).toBe(150);
    expect(tracker.shouldPause()).toBe(true);
  });

  it("should format output with budget info", () => {
    tracker.setBudget(50);
    tracker.addSpent(10);
    const output = tracker.format();
    expect(output).toContain("Budget: $50.00");
    expect(output).toContain("Spent: $10.00");
    expect(output).toContain("Remaining: $40.00");
  });

  it("should format output with warning at 80%+", () => {
    tracker.setBudget(100);
    tracker.addSpent(85);
    const output = tracker.format();
    expect(output).toContain("Warning");
    expect(output).toContain("85");
  });

  it("should format output with pause message at 95%+", () => {
    tracker.setBudget(100);
    tracker.addSpent(96);
    const output = tracker.format();
    expect(output).toContain("Budget exceeded");
  });
});
