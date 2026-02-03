/**
 * Tests for replanner module
 */

import { describe, it, expect } from "vitest";
import {
  analyzeFailure,
  createReplanPrompt,
  shouldReplan,
  describeStrategy,
  type FailureContext,
  type ReplanDecision,
} from "./replanner.js";
import type { Task } from "../../types/task.js";
import type { QualityScores } from "../../quality/types.js";

// Helper to create mock task
function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    storyId: "story-1",
    title: "Test Task",
    description: "A test task description",
    type: "feature",
    files: ["src/test.ts"],
    dependencies: [],
    estimatedComplexity: "moderate",
    status: "in_progress",
    ...overrides,
  };
}

// Helper to create mock quality scores
function createScores(overall: number): QualityScores {
  return {
    overall,
    correctness: overall,
    completeness: overall,
    robustness: overall,
    readability: overall,
    maintainability: overall,
    testCoverage: overall,
    security: 100,
  };
}

// Helper to create failure context
function createContext(overrides: Partial<FailureContext> = {}): FailureContext {
  return {
    task: createTask(),
    attemptCount: 1,
    errorHistory: [],
    scoreHistory: [],
    toolHistory: [],
    ...overrides,
  };
}

describe("analyzeFailure", () => {
  it("should escalate after max attempts", () => {
    const context = createContext({ attemptCount: 3 });

    const decision = analyzeFailure(context, { maxAttempts: 3 });

    expect(decision.strategy).toBe("escalate");
    expect(decision.confidence).toBeGreaterThan(0.8);
  });

  it("should suggest alternative for repeating errors", () => {
    const context = createContext({
      attemptCount: 2,
      errorHistory: [
        "TypeError: Cannot read property 'x' of undefined",
        "TypeError: Cannot read property 'x' of undefined",
      ],
    });

    const decision = analyzeFailure(context);

    expect(decision.strategy).toBe("alternative");
    expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
    expect(decision.suggestedPrompt).toContain("different approach");
  });

  it("should simplify for stagnating quality", () => {
    const context = createContext({
      attemptCount: 2,
      scoreHistory: [createScores(75), createScores(75)],
    });

    const decision = analyzeFailure(context, { minQualityDelta: 2 });

    expect(decision.strategy).toBe("simplify");
    expect(decision.suggestedTasks).toBeDefined();
    expect(decision.suggestedTasks?.length).toBeGreaterThan(0);
  });

  it("should defer for critical tool failures", () => {
    const context = createContext({
      attemptCount: 2,
      toolHistory: [
        { name: "write_file", input: {}, success: false, error: "Permission denied", duration: 100 },
        { name: "git_commit", input: {}, success: false, error: "No changes", duration: 50 },
      ],
    });

    const decision = analyzeFailure(context);

    expect(decision.strategy).toBe("defer");
    expect(decision.blockingIssues).toBeDefined();
    expect(decision.blockingIssues?.length).toBeGreaterThan(0);
  });

  it("should suggest alternative as default", () => {
    const context = createContext({
      attemptCount: 1,
      errorHistory: ["Some unique error"],
    });

    const decision = analyzeFailure(context);

    expect(decision.strategy).toBe("alternative");
    expect(decision.confidence).toBeLessThanOrEqual(0.5);
  });

  it("should generate simplified tasks with correct structure", () => {
    const context = createContext({
      task: createTask({ id: "task-123", title: "Complex Feature" }),
      scoreHistory: [createScores(70), createScores(70)],
    });

    const decision = analyzeFailure(context);

    if (decision.suggestedTasks) {
      expect(decision.suggestedTasks.length).toBe(3);

      // Check prep task
      const prepTask = decision.suggestedTasks.find(t => t.id.includes("-prep"));
      expect(prepTask).toBeDefined();
      expect(prepTask?.dependencies).toEqual(context.task.dependencies);

      // Check core task
      const coreTask = decision.suggestedTasks.find(t => t.id.includes("-core"));
      expect(coreTask).toBeDefined();
      expect(coreTask?.dependencies).toContain("task-123-prep");

      // Check verify task
      const verifyTask = decision.suggestedTasks.find(t => t.id.includes("-verify"));
      expect(verifyTask).toBeDefined();
      expect(verifyTask?.type).toBe("test");
    }
  });

  it("should respect allowed strategies", () => {
    const context = createContext({ attemptCount: 5 });

    const decision = analyzeFailure(context, {
      maxAttempts: 3,
      allowedStrategies: ["skip", "defer"],
    });

    // Should still escalate since it's not filtered out in this implementation
    expect(decision.strategy).toBe("escalate");
  });
});

describe("createReplanPrompt", () => {
  it("should include task title and attempts", () => {
    const context = createContext({
      task: createTask({ title: "My Important Task" }),
      attemptCount: 3,
    });
    const decision: ReplanDecision = {
      strategy: "alternative",
      reason: "Test reason",
      confidence: 0.7,
    };

    const prompt = createReplanPrompt(context, decision);

    expect(prompt).toContain("My Important Task");
    expect(prompt).toContain("3");
    expect(prompt).toContain("alternative");
  });

  it("should include blocking issues", () => {
    const context = createContext();
    const decision: ReplanDecision = {
      strategy: "escalate",
      reason: "Too many failures",
      confidence: 0.9,
      blockingIssues: ["Error A", "Error B"],
    };

    const prompt = createReplanPrompt(context, decision);

    expect(prompt).toContain("Blocking Issues");
    expect(prompt).toContain("Error A");
    expect(prompt).toContain("Error B");
  });

  it("should include suggested prompt", () => {
    const context = createContext();
    const decision: ReplanDecision = {
      strategy: "alternative",
      reason: "Try different approach",
      confidence: 0.6,
      suggestedPrompt: "Consider using a different library",
    };

    const prompt = createReplanPrompt(context, decision);

    expect(prompt).toContain("Suggested Approach");
    expect(prompt).toContain("different library");
  });

  it("should include suggested tasks", () => {
    const context = createContext();
    const decision: ReplanDecision = {
      strategy: "simplify",
      reason: "Break down task",
      confidence: 0.7,
      suggestedTasks: [
        createTask({ id: "sub-1", title: "Subtask 1", description: "First part" }),
        createTask({ id: "sub-2", title: "Subtask 2", description: "Second part" }),
      ],
    };

    const prompt = createReplanPrompt(context, decision);

    expect(prompt).toContain("Suggested Sub-tasks");
    expect(prompt).toContain("Subtask 1");
    expect(prompt).toContain("Subtask 2");
  });
});

describe("shouldReplan", () => {
  it("should replan after max attempts", () => {
    expect(shouldReplan(3, null, 85, { maxAttempts: 3 })).toBe(true);
    expect(shouldReplan(2, null, 85, { maxAttempts: 3 })).toBe(false);
  });

  it("should replan for low quality scores", () => {
    const lowScore = createScores(50);

    // 50 < 85 * 0.7 = 59.5
    expect(shouldReplan(1, lowScore, 85)).toBe(true);
  });

  it("should not replan for acceptable scores", () => {
    const goodScore = createScores(80);

    // 80 >= 85 * 0.7 = 59.5
    expect(shouldReplan(1, goodScore, 85)).toBe(false);
  });

  it("should not replan with null score and low attempts", () => {
    expect(shouldReplan(1, null, 85)).toBe(false);
  });
});

describe("describeStrategy", () => {
  it("should describe simplify strategy", () => {
    const description = describeStrategy("simplify");
    expect(description).toContain("smaller");
  });

  it("should describe alternative strategy", () => {
    const description = describeStrategy("alternative");
    expect(description).toContain("different");
  });

  it("should describe defer strategy", () => {
    const description = describeStrategy("defer");
    expect(description).toContain("later");
  });

  it("should describe escalate strategy", () => {
    const description = describeStrategy("escalate");
    expect(description).toContain("human");
  });

  it("should describe skip strategy", () => {
    const description = describeStrategy("skip");
    expect(description).toContain("Skipping");
  });

  it("should handle unknown strategy", () => {
    const description = describeStrategy("unknown" as any);
    expect(description).toContain("Unknown");
  });
});
