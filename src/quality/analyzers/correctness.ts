/**
 * Correctness Analyzer
 * Measures test pass rate and build success
 */

import { runQualityCommand as execa } from "../command.js";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { BuildVerifier, type BuildError } from "./build-verifier.js";
import { detectTestFramework, type TestFramework } from "./coverage.js";

/**
 * Resolve Maven or Gradle executable, preferring wrapper scripts.
 */
async function resolveJvmExecutable(
  projectPath: string,
  tool: "maven" | "gradle",
): Promise<string> {
  const wrapper = tool === "maven" ? "mvnw" : "gradlew";
  const fallback = tool === "maven" ? "mvn" : "gradle";
  try {
    await access(join(projectPath, wrapper));
    return join(projectPath, wrapper);
  } catch {
    return fallback;
  }
}

/**
 * Correctness analysis result
 */
export interface CorrectnessResult {
  score: number;
  testPassRate: number;
  buildSuccess: boolean;
  buildAvailable?: boolean;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  testsTotal: number;
  buildErrors: number;
  details: string;
}

/** Reject malformed reporter counts before they can become a passing rate. */
function validateCounts(
  counts: { passed: number; failed: number; skipped: number },
  reportedTotal?: unknown,
): typeof counts {
  const values = [counts.passed, counts.failed, counts.skipped];
  const total = values.reduce((sum, value) => sum + value, 0);
  if (
    !values.every((value) => Number.isSafeInteger(value) && value >= 0) ||
    !Number.isSafeInteger(total) ||
    (reportedTotal !== undefined &&
      (!Number.isSafeInteger(reportedTotal) || reportedTotal !== total))
  )
    throw new Error("Invalid or inconsistent test counts");
  return counts;
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
    return validateCounts(
      {
        passed: json.numPassedTests ?? 0,
        failed: json.numFailedTests ?? 0,
        skipped: (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0),
      },
      json.numTotalTests,
    );
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
    return validateCounts(
      {
        passed: json.numPassedTests ?? 0,
        failed: json.numFailedTests ?? 0,
        skipped: (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0),
      },
      json.numTotalTests,
    );
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
      return { command: "npx", args: ["--no-install", "vitest", "run", "--reporter=verbose"] };
    case "jest":
      return { command: "npx", args: ["--no-install", "jest", "--json"] };
    case "mocha":
      return { command: "npx", args: ["--no-install", "mocha", "--reporter=json"] };
    case "maven":
      // Executable resolved asynchronously in runTests() before this is called
      return { command: "__maven__", args: ["test", "--no-transfer-progress", "-B"] };
    case "gradle":
      return { command: "__gradle__", args: ["test"] };
    default:
      return null;
  }
}

/**
 * Parse Maven Surefire output: "Tests run: X, Failures: Y, Errors: Z, Skipped: W"
 */
function parseMavenOutput(output: string): { passed: number; failed: number; skipped: number } {
  let passed = 0,
    failed = 0,
    skipped = 0;

  const pattern =
    /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/gi;
  for (const match of output.matchAll(pattern)) {
    const total = parseInt(match[1] ?? "0", 10);
    const failures = parseInt(match[2] ?? "0", 10);
    const errors = parseInt(match[3] ?? "0", 10);
    const skip = parseInt(match[4] ?? "0", 10);
    const f = failures + errors;
    passed += total - f - skip;
    failed += f;
    skipped += skip;
  }

  return { passed, failed, skipped };
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
  async analyze(certify = false): Promise<CorrectnessResult> {
    const work = [
      this.runTests(),
      (certify
        ? this.buildVerifier.verifyTypesForQuality()
        : this.buildVerifier.verifyTypes()
      ).catch(() => ({
        success: false,
        errors: [] as BuildError[],
        stdout: "Build verification failed",
      })),
    ] as const;
    await Promise.allSettled(work);
    const [testResult, buildResult] = await Promise.all(work);

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
      buildAvailable: buildResult.stdout !== "No tsconfig.json found",
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

    // Resolve JVM wrapper executables asynchronously
    if (cmd.command === "__maven__") {
      cmd.command = await resolveJvmExecutable(this.projectPath, "maven");
    } else if (cmd.command === "__gradle__") {
      cmd.command = await resolveJvmExecutable(this.projectPath, "gradle");
    }

    try {
      const proc = execa(cmd.command, cmd.args, {
        cwd: this.projectPath,
        reject: false,
        timeout: 300000, // 5 minutes
        cleanup: true, // kill process tree on parent exit
      });
      const result = await proc;

      const output = (result.stdout ?? "") + "\n" + (result.stderr ?? "");

      const parseResults = () => {
        switch (framework) {
          case "vitest":
            return parseVitestOutput(output);
          case "jest":
            return parseJestOutput(result.stdout ?? "");
          case "mocha": {
            try {
              const json = JSON.parse(result.stdout ?? "");
              return {
                passed: json.stats?.passes ?? 0,
                failed: json.stats?.failures ?? 0,
                skipped: json.stats?.pending ?? 0,
              };
            } catch {
              return { passed: 0, failed: 0, skipped: 0 };
            }
          }
          case "maven":
          case "gradle":
            return parseMavenOutput(output);
          default:
            return { passed: 0, failed: 0, skipped: 0 };
        }
      };
      const parsed = validateCounts(parseResults());
      if (result.exitCode !== 0 && !(result.exitCode === 1 && parsed.failed > 0))
        throw new Error("Test process failed");
      return parsed;
    } catch {
      throw new Error("Correctness test execution failed");
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
