import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { TestFailureAnalyzer, createTestFailureAnalyzer } from "./test-analyzer.js";
import * as fs from "node:fs/promises";
import type { LLMProvider } from "../../providers/types.js";
import type { TestResult } from "../../types/test.js";

const mockedReadFile = vi.mocked(fs.readFile);

function createMockLLM(responses: string[]): LLMProvider {
  let callIndex = 0;
  return {
    id: "mock",
    name: "Mock Provider",
    initialize: vi.fn(),
    chat: vi.fn().mockImplementation(async () => {
      const content = responses[callIndex] ?? '{"rootCause":"unknown","suggestedFix":"unknown","confidence":50,"affectedFiles":[]}';
      callIndex++;
      return {
        id: "resp-1",
        content,
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "mock-model",
      };
    }),
    chatWithTools: vi.fn(),
    stream: vi.fn(),
    streamWithTools: vi.fn(),
    countTokens: vi.fn().mockReturnValue(10),
    getContextWindow: vi.fn().mockReturnValue(8192),
    isAvailable: vi.fn().mockResolvedValue(true),
  } as unknown as LLMProvider;
}

describe("TestFailureAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: file reads fail (source context not found)
    mockedReadFile.mockRejectedValue(new Error("ENOENT"));
  });

  describe("createTestFailureAnalyzer", () => {
    it("should create a TestFailureAnalyzer instance", () => {
      const llm = createMockLLM([]);
      const analyzer = createTestFailureAnalyzer(llm);
      expect(analyzer).toBeInstanceOf(TestFailureAnalyzer);
    });
  });

  describe("analyzeFailures", () => {
    it("should return empty analysis when all tests pass", async () => {
      const llm = createMockLLM([]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        { name: "test 1", status: "passed", duration: 10 },
        { name: "test 2", status: "passed", duration: 20 },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      expect(analysis.failures).toHaveLength(0);
      expect(analysis.totalFailures).toBe(0);
      expect(analysis.highConfidenceCount).toBe(0);
      expect(analysis.summary).toBe("All tests passed");
      expect(llm.chat).not.toHaveBeenCalled();
    });

    it("should return empty analysis for skipped tests only", async () => {
      const llm = createMockLLM([]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        { name: "skipped test", status: "skipped" },
      ];

      const analysis = await analyzer.analyzeFailures(results);
      expect(analysis.totalFailures).toBe(0);
      expect(analysis.summary).toBe("All tests passed");
    });

    it("should analyze a single failure with LLM diagnosis", async () => {
      const llmResponse = JSON.stringify({
        rootCause: "Missing null check in processData function",
        suggestedFix: "Add null guard: if (!data) return;",
        confidence: 85,
        affectedFiles: ["src/processor.ts"],
      });

      const llm = createMockLLM([llmResponse]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "processData should handle null",
          status: "failed",
          error: {
            message: "Cannot read property 'length' of null",
            stack: "at processData (src/processor.ts:15:10)",
          },
        },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      expect(analysis.totalFailures).toBe(1);
      expect(analysis.failures).toHaveLength(1);
      expect(analysis.failures[0]?.rootCause).toBe("Missing null check in processData function");
      expect(analysis.failures[0]?.suggestedFix).toBe("Add null guard: if (!data) return;");
      expect(analysis.failures[0]?.confidence).toBe(85);
      expect(analysis.failures[0]?.affectedFiles).toEqual(["src/processor.ts"]);
      expect(analysis.highConfidenceCount).toBe(1);
      expect(llm.chat).toHaveBeenCalledTimes(1);
    });

    it("should analyze multiple failures in parallel", async () => {
      const responses = [
        JSON.stringify({
          rootCause: "Issue A",
          suggestedFix: "Fix A",
          confidence: 90,
          affectedFiles: ["a.ts"],
        }),
        JSON.stringify({
          rootCause: "Issue B",
          suggestedFix: "Fix B",
          confidence: 40,
          affectedFiles: ["b.ts"],
        }),
      ];

      const llm = createMockLLM(responses);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "test A",
          status: "failed",
          error: { message: "Error A", stack: "at funcA (a.ts:1:1)" },
        },
        {
          name: "test B",
          status: "failed",
          error: { message: "Error B", stack: "at funcB (b.ts:5:3)" },
        },
        { name: "test C", status: "passed" },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      expect(analysis.totalFailures).toBe(2);
      expect(analysis.failures).toHaveLength(2);
      expect(analysis.highConfidenceCount).toBe(1); // Only Issue A has >= 70
      expect(llm.chat).toHaveBeenCalledTimes(2);
    });

    it("should use fallback diagnosis when LLM returns no JSON", async () => {
      const llm = createMockLLM(["This is not JSON at all, just plain text."]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "failing test",
          status: "failed",
          error: { message: "Assertion failed" },
        },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      expect(analysis.failures[0]?.rootCause).toContain("Assertion failed");
      expect(analysis.failures[0]?.confidence).toBe(30);
    });

    it("should use fallback when LLM chat throws", async () => {
      const llm = createMockLLM([]);
      vi.mocked(llm.chat).mockRejectedValue(new Error("API timeout"));
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "timeout test",
          status: "failed",
          error: { message: "Some error" },
        },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      expect(analysis.failures[0]?.rootCause).toContain("Some error");
      expect(analysis.failures[0]?.suggestedFix).toBe("Review the code at the failure location");
      expect(analysis.failures[0]?.confidence).toBe(30);
    });

    it("should handle missing error message in fallback", async () => {
      const llm = createMockLLM([]);
      vi.mocked(llm.chat).mockRejectedValue(new Error("fail"));
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "no-error-msg test",
          status: "failed",
          // No error field
        },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      expect(analysis.failures[0]?.rootCause).toContain("Unknown error");
    });

    it("should clamp confidence to 0-100 range", async () => {
      const llmResponse = JSON.stringify({
        rootCause: "Bug",
        suggestedFix: "Fix",
        confidence: 150,
        affectedFiles: [],
      });

      const llm = createMockLLM([llmResponse]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        { name: "test", status: "failed", error: { message: "error" } },
      ];

      const analysis = await analyzer.analyzeFailures(results);
      expect(analysis.failures[0]?.confidence).toBe(100);
    });

    it("should default to 50 confidence when LLM returns no confidence", async () => {
      const llmResponse = JSON.stringify({
        rootCause: "Bug",
        suggestedFix: "Fix",
        affectedFiles: [],
      });

      const llm = createMockLLM([llmResponse]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        { name: "test", status: "failed", error: { message: "error" } },
      ];

      const analysis = await analyzer.analyzeFailures(results);
      expect(analysis.failures[0]?.confidence).toBe(50);
    });
  });

  describe("extractLocation", () => {
    it("should extract location from Node.js stack trace format", async () => {
      const llm = createMockLLM([
        JSON.stringify({
          rootCause: "x",
          suggestedFix: "y",
          confidence: 50,
          affectedFiles: [],
        }),
      ]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "location test",
          status: "failed",
          error: {
            message: "err",
            stack: "at myFunction (src/utils.ts:42:8)",
          },
        },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      expect(analysis.failures[0]?.location).toEqual({
        file: "src/utils.ts",
        line: 42,
        column: 8,
        function: "myFunction",
      });
    });

    it("should extract location from simple file:line:col format", async () => {
      const llm = createMockLLM([
        JSON.stringify({
          rootCause: "x",
          suggestedFix: "y",
          confidence: 50,
          affectedFiles: [],
        }),
      ]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "simple loc test",
          status: "failed",
          error: {
            message: "err",
            stack: "src/index.ts:10:5",
          },
        },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      // The first pattern (Node.js format) matches first with this input
      expect(analysis.failures[0]?.location.file).toBe("src/index.ts");
      expect(analysis.failures[0]?.location.line).toBe(10);
      expect(analysis.failures[0]?.location.column).toBe(5);
    });

    it("should return fallback location when stack trace is missing", async () => {
      const llm = createMockLLM([
        JSON.stringify({
          rootCause: "x",
          suggestedFix: "y",
          confidence: 50,
          affectedFiles: [],
        }),
      ]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "no-stack test",
          status: "failed",
          error: { message: "err" },
        },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      expect(analysis.failures[0]?.location).toEqual({
        file: "unknown",
        line: 0,
        column: 0,
      });
    });

    it("should return fallback location for unparseable stack trace", async () => {
      const llm = createMockLLM([
        JSON.stringify({
          rootCause: "x",
          suggestedFix: "y",
          confidence: 50,
          affectedFiles: [],
        }),
      ]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "gibberish stack",
          status: "failed",
          error: {
            message: "err",
            stack: "no useful info here at all",
          },
        },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      expect(analysis.failures[0]?.location.file).toBe("unknown");
    });
  });

  describe("root cause categorization (via summary)", () => {
    async function analyzeSingleFailure(rootCause: string): Promise<string> {
      const llm = createMockLLM([
        JSON.stringify({
          rootCause,
          suggestedFix: "fix",
          confidence: 80,
          affectedFiles: [],
        }),
      ]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        { name: "cat test", status: "failed", error: { message: "err" } },
      ];

      const analysis = await analyzer.analyzeFailures(results);
      return analysis.summary;
    }

    it("should categorize null/undefined issues", async () => {
      const summary = await analyzeSingleFailure("Variable is undefined when accessed");
      expect(summary).toContain("Null/Undefined Reference");
    });

    it("should categorize type mismatches", async () => {
      const summary = await analyzeSingleFailure("Type string is not assignable to expected number");
      expect(summary).toContain("Type Mismatch");
    });

    it("should categorize assertion failures", async () => {
      const summary = await analyzeSingleFailure("Assertion failed: expect(x).toBe(y)");
      expect(summary).toContain("Assertion Failure");
    });

    it("should categorize async/promise issues", async () => {
      const summary = await analyzeSingleFailure("Unhandled promise rejection in async handler");
      expect(summary).toContain("Async/Promise Issue");
    });

    it("should categorize import/module issues", async () => {
      const summary = await analyzeSingleFailure("Cannot find module 'missing-dep'");
      expect(summary).toContain("Import/Module Issue");
    });

    it("should categorize syntax errors", async () => {
      const summary = await analyzeSingleFailure("Unexpected syntax error at line 10");
      expect(summary).toContain("Syntax Error");
    });

    it("should categorize timeout issues", async () => {
      const summary = await analyzeSingleFailure("Test exceeded timeout of 5000ms");
      expect(summary).toContain("Timeout");
    });

    it("should categorize as Other for unrecognized patterns", async () => {
      const summary = await analyzeSingleFailure("Some completely random failure reason");
      expect(summary).toContain("Other");
    });
  });

  describe("readSourceContext", () => {
    it("should read source file and include context around the failure line", async () => {
      const fileContent = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
      mockedReadFile.mockResolvedValue(fileContent);

      const llm = createMockLLM([
        JSON.stringify({
          rootCause: "Bug",
          suggestedFix: "Fix",
          confidence: 80,
          affectedFiles: [],
        }),
      ]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "context test",
          status: "failed",
          error: {
            message: "err",
            stack: "at fn (src/code.ts:10:1)",
          },
        },
      ];

      await analyzer.analyzeFailures(results);

      // Verify the LLM was called with source context in the prompt
      const callArgs = vi.mocked(llm.chat).mock.calls[0]?.[0];
      const userMessage = callArgs?.find((m) => m.role === "user");
      const content = userMessage?.content as string;
      expect(content).toContain("line 10");
    });

    it("should gracefully handle file read errors", async () => {
      mockedReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

      const llm = createMockLLM([
        JSON.stringify({
          rootCause: "Bug",
          suggestedFix: "Fix",
          confidence: 80,
          affectedFiles: [],
        }),
      ]);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        {
          name: "missing file test",
          status: "failed",
          error: {
            message: "err",
            stack: "at fn (src/missing.ts:5:1)",
          },
        },
      ];

      // Should not throw
      const analysis = await analyzer.analyzeFailures(results);
      expect(analysis.failures).toHaveLength(1);
    });
  });

  describe("summary generation", () => {
    it("should generate summary with confidence breakdown", async () => {
      const responses = [
        JSON.stringify({ rootCause: "null ref", suggestedFix: "fix", confidence: 90, affectedFiles: [] }),
        JSON.stringify({ rootCause: "type error", suggestedFix: "fix", confidence: 55, affectedFiles: [] }),
        JSON.stringify({ rootCause: "random issue", suggestedFix: "fix", confidence: 20, affectedFiles: [] }),
      ];

      const llm = createMockLLM(responses);
      const analyzer = new TestFailureAnalyzer(llm);

      const results: TestResult[] = [
        { name: "t1", status: "failed", error: { message: "e1" } },
        { name: "t2", status: "failed", error: { message: "e2" } },
        { name: "t3", status: "failed", error: { message: "e3" } },
      ];

      const analysis = await analyzer.analyzeFailures(results);

      expect(analysis.summary).toContain("3 test failure(s)");
      expect(analysis.summary).toContain("High confidence fixes: 1");
      expect(analysis.summary).toContain("Medium confidence fixes: 1");
      expect(analysis.summary).toContain("Low confidence fixes: 1");
    });
  });
});
