/**
 * Tests for Coverage Analyzer
 */

import { describe, it, expect } from "vitest";
import { CoverageAnalyzer, detectTestFramework, detectCoverageTool } from "./coverage.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("detectTestFramework", () => {
  it("should detect vitest", async () => {
    const tempDir = await createTempProject({
      devDependencies: { vitest: "^1.0.0" },
    });

    const framework = await detectTestFramework(tempDir);
    expect(framework).toBe("vitest");
  });

  it("should detect jest", async () => {
    const tempDir = await createTempProject({
      devDependencies: { jest: "^29.0.0" },
    });

    const framework = await detectTestFramework(tempDir);
    expect(framework).toBe("jest");
  });

  it("should detect mocha", async () => {
    const tempDir = await createTempProject({
      devDependencies: { mocha: "^10.0.0" },
    });

    const framework = await detectTestFramework(tempDir);
    expect(framework).toBe("mocha");
  });

  it("should return null when no framework detected", async () => {
    const tempDir = await createTempProject({
      devDependencies: {},
    });

    const framework = await detectTestFramework(tempDir);
    expect(framework).toBeNull();
  });

  it("should prioritize vitest over jest", async () => {
    const tempDir = await createTempProject({
      devDependencies: {
        vitest: "^1.0.0",
        jest: "^29.0.0",
      },
    });

    const framework = await detectTestFramework(tempDir);
    expect(framework).toBe("vitest");
  });
});

describe("detectCoverageTool", () => {
  it("should detect c8", async () => {
    const tempDir = await createTempProject({
      devDependencies: { c8: "^8.0.0" },
    });

    const tool = await detectCoverageTool(tempDir);
    expect(tool).toBe("c8");
  });

  it("should detect nyc", async () => {
    const tempDir = await createTempProject({
      devDependencies: { nyc: "^15.0.0" },
    });

    const tool = await detectCoverageTool(tempDir);
    expect(tool).toBe("nyc");
  });

  it("should detect c8 from vitest coverage plugin", async () => {
    const tempDir = await createTempProject({
      devDependencies: { "@vitest/coverage-v8": "^1.0.0" },
    });

    const tool = await detectCoverageTool(tempDir);
    expect(tool).toBe("c8");
  });

  it("should return null when no coverage tool detected", async () => {
    const tempDir = await createTempProject({
      devDependencies: {},
    });

    const tool = await detectCoverageTool(tempDir);
    expect(tool).toBeNull();
  });
});

describe("CoverageAnalyzer", () => {
  it("should read existing coverage report", async () => {
    const tempDir = await createTempProjectWithCoverage({
      lines: { total: 100, covered: 80, skipped: 0, pct: 80 },
      branches: { total: 50, covered: 40, skipped: 0, pct: 80 },
      functions: { total: 20, covered: 18, skipped: 0, pct: 90 },
      statements: { total: 100, covered: 80, skipped: 0, pct: 80 },
    });

    const analyzer = new CoverageAnalyzer(tempDir);
    const metrics = await analyzer.analyze();

    expect(metrics.lines.percentage).toBe(80);
    expect(metrics.lines.total).toBe(100);
    expect(metrics.lines.covered).toBe(80);
    expect(metrics.branches.percentage).toBe(80);
    expect(metrics.functions.percentage).toBe(90);
  });

  it("should handle missing coverage report gracefully", async () => {
    const tempDir = await createTempProject({
      devDependencies: {},
    });

    const analyzer = new CoverageAnalyzer(tempDir);

    await expect(analyzer.analyze()).rejects.toThrow("No test framework detected");
  });

  it("should parse coverage metrics correctly", async () => {
    const tempDir = await createTempProjectWithCoverage({
      lines: { total: 200, covered: 150, skipped: 10, pct: 75 },
      branches: { total: 80, covered: 60, skipped: 0, pct: 75 },
      functions: { total: 30, covered: 27, skipped: 0, pct: 90 },
      statements: { total: 200, covered: 150, skipped: 10, pct: 75 },
    });

    const analyzer = new CoverageAnalyzer(tempDir);
    const metrics = await analyzer.analyze();

    expect(metrics).toEqual({
      lines: { total: 200, covered: 150, skipped: 10, percentage: 75 },
      branches: { total: 80, covered: 60, skipped: 0, percentage: 75 },
      functions: { total: 30, covered: 27, skipped: 0, percentage: 90 },
      statements: { total: 200, covered: 150, skipped: 10, percentage: 75 },
    });
  });
});

// Helper functions for tests

async function createTempProject(pkg: {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}): Promise<string> {
  const tempDir = join(tmpdir(), `coco-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });

  const packageJson = {
    name: "test-project",
    version: "1.0.0",
    devDependencies: pkg.devDependencies || {},
    dependencies: pkg.dependencies || {},
  };

  await writeFile(join(tempDir, "package.json"), JSON.stringify(packageJson, null, 2));

  return tempDir;
}

async function createTempProjectWithCoverage(totals: {
  lines: { total: number; covered: number; skipped: number; pct: number };
  branches: { total: number; covered: number; skipped: number; pct: number };
  functions: { total: number; covered: number; skipped: number; pct: number };
  statements: { total: number; covered: number; skipped: number; pct: number };
}): Promise<string> {
  const tempDir = await createTempProject({
    devDependencies: { vitest: "^1.0.0" },
  });

  // Create coverage directory and report
  await mkdir(join(tempDir, "coverage"), { recursive: true });

  const coverageSummary = {
    total: totals,
  };

  await writeFile(
    join(tempDir, "coverage", "coverage-summary.json"),
    JSON.stringify(coverageSummary, null, 2),
  );

  return tempDir;
}
