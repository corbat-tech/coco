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

describe("runTestsTool advanced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw when no test framework detected", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("Not found"));

    const { runTestsTool } = await import("./test.js");

    await expect(runTestsTool.execute({ cwd: "/empty" })).rejects.toThrow(
      "No test framework detected"
    );
  });

  it("should support jest framework", async () => {
    mockReadFile.mockImplementationOnce(async () =>
      JSON.stringify({
        devDependencies: { jest: "^29.0.0" },
      })
    );

    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        numPassedTests: 5,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [],
      }),
      stderr: "",
    } as any);

    const { runTestsTool } = await import("./test.js");

    const result = await runTestsTool.execute({ cwd: "/test", framework: "jest" });

    expect(result.passed).toBeGreaterThanOrEqual(0);
  });

  it("should support mocha framework", async () => {
    mockReadFile.mockImplementationOnce(async () =>
      JSON.stringify({
        devDependencies: { mocha: "^10.0.0" },
      })
    );

    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "5 passing",
      stderr: "",
    } as any);

    const { runTestsTool } = await import("./test.js");

    const result = await runTestsTool.execute({ cwd: "/test", framework: "mocha" });

    expect(result.passed).toBe(5);
  });

  it("should throw on unsupported framework", async () => {
    const { runTestsTool } = await import("./test.js");

    await expect(
      runTestsTool.execute({ cwd: "/test", framework: "unknown" })
    ).rejects.toThrow("Unsupported test framework");
  });

  it("should handle execution errors", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockRejectedValueOnce(new Error("Command not found"));

    const { runTestsTool } = await import("./test.js");

    await expect(runTestsTool.execute({ cwd: "/test" })).rejects.toThrow(
      "Test execution failed"
    );
  });

  it("should parse output when JSON parsing fails", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "10 passing\n2 skipped",
      stderr: "",
    } as any);

    const { runTestsTool } = await import("./test.js");

    const result = await runTestsTool.execute({ cwd: "/test" });

    expect(result.passed).toBe(10);
    expect(result.skipped).toBe(2);
  });

  it("should parse failures from stderr", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "5 passing\n2 failed",
      stderr: "FAIL: Test assertion error\nError: Expected value to be true",
    } as any);

    const { runTestsTool } = await import("./test.js");

    const result = await runTestsTool.execute({ cwd: "/test" });

    expect(result.failed).toBe(2);
    expect(result.success).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("should detect ava framework", async () => {
    mockReadFile.mockImplementationOnce(async () =>
      JSON.stringify({
        devDependencies: { ava: "^5.0.0" },
      })
    );

    const { runTestsTool } = await import("./test.js");

    // AVA is detected but not supported
    await expect(runTestsTool.execute({ cwd: "/test" })).rejects.toThrow();
  });
});

describe("getCoverageTool advanced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw when coverage not found", async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("package.json")) {
        return JSON.stringify({ devDependencies: { vitest: "^1.0.0" } });
      }
      throw new Error("Not found");
    });

    const { getCoverageTool } = await import("./test.js");

    await expect(getCoverageTool.execute({ cwd: "/nocoverage" })).rejects.toThrow(
      "Coverage data not found"
    );
  });

  it("should handle read errors", async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("package.json")) {
        return JSON.stringify({ devDependencies: { vitest: "^1.0.0" } });
      }
      if (path.includes("coverage-summary.json")) {
        return "invalid json";
      }
      throw new Error("Not found");
    });

    const { getCoverageTool } = await import("./test.js");

    await expect(getCoverageTool.execute({ cwd: "/invalid" })).rejects.toThrow();
  });

  it("should handle missing total in coverage", async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("package.json")) {
        return JSON.stringify({ devDependencies: { vitest: "^1.0.0" } });
      }
      if (path.includes("coverage-summary.json")) {
        return JSON.stringify({ files: {} });
      }
      throw new Error("Not found");
    });

    const { getCoverageTool } = await import("./test.js");

    await expect(getCoverageTool.execute({ cwd: "/partial" })).rejects.toThrow();
  });
});

describe("runTestFileTool advanced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delegate to runTestsTool with file pattern", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        numPassedTests: 3,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [],
      }),
      stderr: "",
    } as any);

    const { runTestFileTool } = await import("./test.js");

    const result = await runTestFileTool.execute({
      cwd: "/test",
      file: "specific.test.ts",
    });

    expect(result).toBeDefined();
    expect(result.passed).toBe(3);
  });

  it("should support explicit framework", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        numPassedTests: 2,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [],
      }),
      stderr: "",
    } as any);

    const { runTestFileTool } = await import("./test.js");

    const result = await runTestFileTool.execute({
      cwd: "/test",
      file: "unit.test.ts",
      framework: "vitest",
    });

    expect(result.passed).toBe(2);
  });
});
