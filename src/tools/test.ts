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

    // Check for common test frameworks
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
 * Run tests tool
 */
export const runTestsTool: ToolDefinition<
  {
    cwd?: string;
    pattern?: string;
    coverage?: boolean;
    framework?: string;
    watch?: boolean;
  },
  TestResult
> = defineTool({
  name: "run_tests",
  description: `Run tests in the project (auto-detects vitest, jest, or mocha).

Examples:
- Run all tests: {}
- With coverage: { "coverage": true }
- Specific pattern: { "pattern": "src/**/*.test.ts" }
- Specific framework: { "framework": "vitest" }`,
  category: "test",
  parameters: z.object({
    cwd: z.string().optional().describe("Project directory"),
    pattern: z.string().optional().describe("Test file pattern"),
    coverage: z.boolean().optional().default(false).describe("Collect coverage"),
    framework: z.string().optional().describe("Test framework (vitest, jest, mocha)"),
    watch: z.boolean().optional().default(false).describe("Watch mode"),
  }),
  async execute({ cwd, pattern, coverage, framework, watch }) {
    const projectDir = cwd ?? process.cwd();
    const detectedFramework = framework ?? (await detectTestFramework(projectDir));

    if (!detectedFramework) {
      throw new ToolError("No test framework detected. Install vitest, jest, or mocha.", {
        tool: "run_tests",
      });
    }

    const startTime = performance.now();

    try {
      const args: string[] = [];
      let command = "npx";

      switch (detectedFramework) {
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

      const result = await execa(command, args, {
        cwd: projectDir,
        reject: false,
        timeout: 300000, // 5 minute timeout
      });

      const duration = performance.now() - startTime;

      // Parse results based on framework
      return parseTestResults(
        detectedFramework,
        result.stdout,
        result.stderr,
        result.exitCode ?? 0,
        duration
      );
    } catch (error) {
      throw new ToolError(
        `Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "run_tests", cause: error instanceof Error ? error : undefined }
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
  duration: number
): TestResult {
  // Try to parse JSON output
  try {
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const json = JSON.parse(jsonMatch[0]);

      if (framework === "vitest" || framework === "jest") {
        return parseJestLikeResults(json, duration);
      }
    }
  } catch {
    // Fall back to basic parsing
  }

  // Basic parsing from output
  const passMatch = stdout.match(/(\d+)\s*(?:passed|passing)/i);
  const failMatch = stdout.match(/(\d+)\s*(?:failed|failing)/i);
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
  duration: number
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
      // Try to read coverage from common locations
      const coverageLocations = [
        path.join(projectDir, "coverage", "coverage-summary.json"),
        path.join(projectDir, "coverage", "coverage-final.json"),
        path.join(projectDir, ".nyc_output", "coverage-summary.json"),
      ];

      for (const location of coverageLocations) {
        try {
          const content = await fs.readFile(location, "utf-8");
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

      throw new ToolError("Coverage data not found. Run tests with --coverage first.", {
        tool: "get_coverage",
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;

      throw new ToolError(
        `Failed to read coverage: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "get_coverage", cause: error instanceof Error ? error : undefined }
      );
    }
  },
});

/**
 * Run single test file tool
 */
export const runTestFileTool: ToolDefinition<
  { cwd?: string; file: string; framework?: string },
  TestResult
> = defineTool({
  name: "run_test_file",
  description: `Run tests in a specific file.

Examples:
- Single file: { "file": "src/utils.test.ts" }
- With framework: { "file": "test/app.spec.js", "framework": "jest" }`,
  category: "test",
  parameters: z.object({
    cwd: z.string().optional().describe("Project directory"),
    file: z.string().describe("Test file path"),
    framework: z.string().optional().describe("Test framework"),
  }),
  async execute({ cwd, file, framework }) {
    // Delegate to run_tests with the file as pattern
    return runTestsTool.execute({
      cwd,
      pattern: file,
      coverage: false,
      framework,
      watch: false,
    });
  },
});

/**
 * All test tools
 */
export const testTools = [runTestsTool, getCoverageTool, runTestFileTool];
