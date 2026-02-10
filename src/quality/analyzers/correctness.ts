/**
 * Correctness Analyzer
 * Measures test pass rate and build success
 */

import { execa } from "execa";
import { BuildVerifier, type BuildError } from "./build-verifier.js";
import { detectTestFramework, type TestFramework } from "./coverage.js";

/**
 * Correctness analysis result
 */
export interface CorrectnessResult {
  score: number;
  testPassRate: number;
  buildSuccess: boolean;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  testsTotal: number;
  buildErrors: number;
  details: string;
}

/**
 * Parse vitest JSON reporter output
 */
function parseVitestOutput(stdout: string): { passed: number; failed: number; skipped: number } {
  // Vitest outputs lines like: "Tests  42 passed | 3 failed | 2 skipped (47)"
  const testsMatch = stdout.match(
    /Tests\s+(?:(\d+)\s+passed)?(?:\s*\|\s*(\d+)\s+failed)?(?:\s*\|\s*(\d+)\s+skipped)?/,
  );
  if (testsMatch) {
    return {
      passed: parseInt(testsMatch[1] || "0", 10),
      failed: parseInt(testsMatch[2] || "0", 10),
      skipped: parseInt(testsMatch[3] || "0", 10),
    };
  }

  // Try JSON format
  try {
    const json = JSON.parse(stdout);
    return {
      passed: json.numPassedTests ?? 0,
      failed: json.numFailedTests ?? 0,
      skipped: json.numPendingTests ?? 0,
    };
  } catch {
    // Fallback: no parseable output
  }

  return { passed: 0, failed: 0, skipped: 0 };
}

/**
 * Parse jest JSON reporter output
 */
function parseJestOutput(stdout: string): { passed: number; failed: number; skipped: number } {
  try {
    const json = JSON.parse(stdout);
    return {
      passed: json.numPassedTests ?? 0,
      failed: json.numFailedTests ?? 0,
      skipped: json.numPendingTests ?? 0,
    };
  } catch {
    // Try text format: "Tests:  42 passed, 3 failed, 2 skipped, 47 total"
    const match = stdout.match(
      /Tests:\s+(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?/,
    );
    if (match) {
      return {
        passed: parseInt(match[1] || "0", 10),
        failed: parseInt(match[2] || "0", 10),
        skipped: parseInt(match[3] || "0", 10),
      };
    }
  }

  return { passed: 0, failed: 0, skipped: 0 };
}

/**
 * Build test command for framework
 */
function buildTestCommand(framework: TestFramework): { command: string; args: string[] } | null {
  switch (framework) {
    case "vitest":
      return { command: "npx", args: ["vitest", "run", "--reporter=verbose"] };
    case "jest":
      return { command: "npx", args: ["jest", "--json"] };
    case "mocha":
      return { command: "npx", args: ["mocha", "--reporter=json"] };
    default:
      return null;
  }
}

/**
 * Correctness Analyzer
 */
export class CorrectnessAnalyzer {
  private buildVerifier: BuildVerifier;

  constructor(private projectPath: string) {
    this.buildVerifier = new BuildVerifier(projectPath);
  }

  /**
   * Analyze correctness by running tests and verifying build
   */
  async analyze(): Promise<CorrectnessResult> {
    const [testResult, buildResult] = await Promise.all([
      this.runTests(),
      this.buildVerifier
        .verifyTypes()
        .catch(() => ({ success: false, errors: [] as BuildError[] })),
    ]);

    const total = testResult.passed + testResult.failed;
    const testPassRate = total > 0 ? (testResult.passed / total) * 100 : 0;
    const buildSuccess = buildResult.success;

    // Score: 70% test pass rate + 30% build success
    let score: number;
    if (total === 0 && !buildSuccess) {
      score = 0;
    } else if (total === 0) {
      // No tests but build passes
      score = 30;
    } else {
      score = (testPassRate / 100) * 70 + (buildSuccess ? 30 : 0);
    }

    score = Math.round(Math.max(0, Math.min(100, score)));

    const details = this.buildDetails(testResult, buildSuccess, testPassRate, total);

    return {
      score,
      testPassRate,
      buildSuccess,
      testsPassed: testResult.passed,
      testsFailed: testResult.failed,
      testsSkipped: testResult.skipped,
      testsTotal: total,
      buildErrors: buildResult.errors?.length ?? 0,
      details,
    };
  }

  /**
   * Run tests and parse results
   */
  private async runTests(): Promise<{ passed: number; failed: number; skipped: number }> {
    const framework = await detectTestFramework(this.projectPath);
    if (!framework) {
      return { passed: 0, failed: 0, skipped: 0 };
    }

    const cmd = buildTestCommand(framework);
    if (!cmd) {
      return { passed: 0, failed: 0, skipped: 0 };
    }

    try {
      const result = await execa(cmd.command, cmd.args, {
        cwd: this.projectPath,
        reject: false,
        timeout: 300000, // 5 minutes
      });

      const output = result.stdout + "\n" + result.stderr;

      switch (framework) {
        case "vitest":
          return parseVitestOutput(output);
        case "jest":
          return parseJestOutput(result.stdout);
        case "mocha": {
          try {
            const json = JSON.parse(result.stdout);
            return {
              passed: json.stats?.passes ?? 0,
              failed: json.stats?.failures ?? 0,
              skipped: json.stats?.pending ?? 0,
            };
          } catch {
            return { passed: 0, failed: 0, skipped: 0 };
          }
        }
        default:
          return { passed: 0, failed: 0, skipped: 0 };
      }
    } catch {
      return { passed: 0, failed: 0, skipped: 0 };
    }
  }

  private buildDetails(
    testResult: { passed: number; failed: number; skipped: number },
    buildSuccess: boolean,
    testPassRate: number,
    total: number,
  ): string {
    const parts: string[] = [];
    if (total > 0) {
      parts.push(`Tests: ${testResult.passed}/${total} passed (${testPassRate.toFixed(1)}%)`);
      if (testResult.failed > 0) {
        parts.push(`${testResult.failed} failed`);
      }
    } else {
      parts.push("No tests found");
    }
    parts.push(`Build: ${buildSuccess ? "success" : "failed"}`);
    return parts.join(", ");
  }
}

/**
 * Create correctness analyzer instance
 */
export function createCorrectnessAnalyzer(projectPath: string): CorrectnessAnalyzer {
  return new CorrectnessAnalyzer(projectPath);
}
