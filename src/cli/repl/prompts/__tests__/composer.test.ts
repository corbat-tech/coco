import { describe, it, expect } from "vitest";
import { composeEnhancers } from "../enhancers/composer.js";
import type { PromptEnhancer } from "../enhancers/types.js";

function makeEnhancer(overrides: Partial<PromptEnhancer> = {}): PromptEnhancer {
  return {
    name: "Test",
    description: "Test enhancer",
    triggers: ["general"],
    priority: 50,
    content: "Test content here.",
    enabled: true,
    ...overrides,
  };
}

describe("composeEnhancers", () => {
  it("should return empty string for empty array", () => {
    expect(composeEnhancers([])).toBe("");
  });

  it("should compose a single enhancer with header", () => {
    const result = composeEnhancers([makeEnhancer({ name: "Alpha", content: "Do alpha things." })]);
    expect(result).toBe("## Alpha\n\nDo alpha things.");
  });

  it("should compose multiple enhancers separated by double newlines", () => {
    const enhancers = [
      makeEnhancer({ name: "First", content: "First content.", priority: 1 }),
      makeEnhancer({ name: "Second", content: "Second content.", priority: 2 }),
    ];
    const result = composeEnhancers(enhancers);
    expect(result).toContain("## First\n\nFirst content.");
    expect(result).toContain("## Second\n\nSecond content.");
    expect(result.indexOf("First")).toBeLessThan(result.indexOf("Second"));
  });

  it("should respect maxChars budget by dropping later enhancers", () => {
    const enhancers = [
      makeEnhancer({ name: "A", content: "Short.", priority: 1 }),
      makeEnhancer({ name: "B", content: "X".repeat(5000), priority: 2 }),
      makeEnhancer({ name: "C", content: "Should be dropped.", priority: 3 }),
    ];
    // Budget of 100 should only fit the first enhancer
    const result = composeEnhancers(enhancers, 100);
    expect(result).toContain("## A");
    expect(result).not.toContain("## B");
    expect(result).not.toContain("## C");
  });

  it("should always include at least the first enhancer even if over budget", () => {
    const enhancers = [makeEnhancer({ name: "Big", content: "X".repeat(200), priority: 1 })];
    // Budget smaller than the content
    const result = composeEnhancers(enhancers, 50);
    expect(result).toContain("## Big");
  });

  it("should include as many enhancers as fit in budget", () => {
    const enhancers = [
      makeEnhancer({ name: "A", content: "AAA", priority: 1 }),
      makeEnhancer({ name: "B", content: "BBB", priority: 2 }),
      makeEnhancer({ name: "C", content: "CCC", priority: 3 }),
    ];
    // Generous budget should include all
    const result = composeEnhancers(enhancers, 10000);
    expect(result).toContain("## A");
    expect(result).toContain("## B");
    expect(result).toContain("## C");
  });
});
