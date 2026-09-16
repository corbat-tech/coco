import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../../providers/types.js";
import type { QualityEvaluation, QualityScores } from "../../quality/types.js";
import type {
  CodeReviewResult,
  QualityConfig,
  TaskExecutionContext,
  TestExecutionResult,
} from "./types.js";
import { TaskIterator } from "./iterator.js";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  improve: vi.fn(),
  review: vi.fn(),
  evaluate: vi.fn(),
  checkPassed: vi.fn(() => true),
  getCriticalIssues: vi.fn(() => []),
}));
vi.mock("./generator.js", () => ({
  CodeGenerator: vi.fn(function () {
    return { generate: mocks.generate, improve: mocks.improve };
  }),
}));
vi.mock("./reviewer.js", () => ({
  CodeReviewer: vi.fn(function () {
    return {
      review: mocks.review,
      checkPassed: mocks.checkPassed,
      getCriticalIssues: mocks.getCriticalIssues,
    };
  }),
}));
vi.mock("../../quality/evaluator.js", () => ({
  QualityEvaluator: vi.fn(function () {
    return { evaluate: mocks.evaluate };
  }),
}));

function scores(): QualityScores {
  return {
    overall: 100,
    evaluatedAt: new Date(0),
    evaluationDurationMs: 0,
    dimensions: {
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
  };
}
function tests(): TestExecutionResult {
  return {
    passed: 3,
    failed: 0,
    skipped: 0,
    duration: 0,
    failures: [],
    coverage: { lines: 100, branches: 100, functions: 100, statements: 100 },
  };
}
function evaluation(): QualityEvaluation {
  return {
    scores: scores(),
    meetsMinimum: true,
    meetsTarget: true,
    converged: false,
    issues: [],
    suggestions: [],
  };
}
function review(): CodeReviewResult {
  return { passed: true, scores: scores(), issues: [], suggestions: [], testResults: tests() };
}
function fixture(withEvaluator = true, overrides: Partial<QualityConfig> = {}) {
  const config: QualityConfig = {
    minScore: 85,
    minCoverage: 80,
    maxIterations: 1,
    minConvergenceIterations: 2,
    convergenceThreshold: 2,
    ...overrides,
  };
  const context = {
    task: { id: "task", title: "Fixture task", description: "Fixture", type: "feature", files: [] },
    projectPath: "/fixture/project",
    sprint: { id: "sprint", name: "Fixture", goal: "Verify gate" },
    previousVersions: [],
    qualityConfig: config,
  } as unknown as TaskExecutionContext;
  const iterator = new TaskIterator(
    {} as LLMProvider,
    config,
    withEvaluator ? context.projectPath : undefined,
  );
  const runTests = vi.fn(async () => tests());
  const saveFiles = vi.fn(async () => {});
  return {
    iterator,
    context,
    runTests,
    saveFiles,
    execute: () => iterator.execute(context, runTests, saveFiles),
  };
}

describe("TaskIterator accepts only verified results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generate.mockResolvedValue({
      files: [{ path: "fixture.ts", content: "initial code", action: "create" }],
      explanation: "Fixture",
      confidence: 100,
    });
    mocks.improve.mockResolvedValue({
      files: [{ path: "fixture.ts", content: "reviewed improvement", action: "modify" }],
      explanation: "Improved",
      confidence: 100,
    });
    mocks.review.mockImplementation(async () => review());
    mocks.evaluate.mockImplementation(async () => evaluation());
    // Deliberately permissive review helpers cannot substitute for acceptance.
    mocks.checkPassed.mockReturnValue(true);
    mocks.getCriticalIssues.mockReturnValue([]);
  });

  it.each(["absent", "throws"])(
    "does not accept high model scores when the evaluator %s; preserves saved work/version",
    async (state) => {
      if (state === "throws") mocks.evaluate.mockRejectedValue(new Error("analyzer unavailable"));
      const { execute, saveFiles } = fixture(state !== "absent");
      const result = await execute();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/quality.*verif|verif.*quality/i);
      expect(saveFiles).toHaveBeenCalledTimes(1);
      expect(result.versions).toHaveLength(1);
      expect(result.versions[0]?.diffs).toEqual([
        expect.objectContaining({ file: "fixture.ts", diff: "initial code" }),
      ]);
      expect(mocks.improve).not.toHaveBeenCalled();
      if (state === "absent") expect(mocks.evaluate).not.toHaveBeenCalled();
    },
  );

  it.each(["review", "analyzer"])(
    "rejects a critical issue from the %s despite excellent scores and permissive helpers",
    async (source) => {
      if (source === "review")
        mocks.review.mockImplementation(async () => ({
          ...review(),
          issues: [
            { severity: "critical", category: "security", message: "Critical review finding" },
          ],
        }));
      else
        mocks.evaluate.mockImplementation(async () => ({
          ...evaluation(),
          issues: [
            { severity: "critical", dimension: "security", message: "Critical analyzer finding" },
          ],
        }));
      const result = await fixture().execute();
      expect(result.success).toBe(false);
      expect(result.versions[0]?.analysis.issuesFound).toEqual(
        expect.arrayContaining([expect.objectContaining({ severity: "critical" })]),
      );
    },
  );

  it.each(["failed count", "failure details", "zero tests"])(
    "rejects unverified test evidence: %s",
    async (state) => {
      const { execute, runTests } = fixture();
      const evidence = tests();
      if (state === "failed count") evidence.failed = 1;
      if (state === "failure details")
        evidence.failures = [
          { name: "failure", file: "fixture.test.ts", message: "assertion failed" },
        ];
      if (state === "zero tests") evidence.passed = 0;
      runTests.mockResolvedValue(evidence);
      expect((await execute()).success).toBe(false);
    },
  );

  it("respects evaluator meetsMinimum=false even with perfect measured dimensions", async () => {
    mocks.evaluate.mockImplementation(async () => ({ ...evaluation(), meetsMinimum: false }));
    expect((await fixture().execute()).success).toBe(false);
  });

  it.each([NaN, Infinity, -1, 101])("rejects invalid measured dimension %s", async (value) => {
    mocks.evaluate.mockImplementation(async () => {
      const result = evaluation();
      result.scores.dimensions.maintainability = value;
      return result;
    });
    expect((await fixture().execute()).success).toBe(false);
  });

  it("enforces configured coverage even when the evaluator claims minimum acceptance", async () => {
    mocks.evaluate.mockImplementation(async () => {
      const result = evaluation();
      result.scores.dimensions.testCoverage = 79;
      return result;
    });
    expect((await fixture().execute()).success).toBe(false);
  });

  it("accepts a verified first pass without falsely reporting score convergence", async () => {
    const { execute, saveFiles, runTests } = fixture();
    const result = await execute();
    expect(result).toMatchObject({ success: true, converged: false, iterations: 1 });
    expect(result.versions).toHaveLength(1);
    expect(mocks.evaluate).toHaveBeenCalledWith(["/fixture/project/fixture.ts"]);
    expect(runTests).toHaveBeenCalledTimes(1);
    expect(saveFiles).toHaveBeenCalledTimes(1);
    expect(mocks.improve).not.toHaveBeenCalled();
  });

  it("does not save an unverified extra improvement after exhausting the iteration limit", async () => {
    mocks.evaluate.mockImplementation(async () => ({ ...evaluation(), meetsMinimum: false }));
    const { execute, runTests, saveFiles } = fixture(true, { maxIterations: 2 });
    const result = await execute();
    expect(result).toMatchObject({ success: false, iterations: 2 });
    expect(result.versions).toHaveLength(2);
    expect(runTests).toHaveBeenCalledTimes(2);
    expect(mocks.evaluate).toHaveBeenCalledTimes(2);
    expect(mocks.improve).toHaveBeenCalledTimes(1);
    expect(saveFiles).toHaveBeenCalledTimes(2);
    expect(result.versions[1]?.diffs).toEqual([
      expect.objectContaining({ diff: "reviewed improvement" }),
    ]);
    expect(saveFiles).toHaveBeenLastCalledWith([
      { path: "fixture.ts", content: "reviewed improvement", action: "modify" },
    ]);
  });
});
