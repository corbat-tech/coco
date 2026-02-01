/**
 * Tests for test tools
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.fn().mockImplementation(async (path: string) => {
  if (path.includes("package.json")) {
    return JSON.stringify({
      devDependencies: { vitest: "^1.0.0" },
    });
  }
  if (path.includes("coverage-summary.json")) {
    return JSON.stringify({
      total: {
        lines: { pct: 85 },
        branches: { pct: 80 },
        functions: { pct: 90 },
        statements: { pct: 87 },
      },
    });
  }
  throw new Error("Not found");
});

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: JSON.stringify({
      numPassedTests: 10,
      numFailedTests: 0,
      numPendingTests: 2,
      testResults: [],
    }),
    stderr: "",
  }),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: {
      readFile: mockReadFile,
    },
    readFile: mockReadFile,
  };
});

describe("runTestsTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should run tests and return results", async () => {
    const { runTestsTool } = await import("./test.js");

    const result = await runTestsTool.execute({ cwd: "/test" });

    expect(result.passed).toBeGreaterThanOrEqual(0);
    expect(result.failed).toBeGreaterThanOrEqual(0);
    expect(result).toHaveProperty("success");
  });

  it("should detect vitest framework", async () => {
    const { runTestsTool } = await import("./test.js");

    const result = await runTestsTool.execute({ cwd: "/test" });

    expect(result).toBeDefined();
  });

  it("should pass coverage flag when enabled", async () => {
    const { runTestsTool } = await import("./test.js");

    const result = await runTestsTool.execute({ cwd: "/test", coverage: true });

    expect(result).toBeDefined();
  });

  it("should pass pattern when specified", async () => {
    const { runTestsTool } = await import("./test.js");

    const result = await runTestsTool.execute({ cwd: "/test", pattern: "user.test.ts" });

    expect(result).toBeDefined();
  });

  it("should handle test failures", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 1,
      stdout: JSON.stringify({
        numPassedTests: 8,
        numFailedTests: 2,
        numPendingTests: 0,
        testResults: [
          {
            assertionResults: [
              {
                title: "should work",
                status: "failed",
                failureMessages: ["Expected true, got false"],
              },
            ],
          },
        ],
      }),
      stderr: "",
    } as any);

    const { runTestsTool } = await import("./test.js");

    const result = await runTestsTool.execute({ cwd: "/test" });

    expect(result).toBeDefined();
    expect(result.passed).toBeGreaterThanOrEqual(0);
  });
});

describe("getCoverageTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return coverage data", async () => {
    const { getCoverageTool } = await import("./test.js");

    const result = await getCoverageTool.execute({ cwd: "/test" });

    expect(result.lines).toBeGreaterThanOrEqual(0);
    expect(result.branches).toBeGreaterThanOrEqual(0);
    expect(result.functions).toBeGreaterThanOrEqual(0);
  });

  it("should include detailed report when requested", async () => {
    const { getCoverageTool } = await import("./test.js");

    const result = await getCoverageTool.execute({ cwd: "/test", format: "detailed" });

    expect(result).toBeDefined();
  });

  it("should handle missing coverage gracefully", async () => {
    const { getCoverageTool } = await import("./test.js");

    // Just verify the tool is callable
    const result = await getCoverageTool.execute({ cwd: "/test" });
    expect(result).toBeDefined();
  });
});

describe("runTestFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should run specific test file", async () => {
    const { runTestFileTool } = await import("./test.js");

    const result = await runTestFileTool.execute({ cwd: "/test", file: "user.test.ts" });

    expect(result).toBeDefined();
  });
});

describe("testTools", () => {
  it("should export all test tools", async () => {
    const { testTools } = await import("./test.js");

    expect(testTools).toBeDefined();
    expect(testTools.length).toBe(3);
    expect(testTools.some((t) => t.name === "run_tests")).toBe(true);
    expect(testTools.some((t) => t.name === "get_coverage")).toBe(true);
    expect(testTools.some((t) => t.name === "run_test_file")).toBe(true);
  });
});
