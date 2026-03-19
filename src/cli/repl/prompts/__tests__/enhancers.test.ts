import { describe, it, expect } from "vitest";
import { VERIFICATION_ENHANCER } from "../enhancers/verification.js";
import { PARALLEL_ENHANCER } from "../enhancers/parallel.js";
import { RESEARCH_ENHANCER } from "../enhancers/research.js";
import { DEBUGGING_ENHANCER } from "../enhancers/debugging.js";
import { TESTING_ENHANCER } from "../enhancers/testing.js";
import { PLANNING_ENHANCER } from "../enhancers/planning.js";
import { ALL_REQUEST_TYPES } from "../enhancers/types.js";
import type { PromptEnhancer } from "../enhancers/types.js";
import { getEnhancersForRequest } from "../index.js";

const ALL_ENHANCERS: PromptEnhancer[] = [
  VERIFICATION_ENHANCER,
  PARALLEL_ENHANCER,
  RESEARCH_ENHANCER,
  DEBUGGING_ENHANCER,
  TESTING_ENHANCER,
  PLANNING_ENHANCER,
];

describe("Built-in enhancers structure", () => {
  it("should all have non-empty names", () => {
    for (const e of ALL_ENHANCERS) {
      expect(e.name.length).toBeGreaterThan(0);
    }
  });

  it("should all have non-empty descriptions", () => {
    for (const e of ALL_ENHANCERS) {
      expect(e.description.length).toBeGreaterThan(0);
    }
  });

  it("should all have non-empty content", () => {
    for (const e of ALL_ENHANCERS) {
      expect(e.content.length).toBeGreaterThan(50);
    }
  });

  it("should all have valid triggers", () => {
    for (const e of ALL_ENHANCERS) {
      expect(e.triggers.length).toBeGreaterThan(0);
      for (const trigger of e.triggers) {
        expect(ALL_REQUEST_TYPES).toContain(trigger);
      }
    }
  });

  it("should all be enabled by default", () => {
    for (const e of ALL_ENHANCERS) {
      expect(e.enabled).toBe(true);
    }
  });

  it("should all have unique names", () => {
    const names = ALL_ENHANCERS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("should all have unique priorities", () => {
    const priorities = ALL_ENHANCERS.map((e) => e.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});

describe("getEnhancersForRequest integration", () => {
  it("should return non-empty text for a feature request", () => {
    const result = getEnhancersForRequest("implement user authentication");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("Verification Protocol");
    expect(result).toContain("Parallel Tool Execution");
    expect(result).toContain("Proactive Codebase Research");
    expect(result).toContain("Task Planning");
  });

  it("should return debugging enhancer for a bugfix request", () => {
    const result = getEnhancersForRequest("fix the login error");
    expect(result).toContain("Systematic Debugging");
    expect(result).toContain("Testing Discipline");
  });

  it("should return minimal enhancers for a question", () => {
    const result = getEnhancersForRequest("what does this function do?");
    expect(result).toContain("Verification Protocol");
    expect(result).toContain("Parallel Tool Execution");
    // Questions shouldn't get research/debugging/testing/planning
    expect(result).not.toContain("Proactive Codebase Research");
    expect(result).not.toContain("Systematic Debugging");
  });

  it("should return non-empty text for general input", () => {
    const result = getEnhancersForRequest("hello");
    // Even general input gets verification + parallel
    expect(result).toContain("Verification Protocol");
    expect(result).toContain("Parallel Tool Execution");
  });

  it("should return non-empty text for empty string input", () => {
    const result = getEnhancersForRequest("");
    // Empty → general → verification + parallel
    expect(result).toContain("Verification Protocol");
    expect(result).toContain("Parallel Tool Execution");
  });

  it("should return different enhancers for different request types", () => {
    const featureResult = getEnhancersForRequest("create a new module");
    const questionResult = getEnhancersForRequest("how does the auth system work?");

    // Feature should have more enhancers than question
    expect(featureResult.length).toBeGreaterThan(questionResult.length);
  });
});
