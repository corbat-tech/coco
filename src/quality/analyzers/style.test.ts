/**
 * Tests for Style Analyzer
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { glob } from "glob";

// Mock execa before importing the analyzer
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { StyleAnalyzer } from "./style.js";
import { execa } from "execa";

const mockedExeca = vi.mocked(execa);

describe("StyleAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("No Linter Detected", () => {
    it("should return score 50 and linterUsed null when no linter is in package.json", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          dependencies: {},
          devDependencies: {},
        }),
      );

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      expect(result.score).toBe(50);
      expect(result.linterUsed).toBeNull();
      expect(result.errors).toBe(0);
      expect(result.warnings).toBe(0);
      expect(result.details).toBe("No linter configured");
    });

    it("should return score 50 when package.json does not exist", async () => {
      const tempDir = await createTempProject();
      // No package.json created

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      expect(result.score).toBe(50);
      expect(result.linterUsed).toBeNull();
    });
  });

  describe("Oxlint Detection and Scoring", () => {
    it("should return score 100 for oxlint with 0 errors and 0 warnings", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: { oxlint: "^0.5.0" },
        }),
      );

      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([]),
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      expect(result.score).toBe(100);
      expect(result.linterUsed).toBe("oxlint");
      expect(result.errors).toBe(0);
      expect(result.warnings).toBe(0);
      expect(result.details).toContain("oxlint");
    });

    it("should parse oxlint JSON output with errors and warnings", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: { oxlint: "^0.5.0" },
        }),
      );

      const diagnostics = [
        { severity: 2, message: "no-unused-vars" },
        { severity: 2, message: "no-console" },
        { severity: 1, message: "prefer-const" },
        { severity: "error", message: "no-undef" },
        { severity: "warning", message: "no-empty" },
      ];

      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify(diagnostics),
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      // 3 errors (severity 2 or "error"), 2 warnings (severity 1 or "warning")
      expect(result.errors).toBe(3);
      expect(result.warnings).toBe(2);
      // score = 100 - 3*5 - 2*2 = 100 - 15 - 4 = 81
      expect(result.score).toBe(81);
      expect(result.linterUsed).toBe("oxlint");
    });

    it("should fallback to text parsing when oxlint JSON is invalid", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: { oxlint: "^0.5.0" },
        }),
      );

      mockedExeca.mockResolvedValueOnce({
        stdout: `error[no-unused-vars]: Variable 'x' is declared but never used
error[no-console]: Unexpected console statement`,
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      expect(result.errors).toBe(2);
      expect(result.warnings).toBe(0);
      // score = 100 - 2*5 = 90
      expect(result.score).toBe(90);
    });
  });

  describe("ESLint Detection and Scoring", () => {
    it("should detect eslint and calculate score with errors and warnings", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: { eslint: "^8.0.0" },
        }),
      );

      const eslintOutput = [
        { filePath: "/src/a.ts", errorCount: 3, warningCount: 2, messages: [] },
        { filePath: "/src/b.ts", errorCount: 2, warningCount: 1, messages: [] },
      ];

      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify(eslintOutput),
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      // 5 errors, 3 warnings
      expect(result.errors).toBe(5);
      expect(result.warnings).toBe(3);
      // score = 100 - 5*5 - 3*2 = 100 - 25 - 6 = 69
      expect(result.score).toBe(69);
      expect(result.linterUsed).toBe("eslint");
      expect(result.details).toContain("eslint");
      expect(result.details).toContain("5 errors");
      expect(result.details).toContain("3 warnings");
    });

    it("should return 100 for eslint with zero issues", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: { eslint: "^8.0.0" },
        }),
      );

      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { filePath: "/src/a.ts", errorCount: 0, warningCount: 0, messages: [] },
        ]),
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      expect(result.score).toBe(100);
      expect(result.errors).toBe(0);
      expect(result.warnings).toBe(0);
      expect(result.linterUsed).toBe("eslint");
    });
  });

  describe("Biome Detection and Scoring", () => {
    it("should detect @biomejs/biome and parse diagnostics correctly", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: { "@biomejs/biome": "^1.5.0" },
        }),
      );

      const biomeOutput = {
        diagnostics: [
          { severity: "error", message: "lint/suspicious/noExplicitAny" },
          { severity: "error", message: "lint/nursery/noUnusedImports" },
          { severity: "warning", message: "lint/style/useConst" },
          { severity: "warning", message: "lint/style/noNonNullAssertion" },
          { severity: "warning", message: "lint/style/useTemplate" },
          { severity: "error", message: "lint/correctness/noUnreachable" },
        ],
      };

      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify(biomeOutput),
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      // 3 errors, 3 warnings
      expect(result.errors).toBe(3);
      expect(result.warnings).toBe(3);
      // score = 100 - 3*5 - 3*2 = 100 - 15 - 6 = 79
      expect(result.score).toBe(79);
      expect(result.linterUsed).toBe("biome");
    });

    it("should detect biome (short name) in dependencies", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: { biome: "^1.0.0" },
        }),
      );

      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify({ diagnostics: [] }),
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      expect(result.linterUsed).toBe("biome");
      expect(result.score).toBe(100);
    });
  });

  describe("Linter Detection Priority", () => {
    it("should prefer oxlint over eslint and biome", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: {
            oxlint: "^0.5.0",
            eslint: "^8.0.0",
            "@biomejs/biome": "^1.5.0",
          },
        }),
      );

      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([]),
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      expect(result.linterUsed).toBe("oxlint");
    });

    it("should prefer biome over eslint when oxlint is absent", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: {
            "@biomejs/biome": "^1.5.0",
            eslint: "^8.0.0",
          },
        }),
      );

      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify({ diagnostics: [] }),
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      expect(result.linterUsed).toBe("biome");
    });

    it("should read from both dependencies and devDependencies", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          dependencies: { eslint: "^8.0.0" },
          devDependencies: {},
        }),
      );

      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([]),
        stderr: "",
        exitCode: 0,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      expect(result.linterUsed).toBe("eslint");
    });
  });

  describe("Score Clamping", () => {
    it("should clamp score to 0 when many errors exist", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: { eslint: "^8.0.0" },
        }),
      );

      const eslintOutput = [
        { filePath: "/src/a.ts", errorCount: 25, warningCount: 10, messages: [] },
      ];

      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify(eslintOutput),
        stderr: "",
        exitCode: 1,
      } as any);

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      // 100 - 25*5 - 10*2 = 100 - 125 - 20 = -45, clamped to 0
      expect(result.score).toBe(0);
      expect(result.errors).toBe(25);
      expect(result.warnings).toBe(10);
    });
  });

  describe("Linter Execution Failure", () => {
    it("should return 0 errors/warnings when execa throws (linter not installed)", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: { oxlint: "^0.5.0" },
        }),
      );

      mockedExeca.mockRejectedValueOnce(new Error("Command not found: npx"));

      const analyzer = new StyleAnalyzer(tempDir);
      const result = await analyzer.analyze();

      // When execa throws, fallback returns { errors: 0, warnings: 0 }
      expect(result.linterUsed).toBe("oxlint");
      expect(result.errors).toBe(0);
      expect(result.warnings).toBe(0);
      expect(result.score).toBe(100);
    });
  });

  afterAll(async () => {
    const tempDirs = await glob(join(tmpdir(), "coco-style-test-*"));
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function createTempProject(): Promise<string> {
  const tempDir = join(
    tmpdir(),
    `coco-style-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}
