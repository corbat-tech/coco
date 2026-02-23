/**
 * Tests for the auto-swarm modifications to lifecycle.ts
 *
 * Focuses on:
 * 1. synthesizeLocalReviews — pure function, no LLM, handles optional reviews
 * 2. SwarmLifecycleOptions — verifies new fields are accepted at compile time
 * 3. processFeature roster selection — trivial vs complex complexity via mocked deps
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock handles
// ---------------------------------------------------------------------------

const { mockClassify, mockChatFn } = vi.hoisted(() => ({
  mockClassify: vi.fn(),
  mockChatFn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./complexity-classifier.js", () => ({
  classifyFeatureComplexity: mockClassify,
  AGENT_ROSTERS: {
    trivial: ["tdd-developer"],
    simple: ["tdd-developer", "qa"],
    moderate: ["tdd-developer", "qa", "architect"],
    complex: ["tdd-developer", "qa", "architect", "security-auditor", "external-reviewer"],
  },
}));

vi.mock("./task-board.js", () => ({
  createBoard: vi.fn().mockResolvedValue(undefined),
  loadBoard: vi.fn().mockResolvedValue({
    tasks: [
      { id: "task-f-1-acceptance-test", status: "pending", assignedTo: null },
      { id: "task-f-1-implement", status: "pending", assignedTo: null },
      { id: "task-integrate", status: "pending", assignedTo: null },
    ],
    stats: { total: 3, done: 0, failed: 0, pending: 3, in_progress: 0 },
  }),
  saveBoard: vi.fn().mockResolvedValue(undefined),
  markTaskInProgress: vi.fn().mockImplementation((board: unknown) => board),
  markTaskDone: vi.fn().mockImplementation((board: unknown) => board),
  markTaskFailed: vi.fn().mockImplementation((board: unknown) => board),
}));

vi.mock("./clarifier.js", () => ({
  clarify: vi.fn().mockResolvedValue({
    questions: [],
    assumptions: [],
    assumptionsFile: "/tmp/assumptions.md",
  }),
}));

vi.mock("./events.js", () => ({
  appendSwarmEvent: vi.fn().mockResolvedValue(undefined),
  createEventId: vi.fn().mockReturnValue("evt-test"),
}));

vi.mock("./knowledge.js", () => ({
  appendKnowledge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./agents/prompts.js", () => ({
  AGENT_DEFINITIONS: {
    pm: { systemPrompt: "PM_PROMPT" },
    architect: { systemPrompt: "ARCHITECT_PROMPT" },
    "best-practices": { systemPrompt: "BP_PROMPT" },
    "tdd-developer": { systemPrompt: "TDD_PROMPT" },
    qa: { systemPrompt: "QA_PROMPT" },
    "external-reviewer": { systemPrompt: "REVIEWER_PROMPT" },
    "security-auditor": { systemPrompt: "SECURITY_PROMPT" },
    integrator: { systemPrompt: "INTEGRATOR_PROMPT" },
  },
}));

vi.mock("node:fs/promises", () => {
  const mockFs = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue("{}"),
  };
  return { ...mockFs, default: mockFs };
});

import { synthesizeLocalReviews } from "./lifecycle.js";
import type { ReviewResult, SwarmLifecycleOptions } from "./lifecycle.js";
import type { SwarmSpec } from "./spec-parser.js";
import type { LLMProvider } from "../providers/types.js";
import { DEFAULT_AGENT_CONFIG } from "./agents/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    score: overrides.score ?? 90,
    issues: overrides.issues ?? [],
    summary: overrides.summary ?? "Looks good",
  };
}

// ---------------------------------------------------------------------------
// synthesizeLocalReviews
// ---------------------------------------------------------------------------

describe("synthesizeLocalReviews", () => {
  it("computes the average score of all three reviews", () => {
    const result = synthesizeLocalReviews({
      arch: makeReview({ score: 90 }),
      security: makeReview({ score: 80 }),
      qa: makeReview({ score: 85 }),
    });
    expect(result.score).toBe(85);
  });

  it("returns APPROVE when average score >= 85", () => {
    const result = synthesizeLocalReviews({
      arch: makeReview({ score: 90 }),
      security: makeReview({ score: 90 }),
      qa: makeReview({ score: 90 }),
    });
    expect(result.verdict).toBe("APPROVE");
  });

  it("returns REQUEST_CHANGES when average score < 85", () => {
    const result = synthesizeLocalReviews({
      arch: makeReview({ score: 70 }),
      security: makeReview({ score: 70 }),
      qa: makeReview({ score: 70 }),
    });
    expect(result.verdict).toBe("REQUEST_CHANGES");
  });

  it("handles undefined arch review gracefully", () => {
    const result = synthesizeLocalReviews({
      arch: undefined,
      security: makeReview({ score: 90 }),
      qa: makeReview({ score: 80 }),
    });
    expect(result.score).toBe(85);
    expect(result.verdict).toBe("APPROVE");
  });

  it("handles undefined security review gracefully", () => {
    const result = synthesizeLocalReviews({
      arch: makeReview({ score: 90 }),
      security: undefined,
      qa: makeReview({ score: 80 }),
    });
    expect(result.score).toBe(85);
  });

  it("handles undefined qa review gracefully", () => {
    const result = synthesizeLocalReviews({
      arch: makeReview({ score: 90 }),
      qa: undefined,
    });
    expect(result.score).toBe(90);
    expect(result.verdict).toBe("APPROVE");
  });

  it("handles all reviews undefined — defaults to score 85", () => {
    const result = synthesizeLocalReviews({});
    expect(result.score).toBe(85);
    expect(result.verdict).toBe("APPROVE");
    expect(result.blockers).toEqual([]);
  });

  it("includes review count in summary", () => {
    const result = synthesizeLocalReviews({
      arch: makeReview({ score: 90 }),
      qa: makeReview({ score: 90 }),
    });
    expect(result.summary).toContain("2 reviews");
  });

  it("uses singular 'review' when only one review is present", () => {
    const result = synthesizeLocalReviews({
      arch: makeReview({ score: 90 }),
    });
    expect(result.summary).toContain("1 review");
    expect(result.summary).not.toContain("reviews");
  });

  it("does not crash when called with empty object", () => {
    expect(() => synthesizeLocalReviews({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SwarmLifecycleOptions — compile-time check for new optional fields
// ---------------------------------------------------------------------------

describe("SwarmLifecycleOptions new fields", () => {
  it("accepts skipComplexityCheck: true", () => {
    const opts: Partial<SwarmLifecycleOptions> = {
      skipComplexityCheck: true,
    };
    expect(opts.skipComplexityCheck).toBe(true);
  });

  it("accepts skipComplexityCheck: false", () => {
    const opts: Partial<SwarmLifecycleOptions> = {
      skipComplexityCheck: false,
    };
    expect(opts.skipComplexityCheck).toBe(false);
  });

  it("accepts complexityThreshold: trivial", () => {
    const opts: Partial<SwarmLifecycleOptions> = {
      complexityThreshold: "trivial",
    };
    expect(opts.complexityThreshold).toBe("trivial");
  });

  it("accepts complexityThreshold: complex", () => {
    const opts: Partial<SwarmLifecycleOptions> = {
      complexityThreshold: "complex",
    };
    expect(opts.complexityThreshold).toBe("complex");
  });

  it("both fields are optional (undefined by default)", () => {
    const opts: Partial<SwarmLifecycleOptions> = {};
    expect(opts.skipComplexityCheck).toBeUndefined();
    expect(opts.complexityThreshold).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Roster selection — trivial vs complex (via mocked classifyFeatureComplexity)
// ---------------------------------------------------------------------------

describe("processFeature roster selection", () => {
  let systemPromptsUsed: string[];

  const mockProvider: LLMProvider = {
    id: "mock",
    name: "Mock",
    initialize: vi.fn(),
    chat: mockChatFn,
    chatWithTools: vi.fn(),
    stream: vi.fn() as unknown as LLMProvider["stream"],
    streamWithTools: vi.fn() as unknown as LLMProvider["streamWithTools"],
    countTokens: vi.fn().mockReturnValue(0),
    getContextWindow: vi.fn().mockReturnValue(100000),
    isAvailable: vi.fn().mockResolvedValue(true),
  };

  const makeSpec = (features: SwarmSpec["features"] = []): SwarmSpec => ({
    projectName: "test-project",
    description: "Test project",
    techStack: { language: "typescript" },
    features,
    qualityConfig: { minScore: 85, maxIterations: 3, minCoverage: 80 },
    rawContent: "",
  });

  beforeEach(() => {
    systemPromptsUsed = [];
    mockChatFn.mockImplementation(
      (_messages: unknown, opts?: { system?: string; maxTokens?: number }) => {
        if (opts?.system) systemPromptsUsed.push(opts.system);
        return Promise.resolve({
          id: "resp-1",
          content: JSON.stringify({
            summary: "done",
            testsWritten: 2,
            testsFailing: true,
            allTestsPassing: true,
            coverage: 90,
            testSummary: "all passing",
            score: 90,
            issues: [],
            verdict: "APPROVE",
            blockers: [],
            epics: [],
            components: [],
            conventions: [],
            integrationPassed: true,
            conflicts: [],
          }),
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 10 },
          model: "mock",
        });
      },
    );
  });

  it("with trivial roster, does NOT call architect agent", async () => {
    mockClassify.mockResolvedValue({
      score: 1,
      level: "trivial",
      agents: ["tdd-developer"],
      reasoning: "trivial heuristic",
    });

    const { runSwarmLifecycle } = await import("./lifecycle.js");

    await runSwarmLifecycle({
      spec: makeSpec([
        {
          id: "f-1",
          name: "Fix typo",
          description: "Fix typo in readme",
          acceptanceCriteria: [],
          dependencies: [],
          priority: "low",
        },
      ]),
      projectPath: "/tmp/test-project",
      outputPath: "/tmp/test-project/output",
      provider: mockProvider,
      agentConfig: DEFAULT_AGENT_CONFIG,
      minScore: 85,
      maxIterations: 1,
      noQuestions: true,
    });

    // Architect is called in the planning phase (always), but NOT for per-feature review
    // Security, QA, and external-reviewer are only called in the review phase
    expect(systemPromptsUsed).not.toContain("SECURITY_PROMPT");
    expect(systemPromptsUsed).not.toContain("QA_PROMPT");
    expect(systemPromptsUsed).not.toContain("REVIEWER_PROMPT");
    // The architect review prompt count should be exactly 1 (planning only, not review)
    const archCalls = systemPromptsUsed.filter((p) => p === "ARCHITECT_PROMPT").length;
    expect(archCalls).toBe(1); // planning only
  });

  it("with complex roster, calls architect, security, and qa agents", async () => {
    mockClassify.mockResolvedValue({
      score: 9,
      level: "complex",
      agents: ["tdd-developer", "qa", "architect", "security-auditor", "external-reviewer"],
      reasoning: "complex heuristic",
    });

    const { runSwarmLifecycle } = await import("./lifecycle.js");

    await runSwarmLifecycle({
      spec: makeSpec([
        {
          id: "f-1",
          name: "Auth system",
          description: "Implement auth system",
          acceptanceCriteria: ["Login works", "Logout works"],
          dependencies: [],
          priority: "high",
        },
      ]),
      projectPath: "/tmp/test-project",
      outputPath: "/tmp/test-project/output",
      provider: mockProvider,
      agentConfig: DEFAULT_AGENT_CONFIG,
      minScore: 85,
      maxIterations: 1,
      noQuestions: true,
    });

    expect(systemPromptsUsed).toContain("ARCHITECT_PROMPT");
    expect(systemPromptsUsed).toContain("SECURITY_PROMPT");
    expect(systemPromptsUsed).toContain("QA_PROMPT");
    expect(systemPromptsUsed).toContain("REVIEWER_PROMPT");
  });

  it("with skipComplexityCheck: true, runs the full complex roster", async () => {
    // Should NOT call classifyFeatureComplexity at all
    mockClassify.mockClear();

    const { runSwarmLifecycle } = await import("./lifecycle.js");

    await runSwarmLifecycle({
      spec: makeSpec([
        {
          id: "f-1",
          name: "Some feature",
          description: "Some description",
          acceptanceCriteria: [],
          dependencies: [],
          priority: "medium",
        },
      ]),
      projectPath: "/tmp/test-project",
      outputPath: "/tmp/test-project/output",
      provider: mockProvider,
      agentConfig: DEFAULT_AGENT_CONFIG,
      minScore: 85,
      maxIterations: 1,
      noQuestions: true,
      skipComplexityCheck: true,
    });

    // classifyFeatureComplexity should NOT have been called
    expect(mockClassify).not.toHaveBeenCalled();
    // But all review agents should have run
    expect(systemPromptsUsed).toContain("ARCHITECT_PROMPT");
    expect(systemPromptsUsed).toContain("SECURITY_PROMPT");
    expect(systemPromptsUsed).toContain("QA_PROMPT");
    expect(systemPromptsUsed).toContain("REVIEWER_PROMPT");
  });
});
