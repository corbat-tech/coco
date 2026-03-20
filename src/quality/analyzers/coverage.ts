/**
 * Real Test Coverage Analyzer for Corbat-Coco
 * Integrates with c8/nyc to measure actual coverage (not estimates)
 */

import { execa } from "execa";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import { trackSubprocess } from "../../utils/subprocess-registry.js";

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
export type TestFramework = "vitest" | "jest" | "mocha" | "maven" | "gradle" | null;

/**
 * Detect test framework in project
 * Checks JVM build files first, then Node.js package.json
 */
export async function detectTestFramework(projectPath: string): Promise<TestFramework> {
  // JVM projects take priority
  try {
    await access(join(projectPath, "pom.xml"), constants.R_OK);
    return "maven";
  } catch {
    // not Maven
  }

  for (const f of ["build.gradle", "build.gradle.kts"]) {
    try {
      await access(join(projectPath, f), constants.R_OK);
      return "gradle";
    } catch {
      // not Gradle
    }
  }

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

/** Shape of a single metric in the coverage-summary.json total section */
interface CoverageSummaryMetric {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

/** Shape of the coverage-summary.json report */
interface CoverageSummaryReport {
  total: {
    lines: CoverageSummaryMetric;
    branches: CoverageSummaryMetric;
    functions: CoverageSummaryMetric;
    statements: CoverageSummaryMetric;
  };
}

/**
 * Parse c8/nyc coverage-summary.json format
 */
function parseCoverageSummary(report: CoverageSummaryReport): CoverageMetrics {
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
 * Parse JaCoCo jacoco.csv report into CoverageMetrics.
 * CSV columns: GROUP,PACKAGE,CLASS,INSTRUCTION_MISSED,INSTRUCTION_COVERED,
 *              BRANCH_MISSED,BRANCH_COVERED,LINE_MISSED,LINE_COVERED,
 *              COMPLEXITY_MISSED,COMPLEXITY_COVERED,METHOD_MISSED,METHOD_COVERED
 */
function parseJacocoCsv(csv: string): CoverageMetrics {
  const lines = csv.trim().split("\n").slice(1); // skip header

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

  const pct = (covered: number, missed: number) => {
    const total = covered + missed;
    return total > 0 ? Math.round((covered / total) * 1000) / 10 : 0;
  };

  return {
    lines: {
      total: lineCovered + lineMissed,
      covered: lineCovered,
      skipped: 0,
      percentage: pct(lineCovered, lineMissed),
    },
    branches: {
      total: branchCovered + branchMissed,
      covered: branchCovered,
      skipped: 0,
      percentage: pct(branchCovered, branchMissed),
    },
    functions: {
      total: methodCovered + methodMissed,
      covered: methodCovered,
      skipped: 0,
      percentage: pct(methodCovered, methodMissed),
    },
    statements: {
      total: instrCovered + instrMissed,
      covered: instrCovered,
      skipped: 0,
      percentage: pct(instrCovered, instrMissed),
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

    if (!framework) {
      // No framework detected — return zero metrics gracefully
      return this.zeroCoverage();
    }

    // Try to read existing coverage report first (supports Node.js and JaCoCo)
    const existingCoverage = await this.readExistingCoverage(framework);
    if (existingCoverage) {
      return existingCoverage;
    }

    // JVM projects: we don't auto-run mvn verify here (too slow for quality checks)
    // Return zero metrics so the quality score reflects "no coverage data available"
    if (framework === "maven" || framework === "gradle") {
      return this.zeroCoverage();
    }

    const coverageTool = await detectCoverageTool(this.projectPath);
    // Run tests with coverage
    return await this.runWithCoverage(framework, coverageTool);
  }

  /** Return empty coverage metrics (graceful fallback) */
  private zeroCoverage(): CoverageMetrics {
    const zero = { total: 0, covered: 0, skipped: 0, percentage: 0 };
    return { lines: zero, branches: zero, functions: zero, statements: zero };
  }

  /**
   * Read existing coverage report if available.
   * Supports Node.js (c8/nyc JSON) and JVM (JaCoCo CSV) formats.
   */
  private async readExistingCoverage(framework: TestFramework): Promise<CoverageMetrics | null> {
    // JaCoCo CSV paths (Maven and Gradle)
    if (framework === "maven" || framework === "gradle") {
      const jacocoPaths =
        framework === "maven"
          ? [
              join(this.projectPath, "target", "site", "jacoco", "jacoco.csv"),
              join(this.projectPath, "target", "site", "jacoco-ut", "jacoco.csv"),
            ]
          : [join(this.projectPath, "build", "reports", "jacoco", "test", "jacocoTestReport.csv")];

      for (const csvPath of jacocoPaths) {
        try {
          await access(csvPath, constants.R_OK);
          const csv = await readFile(csvPath, "utf-8");
          return parseJacocoCsv(csv);
        } catch {
          // Try next
        }
      }
      return null;
    }

    // Node.js JSON coverage paths
    const possiblePaths = [
      join(this.projectPath, "coverage", "coverage-summary.json"),
      join(this.projectPath, ".coverage", "coverage-summary.json"),
      join(this.projectPath, "coverage", "lcov-report", "coverage-summary.json"),
    ];

    for (const p of possiblePaths) {
      try {
        await access(p, constants.R_OK);
        const content = await readFile(p, "utf-8");
        const report = JSON.parse(content) as CoverageSummaryReport;
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
      const proc = execa(commands.command, commands.args, {
        cwd: this.projectPath,
        reject: false,
        timeout: 120000, // 2 minutes
        cleanup: true, // kill process tree on parent exit
      });
      trackSubprocess(proc);
      const result = await proc;

      // Check if tests failed
      if (result.exitCode !== 0 && !result.stdout.includes("coverage")) {
        throw new Error(`Tests failed: ${result.stderr || result.stdout}`);
      }

      // Read coverage report
      const reportPath = join(this.projectPath, "coverage", "coverage-summary.json");
      const report = JSON.parse(await readFile(reportPath, "utf-8")) as CoverageSummaryReport;

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
