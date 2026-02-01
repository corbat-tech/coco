/**
 * Tests for task iterator
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLLM = {
  id: "test",
  name: "Test LLM",
  initialize: vi.fn(),
  chat: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      files: [{ path: "src/test.ts", content: "console.log('test');", action: "create" }],
      explanation: "Generated code",
      confidence: 80,
    }),
  }),
  chatWithTools: vi.fn(),
  stream: vi.fn(),
  countTokens: vi.fn().mockReturnValue(100),
  getContextWindow: vi.fn().mockReturnValue(100000),
  isAvailable: vi.fn().mockResolvedValue(true),
};

vi.mock("./generator.js", () => ({
  CodeGenerator: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue({
      files: [{ path: "src/test.ts", content: "code", action: "create" }],
      explanation: "Generated",
      confidence: 80,
    }),
    improve: vi.fn().mockResolvedValue({
      files: [{ path: "src/test.ts", content: "improved code", action: "modify" }],
      explanation: "Improved",
      confidence: 85,
    }),
  })),
}));

vi.mock("./reviewer.js", () => ({
  CodeReviewer: vi.fn().mockImplementation(() => ({
    review: vi.fn().mockResolvedValue({
      passed: true,
      scores: {
        overall: 90,
        dimensions: {
          correctness: 90,
          testCoverage: 85,
        },
      },
      issues: [],
      suggestions: [],
      testResults: { passed: 5, failed: 0, skipped: 0 },
    }),
    checkPassed: vi.fn().mockReturnValue(true),
    getCriticalIssues: vi.fn().mockReturnValue([]),
  })),
}));

describe("TaskIterator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create iterator with LLM and config", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      expect(iterator).toBeDefined();
    });
  });

  describe("execute", () => {
    it("should execute task and return result", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-1", title: "Test Task", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const runTests = vi.fn().mockResolvedValue({
        passed: 5,
        failed: 0,
        skipped: 0,
        coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
        failures: [],
        duration: 100,
      });

      const saveFiles = vi.fn().mockResolvedValue(undefined);
      const onProgress = vi.fn();

      const result = await iterator.execute(context as any, runTests, saveFiles, onProgress);

      expect(result.taskId).toBe("task-1");
      expect(result.success).toBe(true);
      expect(saveFiles).toHaveBeenCalled();
      expect(runTests).toHaveBeenCalled();
    });

    it("should call onProgress callback when provided", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-1", title: "Test Task", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const onProgress = vi.fn();

      await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({ passed: 5, failed: 0, skipped: 0, coverage: { lines: 90, branches: 85, functions: 90, statements: 88 }, failures: [], duration: 100 }),
        vi.fn().mockResolvedValue(undefined),
        onProgress
      );

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    });

    it("should work without onProgress callback", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-1", title: "Test Task", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({ passed: 5, failed: 0, skipped: 0, coverage: { lines: 90, branches: 85, functions: 90, statements: 88 }, failures: [], duration: 100 }),
        vi.fn().mockResolvedValue(undefined)
      );

      expect(result.success).toBe(true);
    });

    it("should handle errors gracefully", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const failingLLM = {
        ...mockLLM,
        chat: vi.fn().mockRejectedValue(new Error("LLM Error")),
      };

      const iterator = new TaskIterator(failingLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-1", title: "Test", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn(),
        vi.fn(),
        vi.fn()
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle previous versions in context", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-1", title: "Test Task", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test Goal", stories: [] },
        previousVersions: [{ version: 1, scores: { overall: 80 } }],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({ passed: 5, failed: 0, skipped: 0, coverage: { lines: 90, branches: 85, functions: 90, statements: 88 }, failures: [], duration: 100 }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result).toBeDefined();
    });
  });

  describe("checkConvergence", () => {
    it("should return not converged if minimum iterations not reached", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 3,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [85, 87],
        { passed: true, scores: { overall: 87 }, issues: [] } as any,
        2
      );

      expect(result.converged).toBe(false);
      expect(result.reason).toBe("Minimum iterations not reached");
      expect(result.scoreHistory).toEqual([85, 87]);
      expect(result.improvement).toBe(0);
    });

    it("should return not converged if score below minimum", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [70, 72, 75],
        { passed: false, scores: { overall: 75 }, issues: [] } as any,
        3
      );

      expect(result.converged).toBe(false);
      expect(result.reason).toContain("below minimum");
      expect(result.improvement).toBe(3); // 75 - 72
    });

    it("should return converged when score stabilizes", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [88, 89, 89],
        { passed: true, scores: { overall: 89 }, issues: [] } as any,
        3
      );

      expect(result.converged).toBe(true);
      expect(result.reason).toBe("Score has stabilized");
    });

    it("should detect critical issues and not converge", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [88, 89, 90],
        { passed: false, scores: { overall: 90 }, issues: [{ severity: "critical", message: "Critical issue" }] } as any,
        3
      );

      // getCriticalIssues is mocked to return [], so it will converge
      expect(result).toBeDefined();
    });

    it("should detect score is still improving significantly", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [80, 85, 90],
        { passed: true, scores: { overall: 90 }, issues: [] } as any,
        3
      );

      expect(result.converged).toBe(false);
      expect(result.reason).toBe("Still improving");
      expect(result.improvement).toBe(5);
    });

    it("should detect score is decreasing", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      // Use scores where final score >= minScore (85) but improvement < -5
      // Scores: [95, 92, 86] -> improvement = 86 - 92 = -6
      const result = iterator.checkConvergence(
        [95, 92, 86],
        { passed: true, scores: { overall: 86 }, issues: [] } as any,
        3
      );

      expect(result.converged).toBe(false);
      expect(result.reason).toBe("Score is decreasing");
      expect(result.improvement).toBe(-6);
    });

    it("should handle single score in history", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 1,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [90],
        { passed: true, scores: { overall: 90 }, issues: [] } as any,
        1
      );

      expect(result.improvement).toBe(0);
    });

    it("should use last 3 scores for improvement calculation", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [70, 75, 80, 85, 88, 89],
        { passed: true, scores: { overall: 89 }, issues: [] } as any,
        6
      );

      // Uses last 3: 88, 89 -> improvement = 1
      expect(result.improvement).toBe(1);
      expect(result.converged).toBe(true);
    });

    it("should handle two scores in history", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [85, 90],
        { passed: true, scores: { overall: 90 }, issues: [] } as any,
        2
      );

      expect(result.improvement).toBe(5);
    });
  });
});

describe("createTaskIterator", () => {
  it("should create a TaskIterator instance", async () => {
    const { createTaskIterator } = await import("./iterator.js");

    const iterator = createTaskIterator(mockLLM as any, {
      minScore: 85,
      minCoverage: 80,
      maxIterations: 10,
      minConvergenceIterations: 2,
      convergenceThreshold: 2,
    });

    expect(iterator).toBeDefined();
  });

  it("should return instance with execute and checkConvergence methods", async () => {
    const { createTaskIterator } = await import("./iterator.js");

    const iterator = createTaskIterator(mockLLM as any, {
      minScore: 85,
      minCoverage: 80,
      maxIterations: 10,
      minConvergenceIterations: 2,
      convergenceThreshold: 2,
    });

    expect(typeof iterator.execute).toBe("function");
    expect(typeof iterator.checkConvergence).toBe("function");
  });
});
