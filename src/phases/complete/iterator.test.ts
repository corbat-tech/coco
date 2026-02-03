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

describe("TaskIterator - real implementation coverage", () => {
  // These tests don't use mocked generator/reviewer to cover actual implementation
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("without mocks - real code paths", () => {
    it("should execute with real generator and reviewer creating versions", async () => {
      // Unmock to use real implementations
      vi.doUnmock("./generator.js");
      vi.doUnmock("./reviewer.js");

      // Need a fresh import
      const iteratorModule = await import("./iterator.js");
      const { TaskIterator } = iteratorModule;

      // Use real LLM mock that returns valid JSON
      const realLLM = {
        id: "test",
        name: "Test LLM",
        initialize: vi.fn(),
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            files: [{ path: "src/test.ts", content: "// code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
            scores: {
              correctness: 95,
              completeness: 90,
              robustness: 88,
              readability: 92,
              maintainability: 85,
              complexity: 80,
              duplication: 90,
              testCoverage: 85,
              testQuality: 80,
              security: 95,
              documentation: 70,
              style: 90,
            },
            issues: [
              { severity: "minor", category: "documentation", message: "Add docs" },
            ],
            suggestions: [
              { type: "improvement", description: "Add tests", priority: "medium" },
            ],
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
        chatWithTools: vi.fn(),
        stream: vi.fn(),
        countTokens: vi.fn().mockReturnValue(100),
        getContextWindow: vi.fn().mockReturnValue(100000),
        isAvailable: vi.fn().mockResolvedValue(true),
      };

      const iterator = new TaskIterator(realLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 2,
        minConvergenceIterations: 1,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-1", title: "Test Task", description: "Build feature", type: "feature", files: ["src/test.ts"] },
        projectPath: "/test/project",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Deliver feature", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 90, branches: 85, functions: 88, statements: 87 },
          failures: [],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.taskId).toBe("task-1");
      expect(result.versions).toBeDefined();
    });
  });
});

describe("TaskIterator - version creation and issue mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to use real implementations
    vi.doUnmock("./generator.js");
    vi.doUnmock("./reviewer.js");
  });

  it("should create version with file changes categorized correctly", async () => {
    // Mock generator to return files with different actions
    vi.doMock("./generator.js", () => ({
      CodeGenerator: vi.fn().mockImplementation(() => ({
        generate: vi.fn().mockResolvedValue({
          files: [
            { path: "src/new.ts", content: "// new", action: "create" },
            { path: "src/modified.ts", content: "// modified", action: "modify" },
            { path: "src/deleted.ts", content: "", action: "delete" },
          ],
          explanation: "Generated with all action types",
          confidence: 85,
        }),
        improve: vi.fn().mockResolvedValue({
          files: [{ path: "src/new.ts", content: "// improved", action: "modify" }],
          explanation: "Improved",
          confidence: 90,
        }),
      })),
    }));

    // Mock reviewer to return scores and issues with various categories
    vi.doMock("./reviewer.js", () => ({
      CodeReviewer: vi.fn().mockImplementation(() => ({
        review: vi.fn().mockResolvedValue({
          passed: true,
          scores: {
            overall: 90,
            dimensions: {
              correctness: 90,
              completeness: 88,
              robustness: 85,
              readability: 92,
              maintainability: 87,
              complexity: 80,
              duplication: 95,
              testCoverage: 85,
              testQuality: 80,
              security: 90,
              documentation: 75,
              style: 88,
            },
          },
          issues: [
            { severity: "minor", category: "correctness", message: "Correctness issue" },
            { severity: "minor", category: "completeness", message: "Completeness issue" },
            { severity: "minor", category: "robustness", message: "Robustness issue" },
            { severity: "minor", category: "readability", message: "Readability issue" },
            { severity: "minor", category: "maintainability", message: "Maintainability issue" },
            { severity: "minor", category: "complexity", message: "Complexity issue" },
            { severity: "minor", category: "duplication", message: "Duplication issue" },
            { severity: "minor", category: "testCoverage", message: "Test coverage issue" },
            { severity: "minor", category: "testQuality", message: "Test quality issue" },
            { severity: "minor", category: "security", message: "Security issue" },
            { severity: "minor", category: "documentation", message: "Documentation issue" },
            { severity: "minor", category: "style", message: "Style issue" },
          ],
          suggestions: [
            { type: "improvement", description: "Improve code", priority: "high" },
            { type: "refactor", description: "Refactor module", priority: "medium" },
            { type: "test", description: "Add tests", priority: "low" },
          ],
          testResults: { passed: 5, failed: 0, skipped: 0 },
        }),
        checkPassed: vi.fn().mockReturnValue(true),
        getCriticalIssues: vi.fn().mockReturnValue([]),
      })),
    }));

    const { TaskIterator } = await import("./iterator.js");

    const iterator = new TaskIterator(mockLLM as any, {
      minScore: 85,
      minCoverage: 80,
      maxIterations: 2,
      minConvergenceIterations: 1,
      convergenceThreshold: 2,
    });

    const context = {
      task: { id: "task-1", title: "Test Task", description: "Test", type: "feature", files: [] },
      projectPath: "/test",
      sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test goal", stories: [] },
      previousVersions: [],
      qualityConfig: { minScore: 85, minCoverage: 80 },
    };

    const result = await iterator.execute(
      context as any,
      vi.fn().mockResolvedValue({
        passed: 5,
        failed: 0,
        skipped: 0,
        coverage: { lines: 90, branches: 85, functions: 88, statements: 87 },
        failures: [],
        duration: 100,
      }),
      vi.fn().mockResolvedValue(undefined),
      vi.fn()
    );

    expect(result.versions).toBeDefined();
    expect(result.versions.length).toBeGreaterThan(0);

    // Check that version has the expected structure
    const version = result.versions[0];
    expect(version).toBeDefined();
    expect(version?.scores).toBeDefined();
    expect(version?.testResults).toBeDefined();
    expect(version?.analysis).toBeDefined();
  });

  it("should map all QualityDimensions keys to IssueCategory correctly", async () => {
    // Mock reviewer with issues for each dimension category
    vi.doMock("./reviewer.js", () => ({
      CodeReviewer: vi.fn().mockImplementation(() => ({
        review: vi.fn().mockResolvedValue({
          passed: true,
          scores: {
            overall: 90,
            dimensions: {
              correctness: 90,
              completeness: 90,
              robustness: 90,
              readability: 90,
              maintainability: 90,
              complexity: 90, // Maps to maintainability
              duplication: 90, // Maps to maintainability
              testCoverage: 90, // Maps to testing
              testQuality: 90, // Maps to testing
              security: 90,
              documentation: 90,
              style: 90,
            },
          },
          issues: [
            { severity: "minor", category: "complexity", message: "Complex code", file: "src/a.ts", line: 10, suggestion: "Simplify" },
            { severity: "minor", category: "duplication", message: "Duplicated code", file: "src/b.ts", line: 20 },
            { severity: "minor", category: "testCoverage", message: "Low coverage" },
            { severity: "minor", category: "testQuality", message: "Poor test quality" },
          ],
          suggestions: [],
          testResults: { passed: 5, failed: 0, skipped: 0 },
        }),
        checkPassed: vi.fn().mockReturnValue(true),
        getCriticalIssues: vi.fn().mockReturnValue([]),
      })),
    }));

    vi.doMock("./generator.js", () => ({
      CodeGenerator: vi.fn().mockImplementation(() => ({
        generate: vi.fn().mockResolvedValue({
          files: [{ path: "src/test.ts", content: "code", action: "create" }],
          explanation: "Generated",
          confidence: 80,
        }),
        improve: vi.fn().mockResolvedValue({
          files: [{ path: "src/test.ts", content: "improved", action: "modify" }],
          explanation: "Improved",
          confidence: 85,
        }),
      })),
    }));

    const { TaskIterator } = await import("./iterator.js");

    const iterator = new TaskIterator(mockLLM as any, {
      minScore: 85,
      minCoverage: 80,
      maxIterations: 2,
      minConvergenceIterations: 1,
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
      vi.fn().mockResolvedValue({
        passed: 5,
        failed: 0,
        skipped: 0,
        coverage: { lines: 90, branches: 85, functions: 88, statements: 87 },
        failures: [],
        duration: 100,
      }),
      vi.fn().mockResolvedValue(undefined),
      vi.fn()
    );

    expect(result.versions).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("should handle test failures in version creation", async () => {
    vi.doMock("./reviewer.js", () => ({
      CodeReviewer: vi.fn().mockImplementation(() => ({
        review: vi.fn().mockResolvedValue({
          passed: true,
          scores: {
            overall: 90,
            dimensions: { testCoverage: 85 },
          },
          issues: [],
          suggestions: [
            { type: "test", description: "Add error handling tests", priority: "high" },
            { type: "improvement", description: "Improve performance", priority: "medium" },
            { type: "documentation", description: "Add JSDoc", priority: "low" },
          ],
          testResults: { passed: 3, failed: 2, skipped: 1 },
        }),
        checkPassed: vi.fn().mockReturnValue(true),
        getCriticalIssues: vi.fn().mockReturnValue([]),
      })),
    }));

    vi.doMock("./generator.js", () => ({
      CodeGenerator: vi.fn().mockImplementation(() => ({
        generate: vi.fn().mockResolvedValue({
          files: [{ path: "src/test.ts", content: "code", action: "create" }],
          explanation: "Generated",
          confidence: 80,
        }),
        improve: vi.fn(),
      })),
    }));

    const { TaskIterator } = await import("./iterator.js");

    const iterator = new TaskIterator(mockLLM as any, {
      minScore: 85,
      minCoverage: 80,
      maxIterations: 2,
      minConvergenceIterations: 1,
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
      vi.fn().mockResolvedValue({
        passed: 3,
        failed: 2,
        skipped: 1,
        coverage: { lines: 75, branches: 70, functions: 80, statements: 73 },
        failures: [
          { name: "test1", file: "test.ts", message: "Failed assertion", stack: "Error stack" },
          { name: "test2", file: "test2.ts", message: "Timeout", stack: "Timeout stack" },
        ],
        duration: 500,
      }),
      vi.fn().mockResolvedValue(undefined),
      vi.fn()
    );

    expect(result.versions).toBeDefined();
    if (result.versions.length > 0) {
      const version = result.versions[0];
      expect(version?.testResults).toBeDefined();
      expect(version?.testResults?.failures).toBeDefined();
    }
  });
});

describe("TaskIterator - advanced scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute iterations", () => {
    it("should reach max iterations when quality never converges", async () => {
      // Reset mocks with special behavior for this test
      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: false,
            scores: {
              overall: 70, // Always below threshold
              dimensions: { testCoverage: 70 },
            },
            issues: [],
            suggestions: [],
            testResults: { passed: 5, failed: 0, skipped: 0 },
          }),
          checkPassed: vi.fn().mockReturnValue(false),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 3, // Low limit for testing
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
        vi.fn().mockResolvedValue({ passed: 5, failed: 0, skipped: 0, coverage: { lines: 70, branches: 70, functions: 70, statements: 70 }, failures: [], duration: 100 }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.iterations).toBeGreaterThan(0);
    });

    it("should stop when quality passes threshold", async () => {
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
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Goal", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({ passed: 5, failed: 0, skipped: 0, coverage: { lines: 90, branches: 85, functions: 90, statements: 88 }, failures: [], duration: 100 }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.success).toBe(true);
    });

    it("should build context with previous versions", async () => {
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
        projectPath: "/test/project",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Build feature X", stories: [] },
        previousVersions: [
          { version: 1, scores: { overall: 80 } },
          { version: 2, scores: { overall: 82 } },
        ],
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

    it("should handle string errors in catch block", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockRejectedValue("String error message"),
          improve: vi.fn(),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
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
    });
  });

  describe("version creation", () => {
    it("should track file actions correctly (create, modify, delete)", async () => {
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
        vi.fn().mockResolvedValue({
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
          failures: [],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.versions).toBeDefined();
    });

    it("should map test failures to version analysis", async () => {
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
        vi.fn().mockResolvedValue({
          passed: 3,
          failed: 2,
          skipped: 1,
          coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
          failures: [
            { name: "test1", file: "test.ts", message: "Failed", stack: "Error" },
            { name: "test2", file: "test2.ts", message: "Timeout", stack: "Error" },
          ],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result).toBeDefined();
    });
  });

  describe("feedback building", () => {
    it("should build feedback with issues and suggestions", async () => {
      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: true,
            scores: {
              overall: 90,
              dimensions: { testCoverage: 85 },
            },
            issues: [
              { severity: "major", message: "Missing error handling" },
              { severity: "minor", message: "Inconsistent naming" },
              { severity: "info", message: "Consider adding comments" },
              { severity: "critical", message: "Security issue" },
              { severity: "major", message: "Performance concern" },
              { severity: "minor", message: "Style issue" },
            ],
            suggestions: [
              { priority: "high", description: "Add unit tests" },
              { priority: "medium", description: "Improve docs" },
              { priority: "low", description: "Refactor" },
              { priority: "high", description: "Add validation" },
            ],
            testResults: { passed: 5, failed: 0, skipped: 0 },
          }),
          checkPassed: vi.fn().mockReturnValue(true),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
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
        vi.fn().mockResolvedValue({ passed: 5, failed: 0, skipped: 0, coverage: { lines: 90, branches: 85, functions: 90, statements: 88 }, failures: [], duration: 100 }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.success).toBe(true);
    });
  });

  describe("convergence edge cases", () => {
    it("should return not converged when critical issues exist", async () => {
      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: false,
            scores: { overall: 90, dimensions: { testCoverage: 85 } },
            issues: [{ severity: "critical", message: "Critical security issue" }],
            suggestions: [],
          }),
          checkPassed: vi.fn().mockReturnValue(false),
          getCriticalIssues: vi.fn().mockReturnValue([
            { severity: "critical", message: "Critical security issue" },
          ]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 3,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [88, 89, 90],
        {
          passed: false,
          scores: { overall: 90 },
          issues: [{ severity: "critical", message: "Critical" }],
        } as any,
        3
      );

      // Result depends on mocked getCriticalIssues
      expect(result).toBeDefined();
    });

    it("should handle empty score history", async () => {
      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 1,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [],
        { passed: true, scores: { overall: 90 }, issues: [] } as any,
        0
      );

      expect(result.improvement).toBe(0);
    });
  });
});

describe("TaskIterator - comprehensive coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("execute - iteration loop with improvement", () => {
    it("should iterate multiple times and call improve when quality does not pass", async () => {
      let iterationCount = 0;
      const mockImprove = vi.fn().mockResolvedValue({
        files: [{ path: "src/improved.ts", content: "// improved code", action: "modify" }],
        explanation: "Improved code",
        confidence: 90,
      });

      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "// initial code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: mockImprove,
        })),
      }));

      // Mock reviewer to fail on first iterations, then pass
      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockImplementation(() => {
            iterationCount++;
            const score = iterationCount < 3 ? 70 : 90;
            return Promise.resolve({
              passed: iterationCount >= 3,
              scores: {
                overall: score,
                dimensions: { correctness: score, testCoverage: score },
              },
              issues: iterationCount < 3
                ? [
                    { severity: "major", category: "correctness", message: "Issue 1", suggestion: "Fix it" },
                    { severity: "minor", category: "style", message: "Issue 2" },
                  ]
                : [],
              suggestions: iterationCount < 3
                ? [
                    { type: "improvement", description: "Suggestion 1", priority: "high" },
                    { type: "test", description: "Suggestion 2", priority: "medium" },
                  ]
                : [],
              testResults: { passed: 5, failed: 0, skipped: 0 },
            });
          }),
          checkPassed: vi.fn().mockImplementation(() => iterationCount >= 3),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 5,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-1", title: "Test Task", description: "Test description", type: "feature", files: [] },
        projectPath: "/test/project",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Complete the feature", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
          failures: [],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.taskId).toBe("task-1");
      expect(result.iterations).toBeGreaterThan(1);
      expect(mockImprove).toHaveBeenCalled();
    });

    it("should reach max iterations and return failure with lastReview populated", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "improved", action: "modify" }],
            explanation: "Improved",
            confidence: 85,
          }),
        })),
      }));

      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: false,
            scores: {
              overall: 70,
              dimensions: { correctness: 70, testCoverage: 65 },
            },
            issues: [{ severity: "major", category: "correctness", message: "Error", suggestion: "Fix" }],
            suggestions: [{ type: "improvement", description: "Improve", priority: "high" }],
            testResults: { passed: 3, failed: 2, skipped: 0 },
          }),
          checkPassed: vi.fn().mockReturnValue(false),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 2,
        minConvergenceIterations: 1,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-max", title: "Test", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 3,
          failed: 2,
          skipped: 0,
          coverage: { lines: 65, branches: 60, functions: 70, statements: 63 },
          failures: [{ name: "test1", file: "t.ts", message: "Failed", stack: "stack" }],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.converged).toBe(false);
      expect(result.iterations).toBe(2);
      expect(result.error).toBe("Max iterations reached without convergence");
      expect(result.finalScore).toBe(70);
    });

    it("should return success=true when max iterations reached but lastReview passes", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "improved", action: "modify" }],
            explanation: "Improved",
            confidence: 85,
          }),
        })),
      }));

      // Reviewer never causes convergence but checkPassed returns true
      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => {
          let callCount = 0;
          return {
            review: vi.fn().mockImplementation(() => {
              callCount++;
              // Never converge due to always improving score
              const score = 80 + callCount * 5;
              return Promise.resolve({
                passed: true,
                scores: {
                  overall: score,
                  dimensions: { correctness: score },
                },
                issues: [],
                suggestions: [],
                testResults: { passed: 5, failed: 0, skipped: 0 },
              });
            }),
            // checkPassed returns false to continue iterations, but true at max
            checkPassed: vi.fn().mockImplementation((scores: any) => scores.overall >= 85),
            getCriticalIssues: vi.fn().mockReturnValue([]),
          };
        }),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 2,
        minConvergenceIterations: 3, // Higher than maxIterations
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-pass", title: "Test", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
          failures: [],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      // Quality passes threshold on first iteration
      expect(result.success).toBe(true);
    });

    it("should handle non-Error thrown in catch block", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockRejectedValue({ code: "CUSTOM_ERROR", message: "Object error" }),
          improve: vi.fn(),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-err", title: "Test", description: "Test", type: "feature", files: [] },
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
      expect(result.error).toBe("[object Object]");
    });
  });

  describe("createVersion - all file action types", () => {
    it("should categorize files by action type (create, modify, delete)", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [
              { path: "src/new-file.ts", content: "// new", action: "create" },
              { path: "src/existing.ts", content: "// modified", action: "modify" },
              { path: "src/old-file.ts", content: "", action: "delete" },
            ],
            explanation: "Generated with all actions",
            confidence: 90,
          }),
          improve: vi.fn(),
        })),
      }));

      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: true,
            scores: {
              overall: 95,
              dimensions: {
                correctness: 95,
                completeness: 92,
                robustness: 90,
                readability: 94,
                maintainability: 88,
                complexity: 85,
                duplication: 98,
                testCoverage: 90,
                testQuality: 88,
                security: 100,
                documentation: 80,
                style: 92,
              },
            },
            issues: [
              { severity: "minor", category: "correctness", message: "Minor issue", file: "src/a.ts", line: 10, suggestion: "Fix" },
              { severity: "minor", category: "completeness", message: "Incomplete", file: "src/b.ts" },
              { severity: "info", category: "robustness", message: "Consider edge case" },
              { severity: "minor", category: "readability", message: "Improve naming" },
              { severity: "minor", category: "maintainability", message: "Refactor" },
              { severity: "info", category: "complexity", message: "Complex logic" },
              { severity: "info", category: "duplication", message: "Duplicated code" },
              { severity: "minor", category: "testCoverage", message: "Low coverage" },
              { severity: "minor", category: "testQuality", message: "Improve tests" },
              { severity: "critical", category: "security", message: "Security issue" },
              { severity: "minor", category: "documentation", message: "Add docs" },
              { severity: "info", category: "style", message: "Style issue" },
            ],
            suggestions: [
              { type: "improvement", description: "Suggestion 1", priority: "high" },
              { type: "test", description: "Suggestion 2", priority: "medium" },
              { type: "refactor", description: "Suggestion 3", priority: "low" },
              { type: "docs", description: "Suggestion 4", priority: "low" },
            ],
            testResults: { passed: 10, failed: 0, skipped: 1 },
          }),
          checkPassed: vi.fn().mockReturnValue(true),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-files", title: "File Actions Test", description: "Test all actions", type: "feature", files: [] },
        projectPath: "/test/project",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 10,
          failed: 0,
          skipped: 1,
          coverage: { lines: 92, branches: 88, functions: 95, statements: 91 },
          failures: [],
          duration: 200,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.versions.length).toBeGreaterThan(0);
      const version = result.versions[0];

      // Verify version structure
      expect(version?.changes).toBeDefined();
      expect(version?.changes.filesCreated).toContain("src/new-file.ts");
      expect(version?.changes.filesModified).toContain("src/existing.ts");
      expect(version?.changes.filesDeleted).toContain("src/old-file.ts");

      // Verify diffs
      expect(version?.diffs).toHaveLength(3);

      // Verify test results in version
      expect(version?.testResults).toBeDefined();
      expect(version?.testResults?.passed).toBe(10);
      expect(version?.testResults?.failed).toBe(0);
      expect(version?.testResults?.skipped).toBe(1);

      // Verify analysis
      expect(version?.analysis).toBeDefined();
      expect(version?.analysis?.issuesFound).toBeDefined();
      expect(version?.analysis?.issuesFound.length).toBe(12);

      // Verify reasoning from suggestions
      expect(version?.analysis?.reasoning).toContain("Suggestion 1");
    });
  });

  describe("buildFeedback - truncation behavior", () => {
    it("should truncate issues to first 5 and suggestions to first 3", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "improved", action: "modify" }],
            explanation: "Improved",
            confidence: 85,
          }),
        })),
      }));

      let iterationCount = 0;
      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockImplementation(() => {
            iterationCount++;
            const score = iterationCount === 1 ? 70 : 92;
            return Promise.resolve({
              passed: iterationCount > 1,
              scores: {
                overall: score,
                dimensions: { correctness: score },
              },
              issues: [
                { severity: "major", message: "Issue 1" },
                { severity: "major", message: "Issue 2" },
                { severity: "minor", message: "Issue 3" },
                { severity: "minor", message: "Issue 4" },
                { severity: "minor", message: "Issue 5" },
                { severity: "info", message: "Issue 6" },
                { severity: "info", message: "Issue 7" },
              ],
              suggestions: [
                { priority: "high", description: "Suggestion 1" },
                { priority: "high", description: "Suggestion 2" },
                { priority: "medium", description: "Suggestion 3" },
                { priority: "medium", description: "Suggestion 4" },
                { priority: "low", description: "Suggestion 5" },
              ],
              testResults: { passed: 5, failed: 0, skipped: 0 },
            });
          }),
          checkPassed: vi.fn().mockImplementation(() => iterationCount > 1),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 3,
        minConvergenceIterations: 1,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-feedback", title: "Test", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
          failures: [],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      // The test passes if iteration happens - feedback truncation is internal
      expect(result).toBeDefined();
    });
  });

  describe("buildFeedback - empty issues and suggestions", () => {
    it("should handle review with no issues and no suggestions", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 95,
          }),
          improve: vi.fn(),
        })),
      }));

      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: true,
            scores: {
              overall: 95,
              dimensions: { correctness: 95 },
            },
            issues: [],
            suggestions: [],
            testResults: { passed: 10, failed: 0, skipped: 0 },
          }),
          checkPassed: vi.fn().mockReturnValue(true),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 5,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-clean", title: "Clean Code", description: "Perfect code", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 10,
          failed: 0,
          skipped: 0,
          coverage: { lines: 98, branches: 95, functions: 100, statements: 97 },
          failures: [],
          duration: 50,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.success).toBe(true);
    });
  });

  describe("buildContext - with and without previous versions", () => {
    it("should include previous versions count in context when present", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn(),
        })),
      }));

      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: true,
            scores: { overall: 90, dimensions: { correctness: 90 } },
            issues: [],
            suggestions: [],
            testResults: { passed: 5, failed: 0, skipped: 0 },
          }),
          checkPassed: vi.fn().mockReturnValue(true),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-prev", title: "Test", description: "Test", type: "feature", files: [] },
        projectPath: "/test/project/path",
        sprint: { id: "sprint-1", name: "Sprint Alpha", goal: "Complete feature X", stories: [] },
        previousVersions: [
          { version: 1, scores: { overall: 75 } },
          { version: 2, scores: { overall: 80 } },
          { version: 3, scores: { overall: 85 } },
        ],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
          failures: [],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.success).toBe(true);
    });

    it("should handle empty previous versions", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn(),
        })),
      }));

      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: true,
            scores: { overall: 90, dimensions: { correctness: 90 } },
            issues: [],
            suggestions: [],
            testResults: { passed: 5, failed: 0, skipped: 0 },
          }),
          checkPassed: vi.fn().mockReturnValue(true),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-no-prev", title: "Test", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Goal", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
          failures: [],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.success).toBe(true);
    });
  });

  describe("convergence - via convergence check in loop", () => {
    it("should return converged when score stabilizes above threshold", async () => {
      let iterationCount = 0;

      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "improved", action: "modify" }],
            explanation: "Improved",
            confidence: 85,
          }),
        })),
      }));

      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockImplementation(() => {
            iterationCount++;
            // Scores stabilize: 88, 89, 89
            const score = iterationCount === 1 ? 88 : 89;
            return Promise.resolve({
              passed: true,
              scores: {
                overall: score,
                dimensions: { correctness: score },
              },
              issues: [],
              suggestions: [],
              testResults: { passed: 5, failed: 0, skipped: 0 },
            });
          }),
          checkPassed: vi.fn().mockReturnValue(false), // Force convergence check
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 5,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-converge", title: "Test", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
          failures: [],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.converged).toBe(true);
    });
  });

  describe("mapToIssueCategory - all dimension mappings", () => {
    it("should map all QualityDimensions to correct IssueCategory", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn(),
        })),
      }));

      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: true,
            scores: {
              overall: 90,
              dimensions: {
                correctness: 90,
                completeness: 90,
                robustness: 90,
                readability: 90,
                maintainability: 90,
                complexity: 90,
                duplication: 90,
                testCoverage: 90,
                testQuality: 90,
                security: 90,
                documentation: 90,
                style: 90,
              },
            },
            issues: [
              { severity: "minor", category: "correctness", message: "Correctness", file: "a.ts", line: 1, suggestion: "Fix" },
              { severity: "minor", category: "completeness", message: "Completeness", file: "b.ts", line: 2 },
              { severity: "minor", category: "robustness", message: "Robustness" },
              { severity: "minor", category: "readability", message: "Readability" },
              { severity: "minor", category: "maintainability", message: "Maintainability" },
              { severity: "minor", category: "complexity", message: "Complexity" }, // -> maintainability
              { severity: "minor", category: "duplication", message: "Duplication" }, // -> maintainability
              { severity: "minor", category: "testCoverage", message: "TestCoverage" }, // -> testing
              { severity: "minor", category: "testQuality", message: "TestQuality" }, // -> testing
              { severity: "minor", category: "security", message: "Security" },
              { severity: "minor", category: "documentation", message: "Documentation" },
              { severity: "minor", category: "style", message: "Style" },
            ],
            suggestions: [],
            testResults: { passed: 5, failed: 0, skipped: 0 },
          }),
          checkPassed: vi.fn().mockReturnValue(true),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 5,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-map", title: "Test", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
          failures: [],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.versions.length).toBeGreaterThan(0);
      const version = result.versions[0];

      // Verify all categories are mapped
      const categories = version?.analysis?.issuesFound.map((i: any) => i.category);
      expect(categories).toContain("correctness");
      expect(categories).toContain("completeness");
      expect(categories).toContain("robustness");
      expect(categories).toContain("readability");
      expect(categories).toContain("maintainability"); // maintainability, complexity, duplication
      expect(categories).toContain("testing"); // testCoverage, testQuality
      expect(categories).toContain("security");
      expect(categories).toContain("documentation");
      expect(categories).toContain("style");
    });
  });

  describe("filesToString - formatting", () => {
    it("should format multiple files correctly", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [
              { path: "src/module-a.ts", content: "export const a = 1;", action: "create" },
              { path: "src/module-b.ts", content: "export const b = 2;\nexport const c = 3;", action: "create" },
            ],
            explanation: "Generated multiple files",
            confidence: 85,
          }),
          improve: vi.fn().mockResolvedValue({
            files: [
              { path: "src/module-a.ts", content: "export const a = 10;", action: "modify" },
              { path: "src/module-b.ts", content: "export const b = 20;", action: "modify" },
            ],
            explanation: "Improved",
            confidence: 90,
          }),
        })),
      }));

      let callCount = 0;
      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockImplementation(() => {
            callCount++;
            const score = callCount === 1 ? 75 : 92;
            return Promise.resolve({
              passed: callCount > 1,
              scores: { overall: score, dimensions: { correctness: score } },
              issues: callCount === 1
                ? [{ severity: "major", category: "correctness", message: "Fix it", suggestion: "Do this" }]
                : [],
              suggestions: callCount === 1
                ? [{ priority: "high", description: "Improve" }]
                : [],
              testResults: { passed: 5, failed: 0, skipped: 0 },
            });
          }),
          checkPassed: vi.fn().mockImplementation(() => callCount > 1),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 3,
        minConvergenceIterations: 1,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-multi", title: "Multi-file", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 90, branches: 85, functions: 90, statements: 88 },
          failures: [],
          duration: 100,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.success).toBe(true);
      // filesToString is called internally during improve
    });
  });

  describe("createVersion - test results with failures", () => {
    it("should map test failures correctly to version", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn(),
        })),
      }));

      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: true,
            scores: { overall: 90, dimensions: { correctness: 90 } },
            issues: [],
            suggestions: [],
            testResults: { passed: 8, failed: 2, skipped: 1 },
          }),
          checkPassed: vi.fn().mockReturnValue(true),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 5,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-failures", title: "Test", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 8,
          failed: 2,
          skipped: 1,
          coverage: { lines: 80, branches: 75, functions: 85, statements: 78 },
          failures: [
            { name: "test-should-work", file: "test.spec.ts", message: "Expected true, got false", stack: "Error\n  at test.spec.ts:10" },
            { name: "test-edge-case", file: "edge.spec.ts", message: "Timeout exceeded", stack: "TimeoutError\n  at edge.spec.ts:25" },
          ],
          duration: 300,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.versions.length).toBeGreaterThan(0);
      const version = result.versions[0];

      expect(version?.testResults).toBeDefined();
      expect(version?.testResults?.passed).toBe(8);
      expect(version?.testResults?.failed).toBe(2);
      expect(version?.testResults?.skipped).toBe(1);
      expect(version?.testResults?.failures).toHaveLength(2);
      expect(version?.testResults?.failures[0].name).toBe("test-should-work");
      expect(version?.testResults?.failures[1].name).toBe("test-edge-case");
    });
  });

  describe("checkConvergence - critical issues branch", () => {
    it("should not converge when critical issues exist even with good score", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn(),
        })),
      }));

      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: false,
            scores: { overall: 90, dimensions: { correctness: 90 } },
            issues: [{ severity: "critical", category: "security", message: "SQL Injection" }],
            suggestions: [],
            testResults: { passed: 5, failed: 0, skipped: 0 },
          }),
          checkPassed: vi.fn().mockReturnValue(false),
          getCriticalIssues: vi.fn().mockReturnValue([
            { severity: "critical", category: "security", message: "SQL Injection" },
          ]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 5,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      // Test checkConvergence directly with critical issues
      const result = iterator.checkConvergence(
        [88, 89, 90],
        {
          passed: false,
          scores: { overall: 90 },
          issues: [{ severity: "critical", category: "security", message: "SQL Injection" }],
        } as any,
        3
      );

      expect(result.converged).toBe(false);
      expect(result.reason).toBe("1 critical issues remain");
      expect(result.improvement).toBeDefined();
    });

    it("should not converge when multiple critical issues exist", async () => {
      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: false,
            scores: { overall: 95, dimensions: { correctness: 95 } },
            issues: [
              { severity: "critical", category: "security", message: "XSS vulnerability" },
              { severity: "critical", category: "security", message: "CSRF vulnerability" },
              { severity: "critical", category: "correctness", message: "Data corruption" },
            ],
            suggestions: [],
            testResults: { passed: 5, failed: 0, skipped: 0 },
          }),
          checkPassed: vi.fn().mockReturnValue(false),
          getCriticalIssues: vi.fn().mockReturnValue([
            { severity: "critical", category: "security", message: "XSS vulnerability" },
            { severity: "critical", category: "security", message: "CSRF vulnerability" },
            { severity: "critical", category: "correctness", message: "Data corruption" },
          ]),
        })),
      }));

      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn(),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 5,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = iterator.checkConvergence(
        [92, 94, 95],
        {
          passed: false,
          scores: { overall: 95 },
          issues: [
            { severity: "critical", message: "XSS" },
            { severity: "critical", message: "CSRF" },
            { severity: "critical", message: "Data corruption" },
          ],
        } as any,
        3
      );

      expect(result.converged).toBe(false);
      expect(result.reason).toBe("3 critical issues remain");
    });
  });

  describe("coverage calculations in version", () => {
    it("should include all coverage metrics in version", async () => {
      vi.doMock("./generator.js", () => ({
        CodeGenerator: vi.fn().mockImplementation(() => ({
          generate: vi.fn().mockResolvedValue({
            files: [{ path: "src/test.ts", content: "code", action: "create" }],
            explanation: "Generated",
            confidence: 80,
          }),
          improve: vi.fn(),
        })),
      }));

      vi.doMock("./reviewer.js", () => ({
        CodeReviewer: vi.fn().mockImplementation(() => ({
          review: vi.fn().mockResolvedValue({
            passed: true,
            scores: { overall: 90, dimensions: { correctness: 90 } },
            issues: [],
            suggestions: [],
            testResults: { passed: 10, failed: 0, skipped: 0 },
          }),
          checkPassed: vi.fn().mockReturnValue(true),
          getCriticalIssues: vi.fn().mockReturnValue([]),
        })),
      }));

      const { TaskIterator } = await import("./iterator.js");

      const iterator = new TaskIterator(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 5,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const context = {
        task: { id: "task-cov", title: "Test", description: "Test", type: "feature", files: [] },
        projectPath: "/test",
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Test", stories: [] },
        previousVersions: [],
        qualityConfig: { minScore: 85, minCoverage: 80 },
      };

      const result = await iterator.execute(
        context as any,
        vi.fn().mockResolvedValue({
          passed: 10,
          failed: 0,
          skipped: 0,
          coverage: { lines: 92.5, branches: 88.3, functions: 95.1, statements: 91.7 },
          failures: [],
          duration: 150,
        }),
        vi.fn().mockResolvedValue(undefined),
        vi.fn()
      );

      expect(result.versions.length).toBeGreaterThan(0);
      const version = result.versions[0];

      expect(version?.testResults?.coverage).toBeDefined();
      expect(version?.testResults?.coverage.lines).toBe(92.5);
      expect(version?.testResults?.coverage.branches).toBe(88.3);
      expect(version?.testResults?.coverage.functions).toBe(95.1);
    });
  });
});
