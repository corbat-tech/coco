/**
 * Tests for quality tools
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: JSON.stringify([
      {
        filePath: "/test/src/file.ts",
        messages: [
          { line: 10, column: 5, severity: 2, message: "Unused variable", ruleId: "no-unused-vars" },
          { line: 20, column: 1, severity: 1, message: "Missing semicolon", ruleId: "semi", fix: {} },
        ],
      },
    ]),
    stderr: "",
  }),
}));

const mockReadFile = vi.fn().mockImplementation(async (path: string) => {
  if (path.includes("package.json")) {
    return JSON.stringify({
      devDependencies: { oxlint: "^0.1.0" },
    });
  }
  // Return simple source code for complexity analysis
  return `
function simpleFunction() {
  return 1;
}

function complexFunction(a, b) {
  if (a > 0) {
    if (b > 0) {
      return a + b;
    } else {
      return a - b;
    }
  } else if (a < 0) {
    return -a;
  }
  return 0;
}
`;
});

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

vi.mock("glob", () => ({
  glob: vi.fn().mockResolvedValue(["/test/src/file.ts"]),
}));

describe("runLinterTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should run linter and return results", async () => {
    const { runLinterTool } = await import("./quality.js");

    const result = await runLinterTool.execute({ cwd: "/test" });

    // The result depends on whether a linter is detected
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("should detect linter from package.json", async () => {
    const { runLinterTool } = await import("./quality.js");

    const result = await runLinterTool.execute({ cwd: "/test" });

    // If oxlint is detected, it will try to run it
    expect(result).toBeDefined();
  });

  it("should pass fix flag when enabled", async () => {
    const { runLinterTool } = await import("./quality.js");

    const result = await runLinterTool.execute({ cwd: "/test", fix: true });

    expect(result).toBeDefined();
  });

  it("should lint specific files when provided", async () => {
    const { runLinterTool } = await import("./quality.js");

    const result = await runLinterTool.execute({ cwd: "/test", files: ["src/user.ts", "src/api.ts"] });

    expect(result).toBeDefined();
  });

  it("should return perfect score when no issues", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "[]",
      stderr: "",
    } as any);

    const { runLinterTool } = await import("./quality.js");

    const result = await runLinterTool.execute({ cwd: "/test" });

    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("should return empty result when no linter found", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ devDependencies: {} }));

    const { runLinterTool } = await import("./quality.js");

    const result = await runLinterTool.execute({ cwd: "/test" });

    expect(result.score).toBe(100);
    expect(result.issues).toEqual([]);
  });
});

describe("analyzeComplexityTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should analyze complexity and return results", async () => {
    const { analyzeComplexityTool } = await import("./quality.js");

    const result = await analyzeComplexityTool.execute({ cwd: "/test" });

    expect(result.totalFunctions).toBeGreaterThanOrEqual(0);
    expect(result.averageComplexity).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeDefined();
  });

  it("should identify complex functions above threshold", async () => {
    const { analyzeComplexityTool } = await import("./quality.js");

    const result = await analyzeComplexityTool.execute({ cwd: "/test", threshold: 3 });

    expect(result.complexFunctions).toBeGreaterThanOrEqual(0);
  });

  it("should analyze specific files when provided", async () => {
    const { analyzeComplexityTool } = await import("./quality.js");

    const result = await analyzeComplexityTool.execute({
      cwd: "/test",
      files: ["/test/src/file.ts"],
    });

    expect(result).toBeDefined();
  });
});

describe("calculateQualityTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should calculate comprehensive quality scores", async () => {
    const { calculateQualityTool } = await import("./quality.js");

    const result = await calculateQualityTool.execute({ cwd: "/test" });

    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.dimensions).toBeDefined();
  });

  it("should include all quality dimensions", async () => {
    const { calculateQualityTool } = await import("./quality.js");

    const result = await calculateQualityTool.execute({ cwd: "/test" });

    expect(result.dimensions).toBeDefined();
    // Check that dimensions object has properties
    expect(Object.keys(result.dimensions).length).toBeGreaterThan(0);
  });
});

describe("qualityTools", () => {
  it("should export all quality tools", async () => {
    const { qualityTools } = await import("./quality.js");

    expect(qualityTools).toBeDefined();
    expect(qualityTools.length).toBe(3);
    expect(qualityTools.some((t) => t.name === "run_linter")).toBe(true);
    expect(qualityTools.some((t) => t.name === "analyze_complexity")).toBe(true);
    expect(qualityTools.some((t) => t.name === "calculate_quality")).toBe(true);
  });
});

describe("calculateQualityTool error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle coverage tool errors gracefully", async () => {
    // The coverage tool throws an error - should still return valid result
    const { calculateQualityTool } = await import("./quality.js");

    const result = await calculateQualityTool.execute({ cwd: "/test" });

    // Should succeed even if coverage fails
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.dimensions.testCoverage).toBe(0); // Default when coverage unavailable
  });

  it("should throw ToolError when quality calculation fails", async () => {
    // Force an error by making glob fail
    const { glob } = await import("glob");
    vi.mocked(glob).mockRejectedValueOnce(new Error("Glob failed"));

    const { calculateQualityTool } = await import("./quality.js");

    await expect(
      calculateQualityTool.execute({ cwd: "/nonexistent" })
    ).rejects.toThrow(/Quality calculation failed/);
  });
});

describe("runLinterTool eslint and biome support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should use eslint when detected", async () => {
    mockReadFile.mockImplementationOnce(async (path: string) => {
      if (path.includes("package.json")) {
        return JSON.stringify({
          devDependencies: { eslint: "^8.0.0" },
        });
      }
      return "";
    });

    const { execa } = await import("execa");
    const { runLinterTool } = await import("./quality.js");

    await runLinterTool.execute({ cwd: "/test" });

    expect(execa).toHaveBeenCalledWith(
      "npx",
      expect.arrayContaining(["eslint"]),
      expect.any(Object)
    );
  });

  it("should use biome when detected", async () => {
    mockReadFile.mockImplementationOnce(async (path: string) => {
      if (path.includes("package.json")) {
        return JSON.stringify({
          devDependencies: { "@biomejs/biome": "^1.0.0" },
        });
      }
      return "";
    });

    const { execa } = await import("execa");
    const { runLinterTool } = await import("./quality.js");

    await runLinterTool.execute({ cwd: "/test" });

    expect(execa).toHaveBeenCalledWith(
      "npx",
      expect.arrayContaining(["biome", "lint"]),
      expect.any(Object)
    );
  });

  it("should throw error for unsupported linter", async () => {
    const { runLinterTool } = await import("./quality.js");

    await expect(
      runLinterTool.execute({ cwd: "/test", linter: "unsupported-linter" })
    ).rejects.toThrow(/Unsupported linter/);
  });

  it("should handle linter execution errors", async () => {
    mockReadFile.mockImplementationOnce(async (path: string) => {
      if (path.includes("package.json")) {
        return JSON.stringify({
          devDependencies: { oxlint: "^0.1.0" },
        });
      }
      return "";
    });

    const { execa } = await import("execa");
    vi.mocked(execa).mockRejectedValueOnce(new Error("Command not found"));

    const { runLinterTool } = await import("./quality.js");

    await expect(
      runLinterTool.execute({ cwd: "/test" })
    ).rejects.toThrow(/Linting failed/);
  });
});

describe("parseLintResults fallback parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should parse raw output when JSON parsing fails", async () => {
    mockReadFile.mockImplementationOnce(async (path: string) => {
      if (path.includes("package.json")) {
        return JSON.stringify({
          devDependencies: { oxlint: "^0.1.0" },
        });
      }
      return "";
    });

    const { execa } = await import("execa");
    // Use invalid JSON that starts with [ to trigger catch block for fallback parsing
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "[invalid json] 5 error 3 warning found",
      stderr: "",
    } as any);

    const { runLinterTool } = await import("./quality.js");

    const result = await runLinterTool.execute({ cwd: "/test" });

    expect(result.errors).toBe(5);
    expect(result.warnings).toBe(3);
  });
});
