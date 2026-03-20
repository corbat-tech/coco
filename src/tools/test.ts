/**
 * Test tools for Corbat-Coco
 * Run tests and collect coverage
 */

import { z } from "zod";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";
import { trackSubprocess } from "../utils/subprocess-registry.js";

/**
 * Test result interface
 */
export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
  success: boolean;
  failures: TestFailure[];
  coverage?: CoverageResult;
}

/**
 * Test failure interface
 */
export interface TestFailure {
  name: string;
  file: string;
  message: string;
  stack?: string;
}

/**
 * Coverage result interface
 */
export interface CoverageResult {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

/**
 * Detect test framework in project
 */
async function detectTestFramework(cwd: string): Promise<string | null> {
  // Check for JVM build files first (Maven / Gradle)
  try {
    await fs.access(path.join(cwd, "pom.xml"));
    return "maven";
  } catch {
    // not Maven
  }

  for (const gradleFile of ["build.gradle", "build.gradle.kts"]) {
    try {
      await fs.access(path.join(cwd, gradleFile));
      return "gradle";
    } catch {
      // not Gradle
    }
  }

  // Check Node.js package.json
  try {
    const pkgPath = path.join(cwd, "package.json");
    const pkgContent = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (deps.vitest) return "vitest";
    if (deps.jest) return "jest";
    if (deps.mocha) return "mocha";
    if (deps.ava) return "ava";

    return null;
  } catch {
    return null;
  }
}

/**
 * Convert a file glob pattern to a Maven -Dtest= filter.
 * e.g. "path/ItemRestControllerIT.java" becomes "ItemRestControllerIT"
 */
function toMavenTestFilter(pattern: string): string {
  // Strip path and extension
  const base = path.basename(pattern).replace(/\.java$/, "");
  return base;
}

/**
 * Convert a file glob pattern to a Gradle --tests filter.
 * e.g. "path/ItemRestControllerIT.java" becomes "*ItemRestControllerIT"
 */
function toGradleTestFilter(pattern: string): string {
  const base = path.basename(pattern).replace(/\.java$/, "");
  return `*${base}`;
}

/**
 * Detect the Maven wrapper or fall back to system mvn
 */
async function mavenExecutable(cwd: string): Promise<string> {
  try {
    await fs.access(path.join(cwd, "mvnw"));
    return "./mvnw";
  } catch {
    return "mvn";
  }
}

/**
 * Detect the Gradle wrapper or fall back to system gradle
 */
async function gradleExecutable(cwd: string): Promise<string> {
  try {
    await fs.access(path.join(cwd, "gradlew"));
    return "./gradlew";
  } catch {
    return "gradle";
  }
}

/**
 * Run tests tool
 */
export const runTestsTool: ToolDefinition<
  {
    cwd?: string;
    pattern?: string;
    coverage?: boolean;
    framework?: string;
    watch?: boolean;
    args?: string[];
  },
  TestResult
> = defineTool({
  name: "run_tests",
  description: `Run tests in the project (auto-detects Maven/Gradle/JUnit, vitest, jest, or mocha).

Examples:
- Run all tests: {}
- With coverage: { "coverage": true }
- Specific pattern (JS): { "pattern": "src/**/*.test.ts" }
- Specific test class (Java): { "pattern": "**/ItemRestControllerIT.java" }
- Specific framework: { "framework": "maven" }
- Maven module: { "framework": "maven", "args": ["-pl", "stock-core"] }`,
  category: "test",
  parameters: z.object({
    cwd: z.string().optional().describe("Project directory"),
    pattern: z.string().optional().describe("Test file pattern or class glob"),
    coverage: z.boolean().optional().default(false).describe("Collect coverage"),
    framework: z
      .string()
      .optional()
      .describe("Test framework (maven, gradle, vitest, jest, mocha)"),
    watch: z.boolean().optional().default(false).describe("Watch mode"),
    args: z.array(z.string()).optional().describe("Extra arguments (e.g. Maven -pl module)"),
  }),
  async execute({ cwd, pattern, coverage, framework, watch, args: extraArgs }) {
    const projectDir = cwd ?? process.cwd();
    const detectedFramework = framework ?? (await detectTestFramework(projectDir));

    if (!detectedFramework) {
      throw new ToolError(
        "No test framework detected. For Java projects ensure pom.xml or build.gradle exists. For Node.js projects install vitest, jest, or mocha.",
        { tool: "run_tests" },
      );
    }

    const startTime = performance.now();

    try {
      const args: string[] = [];
      let command = "npx";

      switch (detectedFramework) {
        case "maven": {
          command = await mavenExecutable(projectDir);
          // "verify" runs the full lifecycle including integration tests and jacoco
          args.push(coverage ? "verify" : "test");
          if (extraArgs && extraArgs.length > 0) args.push(...extraArgs);
          if (pattern) args.push(`-Dtest=${toMavenTestFilter(pattern)}`);
          break;
        }

        case "gradle": {
          command = await gradleExecutable(projectDir);
          args.push("test");
          if (extraArgs && extraArgs.length > 0) args.push(...extraArgs);
          if (pattern) args.push("--tests", toGradleTestFilter(pattern));
          if (coverage) args.push("jacocoTestReport");
          break;
        }

        case "vitest":
          args.push("vitest", "run");
          if (coverage) args.push("--coverage");
          if (pattern) args.push(pattern);
          if (watch) args.splice(1, 1); // Remove 'run' for watch mode
          args.push("--reporter=json");
          break;

        case "jest":
          args.push("jest");
          if (coverage) args.push("--coverage");
          if (pattern) args.push(pattern);
          if (watch) args.push("--watch");
          args.push("--json");
          break;

        case "mocha":
          args.push("mocha");
          if (pattern) args.push(pattern);
          args.push("--reporter", "json");
          break;

        default:
          throw new ToolError(`Unsupported test framework: ${detectedFramework}`, {
            tool: "run_tests",
          });
      }

      const proc = execa(command, args, {
        cwd: projectDir,
        reject: false,
        timeout: 300000, // 5 minute timeout
        cleanup: true, // kill process tree on parent exit
      });
      trackSubprocess(proc);
      const result = await proc;

      const duration = performance.now() - startTime;

      // Parse results based on framework
      return parseTestResults(
        detectedFramework,
        result.stdout ?? "",
        result.stderr ?? "",
        result.exitCode ?? 0,
        duration,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ToolError(
        `Test execution failed: ${msg}. Use command_exists to verify the test framework is installed, or run_script with a custom command.`,
        { tool: "run_tests", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Parse test results from framework output
 */
function parseTestResults(
  framework: string,
  stdout: string,
  stderr: string,
  exitCode: number,
  duration: number,
): TestResult {
  // Try to parse JSON output (vitest/jest)
  if (framework === "vitest" || framework === "jest") {
    try {
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        return parseJestLikeResults(json, duration);
      }
    } catch {
      // Fall back to basic parsing
    }
  }

  // Maven Surefire: "Tests run: 5, Failures: 0, Errors: 0, Skipped: 1"
  const mavenMatch = stdout.match(
    /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i,
  );
  if (mavenMatch) {
    const total = parseInt(mavenMatch[1] ?? "0", 10);
    const failures = parseInt(mavenMatch[2] ?? "0", 10);
    const errors = parseInt(mavenMatch[3] ?? "0", 10);
    const skipped = parseInt(mavenMatch[4] ?? "0", 10);
    const failed = failures + errors;
    return {
      passed: total - failed - skipped,
      failed,
      skipped,
      total,
      duration,
      success: exitCode === 0,
      failures: failed > 0 ? parseFailuresFromOutput(stderr || stdout) : [],
    };
  }

  // Basic parsing from output
  const passMatch = stdout.match(/(\d+)\s*(?:passed|passing|tests\s+run)/i);
  const failMatch = stdout.match(/(\d+)\s*(?:failed|failing|failures)/i);
  const skipMatch = stdout.match(/(\d+)\s*(?:skipped|pending)/i);

  const passed = passMatch ? parseInt(passMatch[1] ?? "0", 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1] ?? "0", 10) : 0;
  const skipped = skipMatch ? parseInt(skipMatch[1] ?? "0", 10) : 0;

  return {
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    duration,
    success: exitCode === 0,
    failures: failed > 0 ? parseFailuresFromOutput(stderr || stdout) : [],
  };
}

/**
 * Parse Jest/Vitest-like JSON results
 */
function parseJestLikeResults(
  json: {
    numPassedTests?: number;
    numFailedTests?: number;
    numPendingTests?: number;
    testResults?: Array<{
      assertionResults?: Array<{
        title?: string;
        status?: string;
        failureMessages?: string[];
      }>;
    }>;
  },
  duration: number,
): TestResult {
  const passed = json.numPassedTests ?? 0;
  const failed = json.numFailedTests ?? 0;
  const skipped = json.numPendingTests ?? 0;

  const failures: TestFailure[] = [];

  if (json.testResults) {
    for (const suite of json.testResults) {
      if (suite.assertionResults) {
        for (const test of suite.assertionResults) {
          if (test.status === "failed" && test.failureMessages) {
            failures.push({
              name: test.title ?? "Unknown test",
              file: "",
              message: test.failureMessages.join("\n"),
            });
          }
        }
      }
    }
  }

  return {
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    duration,
    success: failed === 0,
    failures,
  };
}

/**
 * Parse failures from raw output
 */
function parseFailuresFromOutput(output: string): TestFailure[] {
  const failures: TestFailure[] = [];

  // Try to find failure patterns
  const failureMatches = output.matchAll(/(?:FAIL|Error|AssertionError)[\s:]+(.+?)(?:\n|$)/gi);

  for (const match of failureMatches) {
    failures.push({
      name: "Test failure",
      file: "",
      message: match[1] ?? "Unknown error",
    });
  }

  return failures;
}

/**
 * Parse a JaCoCo jacoco.csv file and return percentage metrics.
 * Returns null if the CSV has no usable data.
 */
function parseJacocoCsvCoverage(csv: string): CoverageResult | null {
  const lines = csv.trim().split("\n").slice(1); // skip header
  if (lines.length === 0) return null;

  let lineMissed = 0,
    lineCovered = 0;
  let branchMissed = 0,
    branchCovered = 0;
  let methodMissed = 0,
    methodCovered = 0;
  let instrMissed = 0,
    instrCovered = 0;

  for (const line of lines) {
    const cols = line.split(",");
    if (cols.length < 13) continue;
    instrMissed += parseInt(cols[3] ?? "0", 10);
    instrCovered += parseInt(cols[4] ?? "0", 10);
    branchMissed += parseInt(cols[5] ?? "0", 10);
    branchCovered += parseInt(cols[6] ?? "0", 10);
    lineMissed += parseInt(cols[7] ?? "0", 10);
    lineCovered += parseInt(cols[8] ?? "0", 10);
    methodMissed += parseInt(cols[11] ?? "0", 10);
    methodCovered += parseInt(cols[12] ?? "0", 10);
  }

  if (lineCovered + lineMissed === 0) return null;

  const pct = (covered: number, missed: number) => {
    const total = covered + missed;
    return total > 0 ? Math.round((covered / total) * 1000) / 10 : 0;
  };

  return {
    lines: pct(lineCovered, lineMissed),
    branches: pct(branchCovered, branchMissed),
    functions: pct(methodCovered, methodMissed),
    statements: pct(instrCovered, instrMissed),
  };
}

/**
 * Get coverage tool
 */
export const getCoverageTool: ToolDefinition<
  { cwd?: string; format?: "summary" | "detailed" },
  CoverageResult & { report?: string }
> = defineTool({
  name: "get_coverage",
  description: `Get test coverage report (requires running tests with --coverage first).

Examples:
- Summary: {} → { "lines": 85.5, "branches": 72.3, "functions": 90.1, "statements": 84.2 }
- Detailed: { "format": "detailed" }`,
  category: "test",
  parameters: z.object({
    cwd: z.string().optional().describe("Project directory"),
    format: z.enum(["summary", "detailed"]).optional().default("summary").describe("Report format"),
  }),
  async execute({ cwd, format }) {
    const projectDir = cwd ?? process.cwd();

    try {
      // Try to read coverage from common locations (Node.js and JaCoCo/Maven/Gradle)
      const coverageLocations = [
        path.join(projectDir, "coverage", "coverage-summary.json"),
        path.join(projectDir, "coverage", "coverage-final.json"),
        path.join(projectDir, ".nyc_output", "coverage-summary.json"),
        // Maven JaCoCo
        path.join(projectDir, "target", "site", "jacoco", "jacoco.csv"),
        path.join(projectDir, "target", "site", "jacoco-ut", "jacoco.csv"),
        // Gradle JaCoCo
        path.join(projectDir, "build", "reports", "jacoco", "test", "jacocoTestReport.csv"),
      ];

      for (const location of coverageLocations) {
        try {
          const content = await fs.readFile(location, "utf-8");

          // JaCoCo CSV format
          if (location.endsWith(".csv")) {
            const result = parseJacocoCsvCoverage(content);
            if (result) {
              return { ...result, report: format === "detailed" ? content : undefined };
            }
            continue;
          }

          // Node.js JSON format
          const coverage = JSON.parse(content) as {
            total?: {
              lines?: { pct?: number };
              branches?: { pct?: number };
              functions?: { pct?: number };
              statements?: { pct?: number };
            };
          };

          if (coverage.total) {
            return {
              lines: coverage.total.lines?.pct ?? 0,
              branches: coverage.total.branches?.pct ?? 0,
              functions: coverage.total.functions?.pct ?? 0,
              statements: coverage.total.statements?.pct ?? 0,
              report: format === "detailed" ? content : undefined,
            };
          }
        } catch {
          // Try next location
        }
      }

      throw new ToolError(
        "Coverage data not found. For Maven projects run 'mvn verify' with JaCoCo plugin. For Node.js run tests with --coverage.",
        { tool: "get_coverage" },
      );
    } catch (error) {
      if (error instanceof ToolError) throw error;

      const msg = error instanceof Error ? error.message : String(error);
      throw new ToolError(
        `Failed to read coverage: ${msg}. Run run_tests with coverage: true first to generate coverage data.`,
        { tool: "get_coverage", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Run single test file tool
 */
export const runTestFileTool: ToolDefinition<
  { cwd?: string; file: string; framework?: string; args?: string[] },
  TestResult
> = defineTool({
  name: "run_test_file",
  description: `Run tests in a specific file.

Examples:
- Single file: { "file": "src/utils.test.ts" }
- Java test: { "file": "**/ItemRestControllerIT.java" }
- With framework: { "file": "test/app.spec.js", "framework": "jest" }
- Maven module: { "file": "**/MyTest.java", "args": ["-pl", "my-module"] }`,
  category: "test",
  parameters: z.object({
    cwd: z.string().optional().describe("Project directory"),
    file: z.string().describe("Test file path or class glob"),
    framework: z
      .string()
      .optional()
      .describe("Test framework (maven, gradle, vitest, jest, mocha)"),
    args: z.array(z.string()).optional().describe("Extra arguments (e.g. Maven -pl module)"),
  }),
  async execute({ cwd, file, framework, args }) {
    // Delegate to run_tests with the file as pattern
    return runTestsTool.execute({
      cwd,
      pattern: file,
      coverage: false,
      framework,
      watch: false,
      args,
    });
  },
});

/**
 * All test tools
 */
export const testTools = [runTestsTool, getCoverageTool, runTestFileTool];
