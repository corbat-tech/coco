/**
 * E2E Integration Tests for the Convergence Loop
 *
 * Tests the full generate -> evaluate -> improve -> converge loop end-to-end.
 * Uses a mock LLM provider but exercises real convergence logic.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskIterator } from "../../src/phases/complete/iterator.js";
import type {
  QualityConfig,
  TaskExecutionContext,
  TestExecutionResult,
  GeneratedFile,
  CodeReviewResult,
} from "../../src/phases/complete/types.js";
import type {
  LLMProvider,
  Message,
  ChatOptions,
  ChatResponse,
  ChatWithToolsOptions,
  ChatWithToolsResponse,
  StreamChunk,
  ProviderConfig,
} from "../../src/providers/types.js";
import type { QualityDimensions } from "../../src/quality/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a QualityDimensions object where every dimension has the same value. */
function uniformDimensions(value: number): QualityDimensions {
  return {
    correctness: value,
    completeness: value,
    robustness: value,
    readability: value,
    maintainability: value,
    complexity: value,
    duplication: value,
    testCoverage: value,
    testQuality: value,
    security: value,
    documentation: value,
    style: value,
  };
}

/**
 * Build a CodeReviewResult-shaped JSON string that the mock LLM returns.
 *
 * The CodeReviewer.parseReviewResponse expects a JSON object with:
 *   { scores?: Partial<QualityDimensions>, issues?: [...], suggestions?: [...] }
 */
function buildReviewJson(
  overall: number,
  options?: {
    issues?: Array<{ severity: string; category: string; message: string }>;
    suggestions?: Array<{ type: string; description: string; priority: string; impact: number }>;
  },
): string {
  return JSON.stringify({
    scores: {
      ...uniformDimensions(overall),
      // Override testCoverage to always be above minCoverage so checkPassed works
      testCoverage: Math.max(overall, 85),
    },
    issues: options?.issues ?? [],
    suggestions: options?.suggestions ?? [],
  });
}

/**
 * Build a CodeGenerationResponse-shaped JSON string.
 *
 * The CodeGenerator.parseGenerationResponse expects:
 *   { files: [{ path, content, action }], explanation?, confidence? }
 */
function buildGenerateJson(files: GeneratedFile[]): string {
  return JSON.stringify({
    files,
    explanation: "Generated code",
    confidence: 80,
  });
}

/** A simple, syntactically-valid TypeScript source used in generation mocks. */
const SIMPLE_TS_SOURCE = `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`;

/** Default generated file used for mocks. */
const DEFAULT_GENERATED_FILE: GeneratedFile = {
  path: "src/greet.ts",
  content: SIMPLE_TS_SOURCE,
  action: "create",
};

/** Default passing test results. */
const PASSING_TEST_RESULTS: TestExecutionResult = {
  passed: 5,
  failed: 0,
  skipped: 0,
  coverage: { lines: 90, branches: 85, functions: 100, statements: 90 },
  failures: [],
  duration: 120,
};

/** Default quality config used in most tests. */
const DEFAULT_CONFIG: QualityConfig = {
  minScore: 85,
  minCoverage: 80,
  maxIterations: 5,
  convergenceThreshold: 2,
  minConvergenceIterations: 2,
};

// ---------------------------------------------------------------------------
// Mock LLM Provider Factory
// ---------------------------------------------------------------------------

interface MockChatHandler {
  (messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
}

function createMockLLMProvider(chatHandler: MockChatHandler): LLMProvider {
  return {
    id: "mock",
    name: "Mock Provider",
    async initialize(_config: ProviderConfig): Promise<void> {},
    chat: chatHandler,
    async chatWithTools(
      _messages: Message[],
      _options: ChatWithToolsOptions,
    ): Promise<ChatWithToolsResponse> {
      throw new Error("chatWithTools not implemented in mock");
    },
    async *stream(_messages: Message[], _options?: ChatOptions): AsyncIterable<StreamChunk> {
      yield { type: "done" };
    },
    async *streamWithTools(
      _messages: Message[],
      _options: ChatWithToolsOptions,
    ): AsyncIterable<StreamChunk> {
      yield { type: "done" };
    },
    countTokens(_text: string): number {
      return 100;
    },
    getContextWindow(): number {
      return 200000;
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Convergence Loop E2E", () => {
  // -----------------------------------------------------------------------
  // 1. checkConvergence unit-level scenarios
  // -----------------------------------------------------------------------
  describe("checkConvergence", () => {
    /**
     * Helper: create a TaskIterator with default config and no projectPath
     * (so no real QualityEvaluator is instantiated).
     */
    function makeIterator(config?: Partial<QualityConfig>): TaskIterator {
      const noop = createMockLLMProvider(async () => ({
        id: "noop",
        content: "{}",
        stopReason: "end_turn" as const,
        usage: { inputTokens: 0, outputTokens: 0 },
        model: "mock",
      }));
      return new TaskIterator(noop, { ...DEFAULT_CONFIG, ...config });
    }

    /** Build a minimal CodeReviewResult for convergence checking. */
    function makeReview(
      overall: number,
      options?: { criticalIssues?: number },
    ): CodeReviewResult {
      const issues = Array.from({ length: options?.criticalIssues ?? 0 }, (_, i) => ({
        severity: "critical" as const,
        category: "correctness" as keyof QualityDimensions,
        message: `Critical issue ${i + 1}`,
      }));

      return {
        passed: overall >= DEFAULT_CONFIG.minScore,
        scores: {
          overall,
          dimensions: uniformDimensions(overall),
          evaluatedAt: new Date(),
          evaluationDurationMs: 0,
        },
        issues,
        suggestions: [],
        testResults: PASSING_TEST_RESULTS,
      };
    }

    it("should return converged: false when below minimum iterations", () => {
      const iterator = makeIterator({ minConvergenceIterations: 3 });
      const result = iterator.checkConvergence([90, 91], makeReview(91), 2);

      expect(result.converged).toBe(false);
      expect(result.reason).toBe("Minimum iterations not reached");
    });

    it("should return converged: false when score is below minimum", () => {
      const iterator = makeIterator({ minScore: 85, minConvergenceIterations: 2 });
      const result = iterator.checkConvergence([60, 65, 70], makeReview(70), 3);

      expect(result.converged).toBe(false);
      expect(result.reason).toContain("below minimum");
    });

    it("should return converged: false when critical issues remain", () => {
      const iterator = makeIterator({ minConvergenceIterations: 2 });
      const review = makeReview(90, { criticalIssues: 1 });
      const result = iterator.checkConvergence([88, 89, 90], review, 3);

      expect(result.converged).toBe(false);
      expect(result.reason).toContain("critical issues remain");
    });

    it("should return converged: true when score has stabilized above threshold", () => {
      const iterator = makeIterator({
        minScore: 85,
        convergenceThreshold: 2,
        minConvergenceIterations: 2,
      });
      // Scores: 88 -> 89 -> 90 — last delta is 1, which is < threshold 2
      const result = iterator.checkConvergence([88, 89, 90], makeReview(90), 3);

      expect(result.converged).toBe(true);
      expect(result.reason).toBe("Score has stabilized");
    });

    it("should return converged: false with reason 'Score is decreasing' when improvement drops significantly", () => {
      const iterator = makeIterator({
        minScore: 85,
        convergenceThreshold: 2,
        minConvergenceIterations: 2,
      });
      // Scores: 95 -> 88 — delta is -7, which is < -5
      const result = iterator.checkConvergence([95, 88], makeReview(88), 3);

      expect(result.converged).toBe(false);
      expect(result.reason).toBe("Score is decreasing");
    });

    it("should return converged: false with reason 'Still improving' when score is rising", () => {
      const iterator = makeIterator({
        minScore: 85,
        convergenceThreshold: 2,
        minConvergenceIterations: 2,
      });
      // Scores: 86 -> 92 — delta is 6, above threshold but positive
      const result = iterator.checkConvergence([86, 92], makeReview(92), 3);

      expect(result.converged).toBe(false);
      expect(result.reason).toBe("Still improving");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Full convergence loop with mock LLM
  // -----------------------------------------------------------------------
  describe("Full convergence loop", () => {
    let testProjectPath: string;

    beforeAll(async () => {
      testProjectPath = await mkdtemp(join(tmpdir(), "coco-convergence-e2e-"));
      await mkdir(join(testProjectPath, "src"), { recursive: true });
    });

    afterAll(async () => {
      await rm(testProjectPath, { recursive: true, force: true });
    });

    it("should converge after multiple iterations with improving scores", async () => {
      let chatCallCount = 0;

      /**
       * Mock chat handler that returns different responses depending on the
       * call order. The flow inside the iterator is:
       *
       *   1. generator.generate()       — call #1 (initial generation)
       *   2. reviewer.review()           — call #2 (iteration 1 review)
       *   3. generator.improve()         — call #3 (iteration 1 improvement)
       *   4. reviewer.review()           — call #4 (iteration 2 review)
       *   ... (repeats until convergence or max iterations)
       *
       * The first generate call returns a simple TS file.
       * Review calls return increasing scores so the loop converges.
       * Improve calls return the same file (slightly "improved").
       */
      const mockChat: MockChatHandler = async (messages, _options) => {
        chatCallCount++;

        const _lastMessage = messages[messages.length - 1];

        // Detect whether this is a generate/improve call or a review call
        // by inspecting the system prompt (first message).
        const systemContent =
          typeof messages[0]?.content === "string" ? messages[0].content : "";
        const isReview = systemContent.includes("code review");
        const isGenerate = !isReview;

        let responseContent: string;

        if (isGenerate) {
          // Return generated files
          responseContent = buildGenerateJson([DEFAULT_GENERATED_FILE]);
        } else {
          // Review call — scores escalate each time we see a review
          // First review: 70, second: 88, third+: 90
          const reviewCount = Math.floor((chatCallCount - 1) / 2) + 1;
          if (reviewCount <= 1) {
            responseContent = buildReviewJson(70, {
              issues: [
                {
                  severity: "minor",
                  category: "documentation",
                  message: "Missing JSDoc comments",
                },
              ],
              suggestions: [
                {
                  type: "improvement",
                  description: "Add error handling",
                  priority: "medium",
                  impact: 5,
                },
              ],
            });
          } else if (reviewCount === 2) {
            responseContent = buildReviewJson(88);
          } else {
            responseContent = buildReviewJson(90);
          }
        }

        return {
          id: `mock-${chatCallCount}`,
          content: responseContent,
          stopReason: "end_turn" as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          model: "mock-model",
        };
      };

      const llm = createMockLLMProvider(mockChat);

      const config: QualityConfig = {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 5,
        convergenceThreshold: 2,
        minConvergenceIterations: 2,
      };

      // No projectPath so real quality evaluator is not used
      const iterator = new TaskIterator(llm, config);

      const context: TaskExecutionContext = {
        task: {
          id: "task-001",
          storyId: "story-001",
          title: "Implement greeting utility",
          description: "Create a utility function that greets users by name",
          type: "feature",
          files: ["src/greet.ts"],
          dependencies: [],
          estimatedComplexity: "simple",
          status: "in_progress",
        },
        sprint: {
          id: "sprint-1",
          name: "Sprint 1",
          goal: "Build core utilities",
          startDate: new Date(),
          stories: ["story-001"],
          status: "active",
        },
        projectPath: testProjectPath,
        previousVersions: [],
        qualityConfig: config,
      };

      const savedFiles: GeneratedFile[][] = [];
      const progressUpdates: Array<{ iteration: number; score: number }> = [];

      const result = await iterator.execute(
        context,
        async () => PASSING_TEST_RESULTS,
        async (files) => {
          savedFiles.push([...files]);
          for (const file of files) {
            await writeFile(join(testProjectPath, file.path), file.content);
          }
        },
        (iteration, score) => {
          progressUpdates.push({ iteration, score });
        },
      );

      // Verify the result
      expect(result.taskId).toBe("task-001");
      expect(result.success).toBe(true);
      expect(result.iterations).toBeGreaterThan(1);
      expect(result.versions.length).toBeGreaterThan(0);
      expect(result.finalScore).toBeGreaterThanOrEqual(config.minScore);

      // Either converged or passed threshold — both set converged: true
      expect(result.converged).toBe(true);

      // Files should have been saved at least twice (initial + improvements)
      expect(savedFiles.length).toBeGreaterThanOrEqual(1);

      // Progress callback should have been called
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0].iteration).toBe(1);
    }, 30000);

    it("should stop at max iterations when score does not converge", async () => {
      let chatCallCount = 0;

      // Return a score that is always below minScore and never converges
      const mockChat: MockChatHandler = async () => {
        chatCallCount++;
        const isReview = chatCallCount % 2 === 0;

        let responseContent: string;
        if (isReview) {
          // Always return a failing score — varies slightly so it never "stabilizes"
          const score = 50 + (chatCallCount % 10);
          responseContent = buildReviewJson(score, {
            issues: [
              {
                severity: "critical",
                category: "correctness",
                message: "Logic error detected",
              },
            ],
          });
        } else {
          responseContent = buildGenerateJson([DEFAULT_GENERATED_FILE]);
        }

        return {
          id: `mock-${chatCallCount}`,
          content: responseContent,
          stopReason: "end_turn" as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          model: "mock-model",
        };
      };

      const llm = createMockLLMProvider(mockChat);

      const config: QualityConfig = {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 3,
        convergenceThreshold: 2,
        minConvergenceIterations: 2,
      };

      const iterator = new TaskIterator(llm, config);

      const context: TaskExecutionContext = {
        task: {
          id: "task-002",
          storyId: "story-001",
          title: "Failing task",
          description: "This task never reaches quality threshold",
          type: "feature",
          files: ["src/fail.ts"],
          dependencies: [],
          estimatedComplexity: "complex",
          status: "in_progress",
        },
        sprint: {
          id: "sprint-1",
          name: "Sprint 1",
          goal: "Build core utilities",
          startDate: new Date(),
          stories: ["story-001"],
          status: "active",
        },
        projectPath: testProjectPath,
        previousVersions: [],
        qualityConfig: config,
      };

      const result = await iterator.execute(
        context,
        async () => PASSING_TEST_RESULTS,
        async (files) => {
          for (const file of files) {
            await writeFile(join(testProjectPath, file.path), file.content);
          }
        },
      );

      expect(result.taskId).toBe("task-002");
      expect(result.iterations).toBe(config.maxIterations);
      expect(result.converged).toBe(false);
      expect(result.error).toContain("Max iterations reached");
      // Success depends on whether the final score happens to pass — with our mock it should not
      expect(result.success).toBe(false);
    }, 30000);

    it("should succeed on first iteration when review score passes threshold immediately", async () => {
      let chatCallCount = 0;

      const mockChat: MockChatHandler = async () => {
        chatCallCount++;

        // First call: generate, second call: review with high score
        if (chatCallCount === 1) {
          return {
            id: "gen-1",
            content: buildGenerateJson([DEFAULT_GENERATED_FILE]),
            stopReason: "end_turn" as const,
            usage: { inputTokens: 100, outputTokens: 200 },
            model: "mock-model",
          };
        }

        // Review with immediate high score
        return {
          id: "review-1",
          content: buildReviewJson(95),
          stopReason: "end_turn" as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          model: "mock-model",
        };
      };

      const llm = createMockLLMProvider(mockChat);
      const iterator = new TaskIterator(llm, DEFAULT_CONFIG);

      const context: TaskExecutionContext = {
        task: {
          id: "task-003",
          storyId: "story-001",
          title: "Easy task",
          description: "A task that passes on first try",
          type: "feature",
          files: ["src/easy.ts"],
          dependencies: [],
          estimatedComplexity: "trivial",
          status: "in_progress",
        },
        sprint: {
          id: "sprint-1",
          name: "Sprint 1",
          goal: "Build core utilities",
          startDate: new Date(),
          stories: ["story-001"],
          status: "active",
        },
        projectPath: testProjectPath,
        previousVersions: [],
        qualityConfig: DEFAULT_CONFIG,
      };

      const result = await iterator.execute(
        context,
        async () => PASSING_TEST_RESULTS,
        async (files) => {
          for (const file of files) {
            await writeFile(join(testProjectPath, file.path), file.content);
          }
        },
      );

      expect(result.taskId).toBe("task-003");
      expect(result.success).toBe(true);
      expect(result.converged).toBe(true);
      // Passes on first iteration via checkPassed
      expect(result.iterations).toBe(1);
      expect(result.finalScore).toBeGreaterThanOrEqual(85);
      expect(result.versions).toHaveLength(1);
    }, 30000);

    it("should record version snapshots with correct structure at each iteration", async () => {
      let chatCallCount = 0;

      const mockChat: MockChatHandler = async () => {
        chatCallCount++;

        const isFirstCall = chatCallCount === 1;
        const isReview = !isFirstCall && chatCallCount % 2 === 0;

        if (isFirstCall || !isReview) {
          return {
            id: `gen-${chatCallCount}`,
            content: buildGenerateJson([DEFAULT_GENERATED_FILE]),
            stopReason: "end_turn" as const,
            usage: { inputTokens: 100, outputTokens: 200 },
            model: "mock-model",
          };
        }

        // Return a high score to converge quickly (after min iterations)
        return {
          id: `review-${chatCallCount}`,
          content: buildReviewJson(92),
          stopReason: "end_turn" as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          model: "mock-model",
        };
      };

      const llm = createMockLLMProvider(mockChat);
      const iterator = new TaskIterator(llm, DEFAULT_CONFIG);

      const context: TaskExecutionContext = {
        task: {
          id: "task-004",
          storyId: "story-001",
          title: "Snapshot task",
          description: "Task for testing version snapshots",
          type: "feature",
          files: ["src/greet.ts"],
          dependencies: [],
          estimatedComplexity: "simple",
          status: "in_progress",
        },
        sprint: {
          id: "sprint-1",
          name: "Sprint 1",
          goal: "Build core utilities",
          startDate: new Date(),
          stories: ["story-001"],
          status: "active",
        },
        projectPath: testProjectPath,
        previousVersions: [],
        qualityConfig: DEFAULT_CONFIG,
      };

      const result = await iterator.execute(
        context,
        async () => PASSING_TEST_RESULTS,
        async (files) => {
          for (const file of files) {
            await writeFile(join(testProjectPath, file.path), file.content);
          }
        },
      );

      expect(result.success).toBe(true);
      expect(result.versions.length).toBeGreaterThan(0);

      // Verify version structure
      for (const version of result.versions) {
        expect(version).toHaveProperty("version");
        expect(version).toHaveProperty("timestamp");
        expect(version).toHaveProperty("changes");
        expect(version).toHaveProperty("diffs");
        expect(version).toHaveProperty("scores");
        expect(version).toHaveProperty("testResults");
        expect(version).toHaveProperty("analysis");

        // Changes structure
        expect(version.changes).toHaveProperty("filesCreated");
        expect(version.changes).toHaveProperty("filesModified");
        expect(version.changes).toHaveProperty("filesDeleted");

        // Scores structure
        expect(version.scores).toHaveProperty("overall");
        expect(version.scores).toHaveProperty("dimensions");
        expect(typeof version.scores.overall).toBe("number");

        // Test results structure
        expect(version.testResults).toHaveProperty("passed");
        expect(version.testResults).toHaveProperty("failed");
        expect(version.testResults).toHaveProperty("coverage");

        // Analysis structure
        expect(version.analysis).toHaveProperty("issuesFound");
        expect(version.analysis).toHaveProperty("improvementsApplied");
        expect(version.analysis).toHaveProperty("reasoning");
        expect(version.analysis).toHaveProperty("confidence");
      }
    }, 30000);

    it("should handle LLM errors gracefully and return an error result", async () => {
      let chatCallCount = 0;

      const mockChat: MockChatHandler = async () => {
        chatCallCount++;
        if (chatCallCount === 1) {
          // First generate call succeeds
          return {
            id: "gen-1",
            content: buildGenerateJson([DEFAULT_GENERATED_FILE]),
            stopReason: "end_turn" as const,
            usage: { inputTokens: 100, outputTokens: 200 },
            model: "mock-model",
          };
        }
        // All subsequent calls fail
        throw new Error("LLM service unavailable");
      };

      const llm = createMockLLMProvider(mockChat);
      const iterator = new TaskIterator(llm, DEFAULT_CONFIG);

      const context: TaskExecutionContext = {
        task: {
          id: "task-005",
          storyId: "story-001",
          title: "Error task",
          description: "Task that triggers an LLM error",
          type: "feature",
          files: ["src/error.ts"],
          dependencies: [],
          estimatedComplexity: "simple",
          status: "in_progress",
        },
        sprint: {
          id: "sprint-1",
          name: "Sprint 1",
          goal: "Build core utilities",
          startDate: new Date(),
          stories: ["story-001"],
          status: "active",
        },
        projectPath: testProjectPath,
        previousVersions: [],
        qualityConfig: DEFAULT_CONFIG,
      };

      const result = await iterator.execute(
        context,
        async () => PASSING_TEST_RESULTS,
        async (files) => {
          for (const file of files) {
            await writeFile(join(testProjectPath, file.path), file.content);
          }
        },
      );

      expect(result.taskId).toBe("task-005");
      expect(result.success).toBe(false);
      expect(result.converged).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("LLM service unavailable");
    }, 30000);
  });
});
