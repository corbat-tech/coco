import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { QualityEvaluator } from "./evaluator.js";
import { createQualitySnapshot, isQualitySnapshotCurrent } from "./snapshot.js";
import { CoverageAnalyzer } from "./analyzers/coverage.js";
import { CorrectnessAnalyzer } from "./analyzers/correctness.js";
import { StyleAnalyzer } from "./analyzers/style.js";

import { CompositeSecurityScanner } from "./analyzers/security.js";
import { ComplexityAnalyzer, DuplicationAnalyzer } from "./analyzers/complexity.js";
import { CompletenessAnalyzer } from "./analyzers/completeness.js";
import { RobustnessAnalyzer } from "./analyzers/robustness.js";
import { TestQualityAnalyzer } from "./analyzers/test-quality.js";
import { DocumentationAnalyzer } from "./analyzers/documentation.js";
import { ReadabilityAnalyzer } from "./analyzers/readability.js";
import { MaintainabilityAnalyzer } from "./analyzers/maintainability.js";

describe("quality evidence", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "coco-quality-evidence-"));
    await writeFile(
      join(cwd, "index.ts"),
      "export function add(a: number, b: number) { return a + b; }",
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true });
  });
  it("accepts complete current evidence without confusing acceptance and convergence", async () => {
    vi.spyOn(CoverageAnalyzer.prototype, "analyzeFresh").mockResolvedValue({
      lines: { total: 10, percentage: 100 },
    } as never);
    vi.spyOn(CorrectnessAnalyzer.prototype, "analyze").mockResolvedValue({
      score: 100,
      testsTotal: 5,
      testsFailed: 0,
      buildAvailable: true,
      buildSuccess: true,
    } as never);
    vi.spyOn(StyleAnalyzer.prototype, "analyze").mockResolvedValue({
      score: 100,
      linterUsed: "fixture",
    } as never);
    vi.spyOn(CompositeSecurityScanner.prototype, "scan").mockResolvedValue({
      score: 100,
      vulnerabilities: [],
    } as never);
    vi.spyOn(ComplexityAnalyzer.prototype, "analyze").mockResolvedValue({ score: 100 } as never);
    vi.spyOn(DuplicationAnalyzer.prototype, "analyze").mockResolvedValue({
      percentage: 0,
    } as never);
    vi.spyOn(CompletenessAnalyzer.prototype, "analyze").mockResolvedValue({ score: 100 } as never);
    vi.spyOn(RobustnessAnalyzer.prototype, "analyze").mockResolvedValue({ score: 100 } as never);
    vi.spyOn(TestQualityAnalyzer.prototype, "analyze").mockResolvedValue({
      score: 100,
      totalTests: 5,
    } as never);
    vi.spyOn(DocumentationAnalyzer.prototype, "analyze").mockResolvedValue({ score: 100 } as never);
    vi.spyOn(ReadabilityAnalyzer.prototype, "analyze").mockResolvedValue({ score: 100 } as never);
    vi.spyOn(MaintainabilityAnalyzer.prototype, "analyze").mockResolvedValue({
      score: 100,
    } as never);
    const result = await new QualityEvaluator(cwd).evaluate();
    expect(result.complete).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.converged).toBe(false);
    expect(result.scores.overall).toBe(100);
    expect(
      Object.values(result.measurements ?? {}).reduce((sum, m) => sum + m.effectiveWeight, 0),
    ).toBeCloseTo(1);
  });
  it("marks function complexity not applicable to parsed constant-only modules", async () => {
    await writeFile(join(cwd, "index.ts"), "export const answer = 42;");
    const result = await new QualityEvaluator(cwd).evaluate();
    expect(result.measurements?.complexity).toMatchObject({
      state: "not_applicable",
      score: null,
      effectiveWeight: 0,
    });
    expect(result.measurements?.complexity.evidence.length).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
  });
  it("reports missing instrumentation instead of certifying a partial score", async () => {
    const result = await new QualityEvaluator(cwd).evaluate();
    expect(result.measurements?.testCoverage.state).toBe("unavailable");
    expect(result.measurements?.correctness.state).toBe("unavailable");
    expect(result.measurements?.security.state).toBe("measured");
    expect(result.measurements?.testCoverage.score).toBeNull();
    expect(result.measurements?.testCoverage.effectiveWeight).toBe(0);
    expect(result.complete).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.converged).toBe(false);
    expect(result.snapshotValid).toBe(true);
  });
  it("retains analyzer failure explicitly and drains other measurements", async () => {
    vi.spyOn(StyleAnalyzer.prototype, "analyze").mockRejectedValue(
      new Error("Malformed linter JSON"),
    );
    const result = await new QualityEvaluator(cwd).evaluate();
    expect(result.measurements?.style).toMatchObject({
      state: "error",
      score: null,
      reason: "style analysis failed; no measurement available",
    });
    expect(result.measurements?.security.state).toBe("measured");
    expect(result.passed).toBe(false);
  });
  it("invalidates evidence when a command edits a source file", async () => {
    vi.spyOn(StyleAnalyzer.prototype, "analyze").mockImplementation(async () => {
      await writeFile(join(cwd, "index.ts"), "export const changed = true;");
      return { score: 100, errors: 0, warnings: 0, linterUsed: "test", details: "fixture" };
    });
    const result = await new QualityEvaluator(cwd).evaluate();
    expect(result.snapshotValid).toBe(false);
    expect(result.passed).toBe(false);
  });
  it("never reuses the legacy coverage report reader for certification", async () => {
    const legacy = vi.spyOn(CoverageAnalyzer.prototype, "analyze");
    const fresh = vi.spyOn(CoverageAnalyzer.prototype, "analyzeFresh");
    await new QualityEvaluator(cwd).evaluate();
    expect(fresh).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("does not accept green text from a failed test process", async () => {
    vi.spyOn(CorrectnessAnalyzer.prototype, "analyze").mockRejectedValue(
      new Error("Test process failed"),
    );
    const result = await new QualityEvaluator(cwd).evaluate();
    expect(result.measurements?.correctness.state).toBe("error");
    expect(result.meetsMinimum).toBe(false);
  });
  it("rejects ignored source and symlink targets not covered by the snapshot", async () => {
    await mkdir(join(cwd, "dist"));
    await writeFile(join(cwd, "dist", "hidden.ts"), "export const hidden = 1;");
    await symlink(join(cwd, "dist", "hidden.ts"), join(cwd, "alias.ts"));
    await expect(new QualityEvaluator(cwd).evaluate(["dist/hidden.ts"])).rejects.toThrow(
      "snapshot coverage",
    );
    await expect(new QualityEvaluator(cwd).evaluate(["alias.ts"])).rejects.toThrow(
      "snapshot coverage",
    );
  });
  it("reports static parse failures instead of treating skipped files as perfect", async () => {
    await writeFile(join(cwd, "index.ts"), "export function broken(");
    const result = await new QualityEvaluator(cwd).evaluate();
    expect(result.measurements?.complexity.state).toBe("error");
    expect(result.measurements?.readability.score).toBeNull();
    expect(result.passed).toBe(false);
  });
  it("hashes tests, configuration, additions and deletions, excluding build artifacts", async () => {
    const snapshot = await createQualitySnapshot(cwd);
    expect(await isQualitySnapshotCurrent(cwd, snapshot)).toBe(true);
    await writeFile(join(cwd, "index.test.ts"), "test('x', () => {});");
    expect(await isQualitySnapshotCurrent(cwd, snapshot)).toBe(false);
    await rm(join(cwd, "index.test.ts"));
    expect(await isQualitySnapshotCurrent(cwd, snapshot)).toBe(true);
    await writeFile(join(cwd, "tsconfig.json"), "{}");
    expect(await isQualitySnapshotCurrent(cwd, snapshot)).toBe(false);
  });
});
