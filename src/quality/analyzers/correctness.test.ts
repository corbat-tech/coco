/**
 * Behavioral tests for CorrectnessAnalyzer
 * Tests scoring logic based on test pass rate and build success
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("./build-verifier.js", () => ({
  BuildVerifier: vi.fn().mockImplementation(() => ({
    verifyTypes: vi.fn(),
  })),
}));

vi.mock("./coverage.js", () => ({
  detectTestFramework: vi.fn(),
}));

import { CorrectnessAnalyzer } from "./correctness.js";
import { execa } from "execa";
import { BuildVerifier } from "./build-verifier.js";
import { detectTestFramework } from "./coverage.js";

const mockedExeca = vi.mocked(execa);
const mockedDetectTestFramework = vi.mocked(detectTestFramework);

function getMockedBuildVerifier(): { verifyTypes: ReturnType<typeof vi.fn> } {
  const instance = vi.mocked(BuildVerifier).mock.results[0]?.value;
  return instance;
}

describe("CorrectnessAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("scoring: all tests pass and build succeeds", () => {
    it("should return score 100 when all tests pass and build succeeds", async () => {
      mockedDetectTestFramework.mockResolvedValue("vitest");
      mockedExeca.mockResolvedValue({
        stdout: " Tests  10 passed (10)",
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");

      // Access the mocked BuildVerifier instance after construction
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      expect(result.score).toBe(100);
      expect(result.testPassRate).toBe(100);
      expect(result.buildSuccess).toBe(true);
      expect(result.testsPassed).toBe(10);
      expect(result.testsFailed).toBe(0);
      expect(result.testsTotal).toBe(10);
      expect(result.buildErrors).toBe(0);
    });
  });

  describe("scoring: 50% test failures", () => {
    it("should reflect half pass rate in the score (35 from tests + 30 from build = 65)", async () => {
      mockedDetectTestFramework.mockResolvedValue("vitest");
      mockedExeca.mockResolvedValue({
        stdout: " Tests  5 passed | 5 failed (10)",
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      // 50% pass rate -> testPassRate = 50
      // Score = (50/100) * 70 + 30 = 35 + 30 = 65
      expect(result.testPassRate).toBe(50);
      expect(result.testsPassed).toBe(5);
      expect(result.testsFailed).toBe(5);
      expect(result.testsTotal).toBe(10);
      expect(result.score).toBe(65);
    });
  });

  describe("scoring: build failure penalty", () => {
    it("should penalize by 30 points when build fails (tests pass but build fails)", async () => {
      mockedDetectTestFramework.mockResolvedValue("vitest");
      mockedExeca.mockResolvedValue({
        stdout: " Tests  10 passed (10)",
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({
        success: false,
        errors: [{ file: "src/index.ts", line: 1, column: 1, message: "type error" }],
      });

      const result = await analyzer.analyze();

      // 100% pass rate -> (100/100) * 70 + (false ? 30 : 0) = 70 + 0 = 70
      expect(result.score).toBe(70);
      expect(result.buildSuccess).toBe(false);
      expect(result.buildErrors).toBe(1);
      expect(result.testPassRate).toBe(100);
    });
  });

  describe("scoring: no test framework detected", () => {
    it("should return score 0 when no test framework detected and build fails", async () => {
      mockedDetectTestFramework.mockResolvedValue(null);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: false, errors: [] });

      const result = await analyzer.analyze();

      // No tests (total=0), build fails -> score = 0
      expect(result.score).toBe(0);
      expect(result.testPassRate).toBe(0);
      expect(result.testsTotal).toBe(0);
      expect(result.testsPassed).toBe(0);
      expect(result.testsFailed).toBe(0);
    });

    it("should return score 30 when no test framework detected but build succeeds", async () => {
      mockedDetectTestFramework.mockResolvedValue(null);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      // No tests (total=0), build succeeds -> score = 30
      expect(result.score).toBe(30);
      expect(result.testPassRate).toBe(0);
      expect(result.buildSuccess).toBe(true);
    });
  });

  describe("vitest output parsing", () => {
    it("should parse vitest verbose output with passed, failed, and skipped", async () => {
      mockedDetectTestFramework.mockResolvedValue("vitest");
      mockedExeca.mockResolvedValue({
        stdout: " Tests  42 passed | 3 failed | 2 skipped (47)",
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      expect(result.testsPassed).toBe(42);
      expect(result.testsFailed).toBe(3);
      expect(result.testsSkipped).toBe(2);
      // total = passed + failed = 42 + 3 = 45 (skipped not counted in total)
      expect(result.testsTotal).toBe(45);
    });

    it("should parse vitest output with only passed tests", async () => {
      mockedDetectTestFramework.mockResolvedValue("vitest");
      mockedExeca.mockResolvedValue({
        stdout: " Tests  25 passed (25)",
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      expect(result.testsPassed).toBe(25);
      expect(result.testsFailed).toBe(0);
      expect(result.testsSkipped).toBe(0);
      expect(result.testsTotal).toBe(25);
      expect(result.score).toBe(100);
    });

    it("should parse vitest JSON format output as fallback", async () => {
      mockedDetectTestFramework.mockResolvedValue("vitest");
      const jsonOutput = JSON.stringify({
        numPassedTests: 15,
        numFailedTests: 5,
        numPendingTests: 1,
      });
      mockedExeca.mockResolvedValue({
        stdout: jsonOutput,
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      expect(result.testsPassed).toBe(15);
      expect(result.testsFailed).toBe(5);
      expect(result.testsSkipped).toBe(1);
      expect(result.testsTotal).toBe(20);
    });
  });

  describe("jest JSON output parsing", () => {
    it("should parse jest JSON output correctly", async () => {
      mockedDetectTestFramework.mockResolvedValue("jest");
      const jestJson = JSON.stringify({
        numPassedTests: 30,
        numFailedTests: 2,
        numPendingTests: 3,
      });
      mockedExeca.mockResolvedValue({
        stdout: jestJson,
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      expect(result.testsPassed).toBe(30);
      expect(result.testsFailed).toBe(2);
      expect(result.testsSkipped).toBe(3);
      expect(result.testsTotal).toBe(32);
      // passRate = 30/32 * 100 = 93.75
      // score = (93.75/100) * 70 + 30 = 65.625 + 30 = 95.625 -> round = 96
      expect(result.score).toBe(96);
    });

    it("should parse jest text format output as fallback", async () => {
      mockedDetectTestFramework.mockResolvedValue("jest");
      mockedExeca.mockResolvedValue({
        stdout: "Tests:  20 passed, 4 failed, 1 skipped, 25 total",
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      expect(result.testsPassed).toBe(20);
      expect(result.testsFailed).toBe(4);
      expect(result.testsSkipped).toBe(1);
      expect(result.testsTotal).toBe(24);
    });
  });

  describe("details string", () => {
    it("should include test count and build status in details", async () => {
      mockedDetectTestFramework.mockResolvedValue("vitest");
      mockedExeca.mockResolvedValue({
        stdout: " Tests  8 passed | 2 failed (10)",
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      expect(result.details).toContain("Tests: 8/10 passed");
      expect(result.details).toContain("2 failed");
      expect(result.details).toContain("Build: success");
    });

    it("should report 'No tests found' when no tests exist", async () => {
      mockedDetectTestFramework.mockResolvedValue(null);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      expect(result.details).toContain("No tests found");
      expect(result.details).toContain("Build: success");
    });
  });

  describe("edge cases", () => {
    it("should handle execa throwing an error gracefully", async () => {
      mockedDetectTestFramework.mockResolvedValue("vitest");
      mockedExeca.mockRejectedValue(new Error("Command not found"));

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      // execa error -> tests parse to all zeros -> total = 0 -> build passes
      expect(result.score).toBe(30);
      expect(result.testsTotal).toBe(0);
      expect(result.buildSuccess).toBe(true);
    });

    it("should handle build verifier throwing an error gracefully", async () => {
      mockedDetectTestFramework.mockResolvedValue("vitest");
      mockedExeca.mockResolvedValue({
        stdout: " Tests  10 passed (10)",
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockRejectedValue(new Error("tsc not found"));

      const result = await analyzer.analyze();

      // Tests pass (70 points), build fails (0 points from catch) -> 70
      expect(result.score).toBe(70);
      expect(result.buildSuccess).toBe(false);
    });

    it("should clamp score to 0-100 range", async () => {
      mockedDetectTestFramework.mockResolvedValue("vitest");
      mockedExeca.mockResolvedValue({
        stdout: " Tests  10 passed (10)",
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new CorrectnessAnalyzer("/fake/project");
      const bv = getMockedBuildVerifier();
      bv.verifyTypes.mockResolvedValue({ success: true, errors: [] });

      const result = await analyzer.analyze();

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });
});
