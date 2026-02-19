/**
 * Tests for Dimension Registry
 */

import { describe, it, expect, vi } from "vitest";
import {
  DimensionRegistry,
  createDefaultRegistry,
  type DimensionAnalyzer,
  type AnalyzerInput,
  type AnalyzerResult,
} from "./dimension-registry.js";
import type { LanguageId } from "./language-detector.js";

// Helper to create a mock analyzer
function createMockAnalyzer(
  id: string,
  language: LanguageId | "all",
  score = 85,
): DimensionAnalyzer {
  return {
    dimensionId: id,
    language,
    analyze: vi.fn().mockResolvedValue({
      score,
      issues: [],
    } satisfies AnalyzerResult),
  };
}

describe("DimensionRegistry", () => {
  describe("register", () => {
    it("should register an analyzer", () => {
      const registry = new DimensionRegistry();
      const analyzer = createMockAnalyzer("security", "typescript");
      registry.register(analyzer);
      expect(registry.hasAnalyzers("typescript")).toBe(true);
    });

    it("should register multiple analyzers for the same language", () => {
      const registry = new DimensionRegistry();
      registry.register(createMockAnalyzer("security", "typescript"));
      registry.register(createMockAnalyzer("coverage", "typescript"));
      const analyzers = registry.getAnalyzers("typescript");
      expect(analyzers).toHaveLength(2);
    });

    it("should register analyzers for multiple languages", () => {
      const registry = new DimensionRegistry();
      registry.register(createMockAnalyzer("security", "typescript"));
      registry.register(createMockAnalyzer("security", "java"));
      expect(registry.hasAnalyzers("typescript")).toBe(true);
      expect(registry.hasAnalyzers("java")).toBe(true);
    });
  });

  describe("getAnalyzers", () => {
    it("should return analyzers for specified language", () => {
      const registry = new DimensionRegistry();
      const tsAnalyzer = createMockAnalyzer("security", "typescript");
      const javaAnalyzer = createMockAnalyzer("security", "java");
      registry.register(tsAnalyzer);
      registry.register(javaAnalyzer);

      const tsAnalyzers = registry.getAnalyzers("typescript");
      expect(tsAnalyzers).toContain(tsAnalyzer);
      expect(tsAnalyzers).not.toContain(javaAnalyzer);
    });

    it("should include 'all' language analyzers for any language", () => {
      const registry = new DimensionRegistry();
      const universalAnalyzer = createMockAnalyzer("style", "all");
      const tsAnalyzer = createMockAnalyzer("security", "typescript");
      registry.register(universalAnalyzer);
      registry.register(tsAnalyzer);

      const tsAnalyzers = registry.getAnalyzers("typescript");
      expect(tsAnalyzers).toContain(universalAnalyzer);
      expect(tsAnalyzers).toContain(tsAnalyzer);
    });

    it("should include 'all' analyzers even for unknown language", () => {
      const registry = new DimensionRegistry();
      const universalAnalyzer = createMockAnalyzer("style", "all");
      registry.register(universalAnalyzer);

      const analyzers = registry.getAnalyzers("unknown");
      expect(analyzers).toContain(universalAnalyzer);
    });

    it("should filter by dimensionId when provided", () => {
      const registry = new DimensionRegistry();
      registry.register(createMockAnalyzer("security", "typescript"));
      registry.register(createMockAnalyzer("coverage", "typescript"));

      const securityAnalyzers = registry.getAnalyzers("typescript", "security");
      expect(securityAnalyzers).toHaveLength(1);
      expect(securityAnalyzers[0]!.dimensionId).toBe("security");
    });

    it("should return empty array for language with no analyzers", () => {
      const registry = new DimensionRegistry();
      const analyzers = registry.getAnalyzers("python");
      expect(analyzers).toHaveLength(0);
    });
  });

  describe("hasAnalyzers", () => {
    it("should return true when language-specific analyzers exist", () => {
      const registry = new DimensionRegistry();
      registry.register(createMockAnalyzer("security", "java"));
      expect(registry.hasAnalyzers("java")).toBe(true);
    });

    it("should return true when 'all' analyzers exist", () => {
      const registry = new DimensionRegistry();
      registry.register(createMockAnalyzer("style", "all"));
      expect(registry.hasAnalyzers("python")).toBe(true);
    });

    it("should return false when no analyzers exist", () => {
      const registry = new DimensionRegistry();
      expect(registry.hasAnalyzers("rust")).toBe(false);
    });
  });

  describe("getSupportedLanguages", () => {
    it("should return all languages with registered analyzers", () => {
      const registry = new DimensionRegistry();
      registry.register(createMockAnalyzer("security", "typescript"));
      registry.register(createMockAnalyzer("security", "java"));

      const languages = registry.getSupportedLanguages();
      expect(languages).toContain("typescript");
      expect(languages).toContain("java");
    });

    it("should not include 'all' as a language", () => {
      const registry = new DimensionRegistry();
      registry.register(createMockAnalyzer("style", "all"));

      const languages = registry.getSupportedLanguages();
      expect(languages).not.toContain("all");
    });

    it("should return empty array for empty registry", () => {
      const registry = new DimensionRegistry();
      expect(registry.getSupportedLanguages()).toHaveLength(0);
    });
  });

  describe("analyze (stderr for failures)", () => {
    it("should write analyzer failures to stderr, not stdout", async () => {
      const registry = new DimensionRegistry();
      const failingAnalyzer: DimensionAnalyzer = {
        dimensionId: "security",
        language: "typescript",
        analyze: vi.fn().mockRejectedValue(new Error("analyzer boom")),
      };
      registry.register(failingAnalyzer);

      const stderrChunks: string[] = [];
      const stdoutChunks: string[] = [];
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);

      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation((chunk: unknown) => {
          stderrChunks.push(String(chunk));
          return true;
        });
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: unknown) => {
          stdoutChunks.push(String(chunk));
          return true;
        });

      try {
        const input: AnalyzerInput = {
          projectPath: "/project",
          files: [],
          language: "typescript",
        };
        const results = await registry.analyze(input);

        // Failed analyzer should be omitted from results
        expect(results).toHaveLength(0);
        // Error message should appear on stderr
        expect(stderrChunks.join("")).toContain("[DimensionRegistry] Analyzer failed:");
        expect(stderrChunks.join("")).toContain("analyzer boom");
        // Nothing should be written to stdout
        expect(stdoutChunks.join("")).toBe("");
      } finally {
        stderrSpy.mockRestore();
        stdoutSpy.mockRestore();
        void originalStderrWrite;
        void originalStdoutWrite;
      }
    });
  });

  describe("analyze", () => {
    it("should run all matching analyzers and return results", async () => {
      const registry = new DimensionRegistry();
      const analyzer1 = createMockAnalyzer("security", "typescript", 90);
      const analyzer2 = createMockAnalyzer("coverage", "typescript", 80);
      registry.register(analyzer1);
      registry.register(analyzer2);

      const input: AnalyzerInput = {
        projectPath: "/project",
        files: ["src/index.ts"],
        language: "typescript",
      };

      const results = await registry.analyze(input);
      expect(results).toHaveLength(2);
      expect(analyzer1.analyze).toHaveBeenCalledWith(input);
      expect(analyzer2.analyze).toHaveBeenCalledWith(input);
    });

    it("should include 'all' analyzers in results", async () => {
      const registry = new DimensionRegistry();
      const universalAnalyzer = createMockAnalyzer("style", "all", 95);
      registry.register(universalAnalyzer);

      const input: AnalyzerInput = {
        projectPath: "/project",
        files: ["src/index.java"],
        language: "java",
      };

      const results = await registry.analyze(input);
      expect(results).toHaveLength(1);
      expect(universalAnalyzer.analyze).toHaveBeenCalledWith(input);
    });

    it("should return empty results for unknown language with no analyzers", async () => {
      const registry = new DimensionRegistry();
      const input: AnalyzerInput = {
        projectPath: "/project",
        files: ["src/main.py"],
        language: "python",
      };

      const results = await registry.analyze(input);
      expect(results).toHaveLength(0);
    });
  });
});

describe("createDefaultRegistry", () => {
  it("should create a registry with TypeScript/JavaScript analyzers", () => {
    const registry = createDefaultRegistry("/project");
    expect(registry.hasAnalyzers("typescript")).toBe(true);
    expect(registry.hasAnalyzers("javascript")).toBe(true);
    expect(registry.hasAnalyzers("react-typescript")).toBe(true);
    expect(registry.hasAnalyzers("react-javascript")).toBe(true);
  });

  it("should return a DimensionRegistry instance", () => {
    const registry = createDefaultRegistry("/project");
    expect(registry).toBeInstanceOf(DimensionRegistry);
  });

  it("should have analyzers for all 12 quality dimensions", () => {
    const registry = createDefaultRegistry("/project");
    const analyzers = registry.getAnalyzers("typescript");
    const dimensionIds = new Set(analyzers.map((a) => a.dimensionId));

    const expectedDimensions = [
      "correctness",
      "completeness",
      "robustness",
      "readability",
      "maintainability",
      "complexity",
      "duplication",
      "testCoverage",
      "testQuality",
      "security",
      "documentation",
      "style",
    ];

    for (const dim of expectedDimensions) {
      expect(dimensionIds).toContain(dim);
    }
  });
});
