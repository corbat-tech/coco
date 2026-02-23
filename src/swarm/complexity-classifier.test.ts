/**
 * Tests for complexity-classifier.ts
 *
 * Tests the heuristic classification function thoroughly (no LLM required).
 * LLM path is covered indirectly — it falls back to the heuristic on failure.
 */

import { describe, it, expect, vi } from "vitest";
import { classifyFeatureHeuristic, AGENT_ROSTERS } from "./complexity-classifier.js";
import type { SwarmFeature } from "./spec-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeature(overrides: Partial<SwarmFeature> = {}): SwarmFeature {
  return {
    id: "f-test",
    name: "Test Feature",
    description: overrides.description ?? "",
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    dependencies: overrides.dependencies ?? [],
    priority: overrides.priority ?? "medium",
  };
}

// ---------------------------------------------------------------------------
// AGENT_ROSTERS
// ---------------------------------------------------------------------------

describe("AGENT_ROSTERS", () => {
  it("trivial includes only tdd-developer", () => {
    expect(AGENT_ROSTERS.trivial).toEqual(["tdd-developer"]);
  });

  it("simple includes tdd-developer and qa", () => {
    expect(AGENT_ROSTERS.simple).toEqual(["tdd-developer", "qa"]);
  });

  it("moderate includes tdd-developer, qa, and architect", () => {
    expect(AGENT_ROSTERS.moderate).toEqual(["tdd-developer", "qa", "architect"]);
  });

  it("complex includes tdd-developer, qa, architect, security-auditor, and external-reviewer", () => {
    expect(AGENT_ROSTERS.complex).toContain("tdd-developer");
    expect(AGENT_ROSTERS.complex).toContain("qa");
    expect(AGENT_ROSTERS.complex).toContain("architect");
    expect(AGENT_ROSTERS.complex).toContain("security-auditor");
    expect(AGENT_ROSTERS.complex).toContain("external-reviewer");
    expect(AGENT_ROSTERS.complex).toHaveLength(5);
  });

  it("each level is a superset of the previous", () => {
    for (const role of AGENT_ROSTERS.trivial) {
      expect(AGENT_ROSTERS.simple).toContain(role);
    }
    for (const role of AGENT_ROSTERS.simple) {
      expect(AGENT_ROSTERS.moderate).toContain(role);
    }
    for (const role of AGENT_ROSTERS.moderate) {
      expect(AGENT_ROSTERS.complex).toContain(role);
    }
  });
});

// ---------------------------------------------------------------------------
// classifyFeatureHeuristic — trivial features
// ---------------------------------------------------------------------------

describe("classifyFeatureHeuristic — trivial", () => {
  it("classifies empty description as trivial", () => {
    const result = classifyFeatureHeuristic(makeFeature({ description: "" }));
    expect(result.level).toBe("trivial");
  });

  it("classifies very short description with no criteria as trivial", () => {
    const result = classifyFeatureHeuristic(makeFeature({ description: "Fix typo" }));
    expect(result.level).toBe("trivial");
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(3);
  });

  it("classifies description with fix keyword as trivial", () => {
    const result = classifyFeatureHeuristic(makeFeature({ description: "Fix button style typo" }));
    expect(result.level).toBe("trivial");
  });

  it("returns only tdd-developer as agent for trivial features", () => {
    const result = classifyFeatureHeuristic(makeFeature({ description: "Fix typo" }));
    expect(result.agents).toEqual(["tdd-developer"]);
  });

  it("includes reasoning string", () => {
    const result = classifyFeatureHeuristic(makeFeature({ description: "Fix typo" }));
    expect(typeof result.reasoning).toBe("string");
    expect(result.reasoning.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// classifyFeatureHeuristic — simple features
// ---------------------------------------------------------------------------

describe("classifyFeatureHeuristic — simple", () => {
  it("classifies medium description with 2 criteria as simple", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({
        description:
          "Add a button to submit the form and validate the email field before submission",
        acceptanceCriteria: ["Button shows on page", "Email is validated"],
      }),
    );
    expect(result.level).toBe("simple");
    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.score).toBeLessThanOrEqual(5);
  });

  it("returns tdd-developer and qa for simple features", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({
        description:
          "Add a button to submit the form and validate the email field before submission",
        acceptanceCriteria: ["Button shows on page", "Email is validated"],
      }),
    );
    expect(result.agents).toContain("tdd-developer");
    expect(result.agents).toContain("qa");
    expect(result.agents).not.toContain("architect");
    expect(result.agents).not.toContain("security-auditor");
  });
});

// ---------------------------------------------------------------------------
// classifyFeatureHeuristic — moderate features
// ---------------------------------------------------------------------------

describe("classifyFeatureHeuristic — moderate", () => {
  it("classifies longer description with 4+ criteria as moderate", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({
        description:
          "Implement a user profile page with editable fields for name email and address with validation and error messages displayed inline below each field",
        acceptanceCriteria: [
          "Name field is editable",
          "Email field validates format",
          "Address field is optional",
          "Error messages shown inline",
        ],
      }),
    );
    expect(result.level).toBe("moderate");
    expect(result.score).toBeGreaterThanOrEqual(6);
    expect(result.score).toBeLessThanOrEqual(7);
  });

  it("classifies feature with 1 dependency as at least moderate", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({
        description: "Add notification panel",
        acceptanceCriteria: ["Shows notifications"],
        dependencies: ["f-1"],
      }),
    );
    expect(["moderate", "complex"]).toContain(result.level);
  });

  it("includes architect in the moderate agent roster", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({
        description:
          "Implement a user profile page with editable fields for name email and address with validation and error messages displayed inline below each field",
        acceptanceCriteria: [
          "Name field is editable",
          "Email field validates format",
          "Address field is optional",
          "Error messages shown inline",
        ],
      }),
    );
    expect(result.agents).toContain("architect");
    expect(result.agents).not.toContain("security-auditor");
  });
});

// ---------------------------------------------------------------------------
// classifyFeatureHeuristic — complex features
// ---------------------------------------------------------------------------

describe("classifyFeatureHeuristic — complex", () => {
  it("classifies feature with 'auth' keyword as complex", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({ description: "Implement auth system with JWT tokens" }),
    );
    expect(result.level).toBe("complex");
  });

  it("classifies feature with 'security' keyword as complex", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({ description: "Security audit and hardening" }),
    );
    expect(result.level).toBe("complex");
  });

  it("classifies feature with 'migration' keyword as complex", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({ description: "Perform database migration to new schema" }),
    );
    expect(result.level).toBe("complex");
  });

  it("classifies feature with 'refactor' keyword as complex", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({ description: "Large refactor of the payment module" }),
    );
    expect(result.level).toBe("complex");
  });

  it("classifies feature with 3+ dependencies as complex", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({
        description: "Some feature",
        dependencies: ["f-1", "f-2", "f-3"],
      }),
    );
    expect(result.level).toBe("complex");
  });

  it("includes security-auditor and external-reviewer for complex features", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({ description: "Implement auth system with JWT tokens" }),
    );
    expect(result.agents).toContain("security-auditor");
    expect(result.agents).toContain("external-reviewer");
  });

  it("includes all 5 agents for complex features", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({ description: "Implement auth system with JWT tokens" }),
    );
    expect(result.agents).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// classifyFeatureHeuristic — edge cases
// ---------------------------------------------------------------------------

describe("classifyFeatureHeuristic — edge cases", () => {
  it("handles undefined description without throwing", () => {
    const feature = makeFeature();
    // @ts-expect-error testing undefined runtime value
    feature.description = undefined;
    expect(() => classifyFeatureHeuristic(feature)).not.toThrow();
  });

  it("handles undefined acceptanceCriteria without throwing", () => {
    const feature = makeFeature();
    // @ts-expect-error testing undefined runtime value
    feature.acceptanceCriteria = undefined;
    expect(() => classifyFeatureHeuristic(feature)).not.toThrow();
  });

  it("handles undefined dependencies without throwing", () => {
    const feature = makeFeature();
    // @ts-expect-error testing undefined runtime value
    feature.dependencies = undefined;
    expect(() => classifyFeatureHeuristic(feature)).not.toThrow();
  });

  it("score is always between 1 and 10", () => {
    const extremeFeature = makeFeature({
      description: "auth security migration refactor complex critical system overhaul",
      acceptanceCriteria: Array.from({ length: 10 }, (_, i) => `Criterion ${i}`),
      dependencies: Array.from({ length: 5 }, (_, i) => `f-${i}`),
    });
    const result = classifyFeatureHeuristic(extremeFeature);
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it("score is always at least 1 for simple-keyword-only description", () => {
    const result = classifyFeatureHeuristic(
      makeFeature({ description: "fix typo style" }),
    );
    expect(result.score).toBeGreaterThanOrEqual(1);
  });

  it("returns an agents array matching the level roster", () => {
    const result = classifyFeatureHeuristic(makeFeature({ description: "Fix typo" }));
    expect(result.agents).toEqual(AGENT_ROSTERS[result.level]);
  });

  it("reasoning mentions the score", () => {
    const result = classifyFeatureHeuristic(makeFeature({ description: "" }));
    expect(result.reasoning).toContain(String(result.score));
  });
});

// ---------------------------------------------------------------------------
// classifyFeatureComplexity — LLM integration (mocked)
// ---------------------------------------------------------------------------

describe("classifyFeatureComplexity — LLM path", () => {
  it("returns heuristic result when LLM call throws", async () => {
    // Dynamic import to avoid top-level mock issues
    const { classifyFeatureComplexity } = await import("./complexity-classifier.js");

    const failingProvider = {
      id: "mock",
      name: "Mock",
      initialize: vi.fn(),
      chat: vi.fn().mockRejectedValue(new Error("network error")),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn().mockReturnValue(0),
      getContextWindow: vi.fn().mockReturnValue(100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const feature = makeFeature({ description: "Implement auth system with JWT tokens" });
    const result = await classifyFeatureComplexity(feature, failingProvider);

    // Should fall back to heuristic — auth keyword means complex
    expect(result.level).toBe("complex");
    expect(result.agents).toContain("security-auditor");
  });

  it("uses LLM score when response is valid JSON", async () => {
    const { classifyFeatureComplexity } = await import("./complexity-classifier.js");

    const mockProvider = {
      id: "mock",
      name: "Mock",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({ score: 3, reasoning: "LLM says trivial" }),
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 10 },
        model: "mock",
      }),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn().mockReturnValue(0),
      getContextWindow: vi.fn().mockReturnValue(100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const feature = makeFeature({ description: "Fix typo in readme" });
    const result = await classifyFeatureComplexity(feature, mockProvider);

    expect(result.score).toBe(3);
    expect(result.level).toBe("trivial");
    expect(result.reasoning).toContain("LLM says trivial");
  });

  it("falls back to heuristic when LLM returns unparseable response", async () => {
    const { classifyFeatureComplexity } = await import("./complexity-classifier.js");

    const mockProvider = {
      id: "mock",
      name: "Mock",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: "I cannot determine complexity at this time.",
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 10 },
        model: "mock",
      }),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn().mockReturnValue(0),
      getContextWindow: vi.fn().mockReturnValue(100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const feature = makeFeature({ description: "Fix typo" });
    const result = await classifyFeatureComplexity(feature, mockProvider);

    // Falls back to heuristic — "fix typo" is trivial
    expect(result.level).toBe("trivial");
  });

  it("clamps LLM score to [1, 10]", async () => {
    const { classifyFeatureComplexity } = await import("./complexity-classifier.js");

    const mockProvider = {
      id: "mock",
      name: "Mock",
      initialize: vi.fn(),
      chat: vi.fn().mockResolvedValue({
        id: "resp-1",
        content: JSON.stringify({ score: 999, reasoning: "Way too complex" }),
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 10 },
        model: "mock",
      }),
      chatWithTools: vi.fn(),
      stream: vi.fn(),
      streamWithTools: vi.fn(),
      countTokens: vi.fn().mockReturnValue(0),
      getContextWindow: vi.fn().mockReturnValue(100000),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const feature = makeFeature({ description: "Something" });
    const result = await classifyFeatureComplexity(feature, mockProvider);

    expect(result.score).toBe(10);
    expect(result.level).toBe("complex");
  });
});
