/**
 * Tests for code reviewer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_QUALITY_WEIGHTS } from "../../quality/types.js";

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
          {
            severity: "minor",
            category: "documentation",
            message: "Missing JSDoc",
            file: "src/user.ts",
            line: 5,
          },
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
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
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
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 95, branches: 90, functions: 88, statements: 92 },
          failures: [],
          duration: 100,
        },
      );

      // Actual coverage should override LLM estimate
      expect(result.scores.dimensions.testCoverage).toBe(95);
      const expectedOverall = Math.round(
        Object.entries(DEFAULT_QUALITY_WEIGHTS).reduce((sum, [key, weight]) => {
          const value = key === "testCoverage" ? 95 : 50;
          return sum + value * weight;
        }, 0),
      );
      expect(result.scores.overall).toBe(expectedOverall);
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
        {
          passed: 0,
          failed: 1,
          skipped: 0,
          coverage: { lines: 0, branches: 0, functions: 0, statements: 0 },
          failures: [],
          duration: 100,
        },
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
        "export class User {}",
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
        "code",
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

describe("CodeReviewer - normalization and parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("normalizeDimensions", () => {
    it("should normalize partial dimension scores", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: {
              correctness: 95,
              // Missing other dimensions
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
        "Task",
        "Description",
        [{ path: "src/test.ts", content: "code" }],
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      // Missing dimensions should default to 50
      expect(result.scores.dimensions.completeness).toBe(50);
      expect(result.scores.dimensions.robustness).toBe(50);
    });

    it("should clamp scores to 0-100 range", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: {
              correctness: 150, // Above 100
              completeness: -20, // Below 0
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
        "Task",
        "Description",
        [{ path: "src/test.ts", content: "code" }],
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.scores.dimensions.correctness).toBe(100);
      expect(result.scores.dimensions.completeness).toBe(0);
    });

    it("should handle null scores", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: {
              correctness: null,
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
        "Task",
        "Description",
        [{ path: "src/test.ts", content: "code" }],
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.scores.dimensions.correctness).toBe(50);
    });
  });

  describe("normalizeSeverity", () => {
    it("should normalize all severity levels", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: { correctness: 80 },
            issues: [
              { severity: "CRITICAL", message: "Critical issue" },
              { severity: "Major", message: "Major issue" },
              { severity: "MINOR", message: "Minor issue" },
              { severity: "info", message: "Info issue" },
              { severity: "unknown", message: "Unknown severity" },
            ],
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
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.issues[0]?.severity).toBe("critical");
      expect(result.issues[1]?.severity).toBe("major");
      expect(result.issues[2]?.severity).toBe("minor");
      expect(result.issues[3]?.severity).toBe("info");
      expect(result.issues[4]?.severity).toBe("info"); // Unknown defaults to info
    });
  });

  describe("normalizeCategory", () => {
    it("should normalize all category types", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: { correctness: 80 },
            issues: [
              { category: "CORRECTNESS", message: "Correctness issue" },
              { category: "Completeness", message: "Completeness issue" },
              { category: "testCoverage", message: "Coverage issue" },
              { category: "Security", message: "Security issue" },
              { category: "unknown_category", message: "Unknown category" },
            ],
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
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.issues[0]?.category).toBe("correctness");
      expect(result.issues[1]?.category).toBe("completeness");
      expect(result.issues[2]?.category).toBe("testCoverage");
      expect(result.issues[3]?.category).toBe("security");
      expect(result.issues[4]?.category).toBe("correctness"); // Unknown defaults to correctness
    });
  });

  describe("normalizeSuggestionType", () => {
    it("should normalize all suggestion types", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: { correctness: 80 },
            issues: [],
            suggestions: [
              { type: "IMPROVEMENT", description: "Improve X" },
              { type: "Refactor", description: "Refactor Y" },
              { type: "test", description: "Add tests" },
              { type: "Documentation", description: "Add docs" },
              { type: "unknown", description: "Unknown type" },
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

      const result = await reviewer.review(
        "Task",
        "Description",
        [{ path: "src/test.ts", content: "code" }],
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.suggestions[0]?.type).toBe("improvement");
      expect(result.suggestions[1]?.type).toBe("refactor");
      expect(result.suggestions[2]?.type).toBe("test");
      expect(result.suggestions[3]?.type).toBe("documentation");
      expect(result.suggestions[4]?.type).toBe("improvement"); // Unknown defaults to improvement
    });
  });

  describe("normalizePriority", () => {
    it("should normalize all priority levels", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: { correctness: 80 },
            issues: [],
            suggestions: [
              { priority: "HIGH", description: "High priority" },
              { priority: "Medium", description: "Medium priority" },
              { priority: "low", description: "Low priority" },
              { priority: "unknown", description: "Unknown priority" },
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

      const result = await reviewer.review(
        "Task",
        "Description",
        [{ path: "src/test.ts", content: "code" }],
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.suggestions[0]?.priority).toBe("high");
      expect(result.suggestions[1]?.priority).toBe("medium");
      expect(result.suggestions[2]?.priority).toBe("low");
      expect(result.suggestions[3]?.priority).toBe("medium"); // Unknown defaults to medium
    });
  });

  describe("analyzeFailures edge cases", () => {
    it("should handle missing analyses array", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            // No analyses field
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
        [{ name: "test", message: "failed" }],
        "code",
      );

      expect(analyses).toEqual([]);
    });

    it("should handle incomplete analysis objects", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            analyses: [
              { testName: "test1" }, // Missing other fields
              { rootCause: "cause" }, // Missing testName
              {}, // Empty object
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
        [{ name: "test", message: "failed" }],
        "code",
      );

      expect(analyses.length).toBe(3);
      expect(analyses[0]?.rootCause).toBe("");
      expect(analyses[0]?.confidence).toBe(50);
      expect(analyses[1]?.testName).toBe("");
    });
  });

  describe("createDefaultReview", () => {
    it("should create default review on JSON parse error", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: "{ invalid json syntax",
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
        {
          passed: 0,
          failed: 1,
          skipped: 0,
          coverage: { lines: 50, branches: 40, functions: 60, statements: 45 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.passed).toBe(false);
      expect(result.scores.overall).toBe(0);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.scores.dimensions.testCoverage).toBe(50);
    });

    it("should preserve actual coverage in default review", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: "Not JSON at all",
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
        {
          passed: 0,
          failed: 0,
          skipped: 0,
          coverage: { lines: 75, branches: 70, functions: 80, statements: 72 },
          failures: [],
          duration: 0,
        },
      );

      expect(result.scores.dimensions.testCoverage).toBe(75);
    });
  });

  describe("overall score calculation", () => {
    it("should calculate weighted overall score correctly", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: {
              correctness: 100,
              completeness: 100,
              robustness: 100,
              readability: 100,
              maintainability: 100,
              complexity: 100,
              duplication: 100,
              testCoverage: 100,
              testQuality: 100,
              security: 100,
              documentation: 100,
              style: 100,
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
        "Task",
        "Description",
        [{ path: "src/test.ts", content: "code" }],
        {
          passed: 10,
          failed: 0,
          skipped: 0,
          coverage: { lines: 100, branches: 100, functions: 100, statements: 100 },
          failures: [],
          duration: 100,
        },
      );

      // All 100s should result in 100 overall (weights sum to 1.0)
      expect(result.scores.overall).toBe(100);
    });
  });

  describe("issue normalization", () => {
    it("should handle issue with all optional fields", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: { correctness: 80 },
            issues: [
              {
                severity: "major",
                category: "security",
                message: "SQL injection vulnerability",
                file: "src/db.ts",
                line: 42,
                suggestion: "Use parameterized queries",
              },
            ],
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
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.issues[0]?.file).toBe("src/db.ts");
      expect(result.issues[0]?.line).toBe(42);
      expect(result.issues[0]?.suggestion).toBe("Use parameterized queries");
    });

    it("should handle issue with missing message", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: { correctness: 80 },
            issues: [
              { severity: "minor" }, // Missing message
            ],
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
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.issues[0]?.message).toBe("");
    });
  });

  describe("suggestion normalization", () => {
    it("should handle suggestion with missing impact", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: { correctness: 80 },
            issues: [],
            suggestions: [{ type: "improvement", description: "Add caching" }],
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
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.suggestions[0]?.impact).toBe(5);
    });

    it("should handle suggestion with custom impact", async () => {
      const { CodeReviewer } = await import("./reviewer.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            scores: { correctness: 80 },
            issues: [],
            suggestions: [{ type: "improvement", description: "Add caching", impact: 10 }],
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
        {
          passed: 5,
          failed: 0,
          skipped: 0,
          coverage: { lines: 85, branches: 80, functions: 90, statements: 85 },
          failures: [],
          duration: 100,
        },
      );

      expect(result.suggestions[0]?.impact).toBe(10);
    });
  });
});
