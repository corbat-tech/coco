/**
 * Real Test Coverage Analyzer for Corbat-Coco
 * Integrates with c8/nyc to measure actual coverage (not estimates)
 */

import { execa } from "execa";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";

/**
 * Coverage metrics for a single metric type (lines, branches, etc.)
 */
export interface CoverageMetric {
  total: number;
  covered: number;
  skipped: number;
  percentage: number;
}

/**
 * Complete coverage metrics
 */
export interface CoverageMetrics {
  lines: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
  statements: CoverageMetric;
}

/**
 * Test framework types
 */
export type TestFramework = "vitest" | "jest" | "mocha" | null;

/**
 * Detect test framework in project
 */
export async function detectTestFramework(projectPath: string): Promise<TestFramework> {
  try {
    const pkgPath = join(projectPath, "package.json");
    const pkgContent = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    // Check in priority order
    if (deps.vitest || deps["@vitest/coverage-v8"]) return "vitest";
    if (deps.jest || deps["@jest/core"]) return "jest";
    if (deps.mocha) return "mocha";

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if coverage tool is installed
 */
export async function detectCoverageTool(projectPath: string): Promise<"c8" | "nyc" | null> {
  try {
    const pkgPath = join(projectPath, "package.json");
    const pkgContent = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    // Vitest uses c8 (via @vitest/coverage-v8)
    if (deps["@vitest/coverage-v8"] || deps.c8) return "c8";
    if (deps.nyc) return "nyc";

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse c8/nyc coverage-summary.json format
 */
function parseCoverageSummary(report: any): CoverageMetrics {
  const total = report.total;

  return {
    lines: {
      total: total.lines.total || 0,
      covered: total.lines.covered || 0,
      skipped: total.lines.skipped || 0,
      percentage: total.lines.pct || 0,
    },
    branches: {
      total: total.branches.total || 0,
      covered: total.branches.covered || 0,
      skipped: total.branches.skipped || 0,
      percentage: total.branches.pct || 0,
    },
    functions: {
      total: total.functions.total || 0,
      covered: total.functions.covered || 0,
      skipped: total.functions.skipped || 0,
      percentage: total.functions.pct || 0,
    },
    statements: {
      total: total.statements.total || 0,
      covered: total.statements.covered || 0,
      skipped: total.statements.skipped || 0,
      percentage: total.statements.pct || 0,
    },
  };
}

/**
 * Real Coverage Analyzer - Measures actual test coverage
 */
export class CoverageAnalyzer {
  constructor(private projectPath: string) {}

  /**
   * Analyze coverage by running tests with coverage enabled
   */
  async analyze(): Promise<CoverageMetrics> {
    const framework = await detectTestFramework(this.projectPath);
    const coverageTool = await detectCoverageTool(this.projectPath);

    if (!framework) {
      throw new Error("No test framework detected (vitest, jest, or mocha)");
    }

    // Try to read existing coverage report first
    const existingCoverage = await this.readExistingCoverage();
    if (existingCoverage) {
      return existingCoverage;
    }

    // Run tests with coverage
    return await this.runWithCoverage(framework, coverageTool);
  }

  /**
   * Read existing coverage report if available
   */
  private async readExistingCoverage(): Promise<CoverageMetrics | null> {
    const possiblePaths = [
      join(this.projectPath, "coverage", "coverage-summary.json"),
      join(this.projectPath, ".coverage", "coverage-summary.json"),
      join(this.projectPath, "coverage", "lcov-report", "coverage-summary.json"),
    ];

    for (const path of possiblePaths) {
      try {
        await access(path, constants.R_OK);
        const content = await readFile(path, "utf-8");
        const report = JSON.parse(content);
        return parseCoverageSummary(report);
      } catch {
        // Try next path
      }
    }

    return null;
  }

  /**
   * Run tests with coverage enabled
   */
  private async runWithCoverage(
    framework: TestFramework,
    coverageTool: "c8" | "nyc" | null,
  ): Promise<CoverageMetrics> {
    if (framework === null) {
      throw new Error("Framework is null");
    }

    const commands = this.buildCoverageCommand(framework, coverageTool);

    try {
      // Run tests with coverage
      const result = await execa(commands.command, commands.args, {
        cwd: this.projectPath,
        reject: false,
        timeout: 120000, // 2 minutes
      });

      // Check if tests failed
      if (result.exitCode !== 0 && !result.stdout.includes("coverage")) {
        throw new Error(`Tests failed: ${result.stderr || result.stdout}`);
      }

      // Read coverage report
      const reportPath = join(this.projectPath, "coverage", "coverage-summary.json");
      const report = JSON.parse(await readFile(reportPath, "utf-8"));

      return parseCoverageSummary(report);
    } catch (error) {
      throw new Error(
        `Coverage analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Build coverage command based on framework and tool
   */
  private buildCoverageCommand(
    framework: TestFramework,
    coverageTool: "c8" | "nyc" | null,
  ): { command: string; args: string[] } {
    switch (framework) {
      case "vitest":
        return {
          command: "npx",
          args: ["vitest", "run", "--coverage"],
        };

      case "jest":
        return {
          command: "npx",
          args: ["jest", "--coverage", "--coverageReporters=json-summary"],
        };

      case "mocha":
        if (coverageTool === "c8") {
          return {
            command: "npx",
            args: ["c8", "--reporter=json-summary", "mocha"],
          };
        } else if (coverageTool === "nyc") {
          return {
            command: "npx",
            args: ["nyc", "--reporter=json-summary", "mocha"],
          };
        }
        throw new Error("Mocha requires c8 or nyc for coverage");

      default:
        throw new Error(`Unsupported framework: ${framework}`);
    }
  }
}

/**
 * Create coverage analyzer instance
 */
export function createCoverageAnalyzer(projectPath: string): CoverageAnalyzer {
  return new CoverageAnalyzer(projectPath);
}
