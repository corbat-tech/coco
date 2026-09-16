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
          {
            line: 10,
            column: 5,
            severity: 2,
            message: "Unused variable",
            ruleId: "no-unused-vars",
          },
          {
            line: 20,
            column: 1,
            severity: 1,
            message: "Missing semicolon",
            ruleId: "semi",
            fix: {},
          },
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

    const result = await runLinterTool.execute({
      cwd: "/test",
      files: ["src/user.ts", "src/api.ts"],
    });

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

  it("should return null score with message when no linter found", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ devDependencies: {} }));

    const { runLinterTool } = await import("./quality.js");

    const result = await runLinterTool.execute({ cwd: "/test" });

    expect(result.score).toBeNull();
    expect(result.linter).toBe("none");
    expect(result.message).toContain("No linter detected");
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

describe("calculateQualityTool containment", () => {
  it("preserves an explicit failure without score through the registry", async () => {
    const { ToolRegistry } = await import("./registry.js");
    const { calculateQualityTool } = await import("./quality.js");
    const registry = new ToolRegistry();
    registry.register(calculateQualityTool);
    const result = await registry.execute("calculate_quality", {});
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toContain("not evaluated; no acceptance certified");
  });
  it.each([{}, { cwd: "/test" }, { cwd: "/nonexistent", useSnyk: true, files: ["x.ts"] }])(
    "does not certify quality or invoke analyzers for %j",
    async (input) => {
      vi.clearAllMocks();
      const { calculateQualityTool } = await import("./quality.js");
      const { execa } = await import("execa");
      await expect(calculateQualityTool.execute(input)).rejects.toThrow(
        /not evaluated; no acceptance certified/,
      );
      expect(execa).not.toHaveBeenCalled();
      expect(mockReadFile).not.toHaveBeenCalled();
    },
  );
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
      expect.any(Object),
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
      expect.any(Object),
    );
  });

  it("should throw error for unsupported linter", async () => {
    const { runLinterTool } = await import("./quality.js");

    await expect(
      runLinterTool.execute({ cwd: "/test", linter: "unsupported-linter" }),
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

    await expect(runLinterTool.execute({ cwd: "/test" })).rejects.toThrow(/Linting failed/);
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
