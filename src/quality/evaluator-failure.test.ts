import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QualityEvaluator } from "./evaluator.js";

const analyzers = vi.hoisted(() => ({
  testCoverage: vi.fn(),
  security: vi.fn(),
  complexity: vi.fn(),
  duplication: vi.fn(),
  correctness: vi.fn(),
  completeness: vi.fn(),
  robustness: vi.fn(),
  testQuality: vi.fn(),
  documentation: vi.fn(),
  style: vi.fn(),
  readability: vi.fn(),
  maintainability: vi.fn(),
}));
vi.mock("./analyzers/coverage.js", () => ({
  CoverageAnalyzer: vi.fn(function () {
    return { analyze: analyzers.testCoverage };
  }),
}));
vi.mock("./analyzers/security.js", () => ({
  CompositeSecurityScanner: vi.fn(function () {
    return { scan: analyzers.security };
  }),
}));
vi.mock("./analyzers/complexity.js", () => ({
  ComplexityAnalyzer: vi.fn(function () {
    return { analyze: analyzers.complexity };
  }),
  DuplicationAnalyzer: vi.fn(function () {
    return { analyze: analyzers.duplication };
  }),
}));
vi.mock("./analyzers/correctness.js", () => ({
  CorrectnessAnalyzer: vi.fn(function () {
    return { analyze: analyzers.correctness };
  }),
}));
vi.mock("./analyzers/completeness.js", () => ({
  CompletenessAnalyzer: vi.fn(function () {
    return { analyze: analyzers.completeness };
  }),
}));
vi.mock("./analyzers/robustness.js", () => ({
  RobustnessAnalyzer: vi.fn(function () {
    return { analyze: analyzers.robustness };
  }),
}));
vi.mock("./analyzers/test-quality.js", () => ({
  TestQualityAnalyzer: vi.fn(function () {
    return { analyze: analyzers.testQuality };
  }),
}));
vi.mock("./analyzers/documentation.js", () => ({
  DocumentationAnalyzer: vi.fn(function () {
    return { analyze: analyzers.documentation };
  }),
}));
vi.mock("./analyzers/style.js", () => ({
  StyleAnalyzer: vi.fn(function () {
    return { analyze: analyzers.style };
  }),
}));
vi.mock("./analyzers/readability.js", () => ({
  ReadabilityAnalyzer: vi.fn(function () {
    return { analyze: analyzers.readability };
  }),
}));
vi.mock("./analyzers/maintainability.js", () => ({
  MaintainabilityAnalyzer: vi.fn(function () {
    return { analyze: analyzers.maintainability };
  }),
}));
vi.mock("../config/project-config.js", () => ({ loadProjectConfig: vi.fn(async () => null) }));

describe("QualityEvaluator fails closed on incomplete analysis", () => {
  let project: string;
  let source: string;

  beforeEach(async () => {
    project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "coco-evaluation-")));
    source = path.join(project, "fixture.ts");
    await fs.writeFile(source, "export const fixture = 1;\n");
    for (const analyzer of Object.values(analyzers))
      analyzer.mockReset().mockResolvedValue({ score: 100 });
    analyzers.testCoverage.mockResolvedValue({ lines: { percentage: 100 } });
    analyzers.security.mockResolvedValue({ score: 100, vulnerabilities: [] });
    analyzers.complexity.mockResolvedValue({ score: 100, files: [] });
    analyzers.duplication.mockResolvedValue({
      score: 93,
      percentage: 7,
      duplicateLines: 7,
      totalLines: 100,
    });
  });

  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true });
  });

  it.each(Object.keys(analyzers) as Array<keyof typeof analyzers>)(
    "rejects %s failure without fabricating a score or exposing the analyzer secret",
    async (dimension) => {
      analyzers[dimension].mockRejectedValue(
        new Error("PRIVATE_ANALYZER_SECRET fixture-token-123"),
      );
      const outcome = new QualityEvaluator(project).evaluate([source]);
      await expect(outcome).rejects.toThrow("Quality evaluation incomplete");
      await expect(outcome).rejects.toThrow(dimension);
      await outcome.catch((error: Error) => {
        expect(error.message).not.toMatch(/PRIVATE_ANALYZER_SECRET|fixture-token-123/);
      });
      for (const analyzer of Object.values(analyzers)) expect(analyzer).toHaveBeenCalledTimes(1);
    },
  );

  it("returns measured dimensions and acceptance only after every analyzer succeeds", async () => {
    const result = await new QualityEvaluator(project).evaluate([source]);
    expect(result.meetsMinimum).toBe(true);
    expect(result.scores.dimensions).toEqual({
      testCoverage: 100,
      security: 100,
      complexity: 100,
      duplication: 93,
      correctness: 100,
      completeness: 100,
      robustness: 100,
      testQuality: 100,
      documentation: 100,
      style: 100,
      readability: 100,
      maintainability: 100,
    });
    expect(analyzers.security).toHaveBeenCalledWith([
      { path: source, content: "export const fixture = 1;\n" },
    ]);
    for (const analyzer of Object.values(analyzers)) expect(analyzer).toHaveBeenCalledTimes(1);
  });

  it("drains a slow analyzer before rejecting another analyzer's failure", async () => {
    let started!: () => void;
    let release!: () => void;
    let completed = false;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    analyzers.readability.mockImplementation(async () => {
      started();
      await barrier;
      completed = true;
      return { score: 100 };
    });
    analyzers.duplication.mockRejectedValue(new Error("PRIVATE_ANALYZER_SECRET"));
    let settled = false;
    const pending = new QualityEvaluator(project).evaluate([source]).then(
      (value) => {
        settled = true;
        return { value, error: undefined };
      },
      (error: Error) => {
        settled = true;
        return { value: undefined, error };
      },
    );
    await ready;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settledBeforeDrain = settled;
    release();
    const outcome = await pending;
    expect(settledBeforeDrain).toBe(false);
    expect(completed).toBe(true);
    expect(outcome.value).toBeUndefined();
    expect(outcome.error?.message).toContain("Quality evaluation incomplete");
    expect(outcome.error?.message).toContain("duplication");
    expect(outcome.error?.message).not.toContain("PRIVATE_ANALYZER_SECRET");
  });

  it("rejects unreadable source input instead of analyzing an empty replacement", async () => {
    const missing = path.join(project, "PRIVATE_SOURCE_NAME.ts");
    const pending = new QualityEvaluator(project).evaluate([source, missing]);
    await expect(pending).rejects.toThrow("Quality evaluation incomplete");
    await pending.catch((error: Error) => {
      expect(error.message).not.toContain("PRIVATE_SOURCE_NAME");
    });
    for (const analyzer of Object.values(analyzers)) expect(analyzer).not.toHaveBeenCalled();
  });
});
