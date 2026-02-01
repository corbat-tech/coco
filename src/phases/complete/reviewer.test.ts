/**
 * Tests for code reviewer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../providers/index.js", () => ({
  createProvider: vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        passed: true,
        scores: {
          correctness: 90,
          completeness: 85,
          robustness: 88,
          readability: 92,
          maintainability: 87,
          complexity: 85,
          duplication: 95,
          testCoverage: 80,
          testQuality: 82,
          security: 90,
          documentation: 75,
          style: 88,
        },
        issues: [
          { severity: "minor", category: "documentation", message: "Missing JSDoc", file: "src/user.ts", line: 5 },
        ],
        suggestions: [
          { type: "improvement", description: "Add more tests", priority: "medium", impact: 5 },
        ],
      }),
    }),
  }),
}));

describe("CodeReviewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("review", () => {
    it("should review code and return scores", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            passed: true,
            scores: {
              correctness: 90,
              completeness: 90,
              robustness: 90,
              readability: 90,
              maintainability: 90,
              complexity: 90,
              duplication: 90,
              testCoverage: 85,
              testQuality: 90,
              security: 90,
              documentation: 90,
              style: 90,
            },
            issues: [],
            suggestions: [],
          }),
        }),
      };

      const reviewer = new CodeReviewer(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = await reviewer.review(
        "Create User Model",
        "Create a User model",
        [{ path: "src/user.ts", content: "export class User {}" }],
        { passed: 5, failed: 0, skipped: 0, coverage: { lines: 85, branches: 80, functions: 90, statements: 85 }, failures: [], duration: 100 }
      );

      expect(result.passed).toBe(true);
      expect(result.scores.overall).toBeGreaterThan(0);
      expect(result.scores.dimensions).toBeDefined();
    });

    it("should override test coverage with actual results", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: { testCoverage: 50 },
            issues: [],
            suggestions: [],
          }),
        }),
      };

      const reviewer = new CodeReviewer(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = await reviewer.review(
        "Task",
        "Description",
        [{ path: "src/test.ts", content: "code" }],
        { passed: 5, failed: 0, skipped: 0, coverage: { lines: 95, branches: 90, functions: 88, statements: 92 }, failures: [], duration: 100 }
      );

      // Actual coverage should override LLM estimate
      expect(result.scores.dimensions.testCoverage).toBe(95);
    });

    it("should handle parsing errors with default review", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: "Not valid JSON",
        }),
      };

      const reviewer = new CodeReviewer(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const result = await reviewer.review(
        "Task",
        "Description",
        [{ path: "src/test.ts", content: "code" }],
        { passed: 0, failed: 1, skipped: 0, coverage: { lines: 0, branches: 0, functions: 0, statements: 0 }, failures: [], duration: 100 }
      );

      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe("analyzeFailures", () => {
    it("should analyze test failures", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            analyses: [
              {
                testName: "should validate email",
                rootCause: "Missing email validation logic",
                suggestedFix: "Add regex validation",
                confidence: 85,
              },
            ],
          }),
        }),
      };

      const reviewer = new CodeReviewer(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const analyses = await reviewer.analyzeFailures(
        [{ name: "should validate email", message: "Expected true, got false" }],
        "export class User {}"
      );

      expect(analyses.length).toBeGreaterThan(0);
      expect(analyses[0]?.rootCause).toBeDefined();
      expect(analyses[0]?.suggestedFix).toBeDefined();
    });

    it("should return empty array on parse error", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: "Not JSON",
        }),
      };

      const reviewer = new CodeReviewer(mockLLM as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const analyses = await reviewer.analyzeFailures(
        [{ name: "test", message: "failed" }],
        "code"
      );

      expect(analyses).toEqual([]);
    });
  });

  describe("checkPassed", () => {
    it("should return true when scores meet thresholds", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const reviewer = new CodeReviewer({} as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const passed = reviewer.checkPassed({
        overall: 90,
        dimensions: { testCoverage: 85 },
      } as any);

      expect(passed).toBe(true);
    });

    it("should return false when overall score is too low", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const reviewer = new CodeReviewer({} as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const passed = reviewer.checkPassed({
        overall: 75,
        dimensions: { testCoverage: 90 },
      } as any);

      expect(passed).toBe(false);
    });

    it("should return false when coverage is too low", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const reviewer = new CodeReviewer({} as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const passed = reviewer.checkPassed({
        overall: 90,
        dimensions: { testCoverage: 50 },
      } as any);

      expect(passed).toBe(false);
    });
  });

  describe("getCriticalIssues", () => {
    it("should filter critical issues", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const reviewer = new CodeReviewer({} as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const issues = [
        { severity: "critical", message: "Security vulnerability" },
        { severity: "major", message: "Missing tests" },
        { severity: "critical", message: "Memory leak" },
        { severity: "minor", message: "Style issue" },
      ];

      const critical = reviewer.getCriticalIssues(issues as any);

      expect(critical.length).toBe(2);
      expect(critical.every((i: any) => i.severity === "critical")).toBe(true);
    });
  });

  describe("getHighPrioritySuggestions", () => {
    it("should filter high priority suggestions", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const reviewer = new CodeReviewer({} as any, {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      });

      const suggestions = [
        { priority: "high", description: "Add error handling" },
        { priority: "medium", description: "Improve docs" },
        { priority: "high", description: "Add tests" },
        { priority: "low", description: "Rename variable" },
      ];

      const high = reviewer.getHighPrioritySuggestions(suggestions as any);

      expect(high.length).toBe(2);
      expect(high.every((s: any) => s.priority === "high")).toBe(true);
    });
  });
});

describe("createCodeReviewer", () => {
  it("should create a CodeReviewer instance", async () => {
    const { createCodeReviewer } = await import("./reviewer.js");

    const reviewer = createCodeReviewer({} as any, {
      minScore: 85,
      minCoverage: 80,
      maxIterations: 10,
      minConvergenceIterations: 2,
      convergenceThreshold: 2,
    });

    expect(reviewer).toBeDefined();
  });
});
