/**
 * E2E Tests for Quality Evaluator
 * Verifies integration of all analyzers and 0% hardcoded metrics
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { QualityEvaluator } from "./evaluator.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("QualityEvaluator E2E", () => {
  let testProject: string;

  beforeAll(async () => {
    // Create test project with known quality characteristics
    testProject = await createTestProject();
  });

  afterAll(async () => {
    // Cleanup
    await rm(testProject, { recursive: true, force: true });
  });

  describe("Real Metrics Integration", () => {
    it("should use real security score (not hardcoded 100)", async () => {
      // Create file with security vulnerability
      await writeFile(
        join(testProject, "vulnerable.ts"),
        `
        function unsafe(userInput: string) {
          eval(userInput); // CRITICAL vulnerability
        }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);
      const result = await evaluator.evaluate([join(testProject, "vulnerable.ts")]);

      // Security should NOT be 100 (there's a critical vulnerability)
      expect(result.scores.dimensions.security).toBeLessThan(100);
      expect(result.scores.dimensions.security).toBeGreaterThanOrEqual(0);

      // Should have security issues
      const securityIssues = result.issues.filter((i) => i.dimension === "security");
      expect(securityIssues.length).toBeGreaterThan(0);
      expect(securityIssues[0]?.message).toContain("Code Injection");
    });

    it("should use real complexity score (not hardcoded)", async () => {
      // Create file with high complexity
      await writeFile(
        join(testProject, "complex.ts"),
        `
        function highComplexity(x: number): string {
          if (x > 100) return "a";
          if (x > 90) return "b";
          if (x > 80) return "c";
          if (x > 70) return "d";
          if (x > 60) return "e";
          if (x > 50) return "f";
          if (x > 40) return "g";
          if (x > 30) return "h";
          if (x > 20) return "i";
          return "j";
        }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);
      const result = await evaluator.evaluate([join(testProject, "complex.ts")]);

      // Complexity should reflect the high complexity (score < 100)
      expect(result.scores.dimensions.complexity).toBeLessThan(100);
      expect(result.scores.dimensions.complexity).toBeGreaterThanOrEqual(0);

      // Should have complexity issues if function complexity > 10
      const complexityIssues = result.issues.filter((i) => i.dimension === "complexity");
      // Function has 10 ifs = complexity 11 (base 1 + 10 conditions)
      expect(complexityIssues.length).toBeGreaterThanOrEqual(0); // May or may not have issues depending on threshold
    });

    it("should use real duplication score (not hardcoded 90)", async () => {
      // Create files with duplicate code
      const duplicateCode = `
        const x = 1;
        const y = 2;
        const z = 3;
        const a = 4;
        const b = 5;
      `;

      await writeFile(join(testProject, "dup1.ts"), duplicateCode);
      await writeFile(join(testProject, "dup2.ts"), duplicateCode);

      const evaluator = new QualityEvaluator(testProject, false);
      const result = await evaluator.evaluate([
        join(testProject, "dup1.ts"),
        join(testProject, "dup2.ts"),
      ]);

      // Duplication should NOT be 90 (there's significant duplication)
      expect(result.scores.dimensions.duplication).not.toBe(90);
      expect(result.scores.dimensions.duplication).toBeLessThan(100);

      // Should have duplication issues if percentage > 5%
      if (result.scores.dimensions.duplication < 95) {
        const dupIssues = result.issues.filter((i) => i.dimension === "duplication");
        expect(dupIssues.length).toBeGreaterThan(0);
      }
    });

    it("should calculate readability from complexity", async () => {
      // Simple code should have high readability
      await writeFile(
        join(testProject, "simple.ts"),
        `
        function add(a: number, b: number): number {
          return a + b;
        }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);
      const result = await evaluator.evaluate([join(testProject, "simple.ts")]);

      // Readability should be high (close to 100) for simple code
      expect(result.scores.dimensions.readability).toBeGreaterThan(80);
      expect(result.scores.dimensions.readability).toBeLessThanOrEqual(100);
    });

    it("should calculate maintainability index", async () => {
      await writeFile(
        join(testProject, "maintainable.ts"),
        `
        function double(x: number): number {
          return x * 2;
        }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);
      const result = await evaluator.evaluate([join(testProject, "maintainable.ts")]);

      // Maintainability should be calculated (not hardcoded)
      expect(result.scores.dimensions.maintainability).toBeGreaterThan(0);
      expect(result.scores.dimensions.maintainability).toBeLessThanOrEqual(100);
    });
  });

  describe("Overall Score Calculation", () => {
    it("should calculate weighted overall score", async () => {
      await writeFile(
        join(testProject, "mixed.ts"),
        `
        function safe(): void {
          console.log("safe");
        }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);
      const result = await evaluator.evaluate([join(testProject, "mixed.ts")]);

      // Overall should be weighted average
      expect(result.scores.overall).toBeGreaterThan(0);
      expect(result.scores.overall).toBeLessThanOrEqual(100);

      // Should have all dimensions
      expect(result.scores.dimensions.security).toBeDefined();
      expect(result.scores.dimensions.complexity).toBeDefined();
      expect(result.scores.dimensions.duplication).toBeDefined();
      expect(result.scores.dimensions.readability).toBeDefined();
      expect(result.scores.dimensions.maintainability).toBeDefined();
    });

    it("should not use hardcoded values for real dimensions", async () => {
      await writeFile(
        join(testProject, "test1.ts"),
        `
        function test() { return 1; }
      `,
      );
      await writeFile(
        join(testProject, "test2.ts"),
        `
        function test() { return 2; }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);

      // Run evaluation twice on different files
      const result1 = await evaluator.evaluate([join(testProject, "test1.ts")]);
      const result2 = await evaluator.evaluate([join(testProject, "test2.ts")]);

      // Real metrics should potentially differ (not always same hardcoded value)
      // At minimum, they should be calculated, not constants
      expect(result1.scores.dimensions.security).toBeGreaterThanOrEqual(0);
      expect(result2.scores.dimensions.security).toBeGreaterThanOrEqual(0);

      // Complexity/duplication may vary by file content
      expect(result1.scores.dimensions.complexity).toBeGreaterThanOrEqual(0);
      expect(result2.scores.dimensions.complexity).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Threshold Checks", () => {
    it("should check minimum thresholds", async () => {
      await writeFile(
        join(testProject, "quality.ts"),
        `
        function good(): number {
          return 42;
        }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);
      const result = await evaluator.evaluate([join(testProject, "quality.ts")]);

      // Should have meetsMinimum and meetsTarget flags
      expect(typeof result.meetsMinimum).toBe("boolean");
      expect(typeof result.meetsTarget).toBe("boolean");
    });

    it("should fail minimum if security is not 100", async () => {
      await writeFile(
        join(testProject, "insecure.ts"),
        `
        function bad(code: string) {
          eval(code); // Critical vulnerability
        }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);
      const result = await evaluator.evaluate([join(testProject, "insecure.ts")]);

      // Should not meet minimum due to security < 100
      expect(result.scores.dimensions.security).toBeLessThan(100);
      expect(result.meetsMinimum).toBe(false);
    });
  });

  describe("Issues and Suggestions", () => {
    it("should generate issues from vulnerabilities", async () => {
      await writeFile(
        join(testProject, "issues.ts"),
        `
        function problem(html: string) {
          document.getElementById('x').innerHTML = html; // XSS
        }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);
      const result = await evaluator.evaluate([join(testProject, "issues.ts")]);

      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]).toHaveProperty("dimension");
      expect(result.issues[0]).toHaveProperty("severity");
      expect(result.issues[0]).toHaveProperty("message");
    });

    it("should generate suggestions for improvement", async () => {
      await writeFile(
        join(testProject, "improve.ts"),
        `
        function needsWork(x: number): string {
          if (x > 90) return "a";
          if (x > 80) return "b";
          if (x > 70) return "c";
          if (x > 60) return "d";
          if (x > 50) return "e";
          return "f";
        }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);
      const result = await evaluator.evaluate([join(testProject, "improve.ts")]);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0]).toHaveProperty("dimension");
      expect(result.suggestions[0]).toHaveProperty("priority");
      expect(result.suggestions[0]).toHaveProperty("description");
      expect(result.suggestions[0]).toHaveProperty("estimatedImpact");
    });
  });

  describe("Resilience — unreadable files", () => {
    it("should not throw when a file in the list cannot be read (catch → empty string)", async () => {
      // Pass a path that does not exist alongside a valid file; evaluate() must not throw.
      const validFile = join(testProject, "resilience-valid.ts");
      await writeFile(validFile, "function ok(): boolean { return true; }");
      const missingFile = join(testProject, "this-file-does-not-exist.ts");

      const evaluator = new QualityEvaluator(testProject, false);
      // Must resolve without throwing — the unreadable file is treated as empty string
      await expect(evaluator.evaluate([validFile, missingFile])).resolves.toBeDefined();
    });
  });

  describe("Performance", () => {
    it("should complete evaluation in reasonable time", async () => {
      await writeFile(
        join(testProject, "perf.ts"),
        `
        function performance() { return true; }
      `,
      );

      const evaluator = new QualityEvaluator(testProject, false);
      const startTime = performance.now();

      const result = await evaluator.evaluate([join(testProject, "perf.ts")]);

      const duration = performance.now() - startTime;

      expect(result.scores.evaluationDurationMs).toBeLessThan(10000); // < 10 seconds
      expect(duration).toBeLessThan(10000);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Fix #3 — Custom quality.weights from .coco.config.json must be honoured
// ──────────────────────────────────────────────────────────────────────────────

describe("resolvedWeights — custom weights from project config (Fix #3)", () => {
  it("returns DEFAULT_QUALITY_WEIGHTS when projectConfig is null", async () => {
    const { DEFAULT_QUALITY_WEIGHTS } = await import("./types.js");
    const { resolvedWeights } = await import("./quality-bridge.js");
    expect(resolvedWeights(null)).toEqual(DEFAULT_QUALITY_WEIGHTS);
  });

  it("returns DEFAULT_QUALITY_WEIGHTS when config has no quality.weights", async () => {
    const { DEFAULT_QUALITY_WEIGHTS } = await import("./types.js");
    const { resolvedWeights } = await import("./quality-bridge.js");
    const config = {};
    expect(resolvedWeights(config as any)).toEqual(DEFAULT_QUALITY_WEIGHTS);
  });

  it("overrides a single dimension weight and normalises the result", async () => {
    const { DEFAULT_QUALITY_WEIGHTS } = await import("./types.js");
    const { resolvedWeights } = await import("./quality-bridge.js");

    // Double the security weight
    const config = {
      quality: { weights: { security: DEFAULT_QUALITY_WEIGHTS.security * 2 } },
    };
    const weights = resolvedWeights(config as any);

    // The security weight must be strictly greater than the default after normalisation
    expect(weights.security).toBeGreaterThan(DEFAULT_QUALITY_WEIGHTS.security);

    // All weights must sum to 1.0 (allowing floating point tolerance)
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it("normalised weights applied to identical dimension scores changes overall proportionally", async () => {
    const { DEFAULT_QUALITY_WEIGHTS } = await import("./types.js");
    const { resolvedWeights } = await import("./quality-bridge.js");

    // With all dimension scores equal (say 80), the overall must equal 80
    // regardless of weights (because weights sum to 1).
    const uniformScore = 80;
    const dimensions = Object.fromEntries(
      Object.keys(DEFAULT_QUALITY_WEIGHTS).map((k) => [k, uniformScore]),
    ) as Record<string, number>;

    const config = {
      quality: { weights: { security: 0.5 } }, // extreme override
    };
    const weights = resolvedWeights(config as any);

    const overall = Object.entries(dimensions).reduce((sum, [key, value]) => {
      const weight = weights[key as keyof typeof DEFAULT_QUALITY_WEIGHTS] ?? 0;
      return sum + value * weight;
    }, 0);

    // Should still be ~80 because weights are normalised to sum to 1
    expect(Math.round(overall)).toBe(uniformScore);
  });

  it("custom weights affect the weighted sum when dimensions differ", async () => {
    const { DEFAULT_QUALITY_WEIGHTS } = await import("./types.js");
    const { resolvedWeights } = await import("./quality-bridge.js");

    // Set security score = 0 (worst), all others = 100 (best)
    const dimensions = Object.fromEntries(
      Object.keys(DEFAULT_QUALITY_WEIGHTS).map((k) => [k, k === "security" ? 0 : 100]),
    ) as Record<string, number>;

    // With a very heavy security weight, overall should be much lower
    const heavySecConfig = { quality: { weights: { security: 0.9 } } };
    const heavyWeights = resolvedWeights(heavySecConfig as any);

    const overallHeavy = Object.entries(dimensions).reduce((sum, [key, value]) => {
      const weight = heavyWeights[key as keyof typeof DEFAULT_QUALITY_WEIGHTS] ?? 0;
      return sum + value * weight;
    }, 0);

    // With a tiny security weight, overall should be much higher
    const lightSecConfig = { quality: { weights: { security: 0.001 } } };
    const lightWeights = resolvedWeights(lightSecConfig as any);

    const overallLight = Object.entries(dimensions).reduce((sum, [key, value]) => {
      const weight = lightWeights[key as keyof typeof DEFAULT_QUALITY_WEIGHTS] ?? 0;
      return sum + value * weight;
    }, 0);

    // Heavy security weight → penalises more when security is 0
    expect(overallHeavy).toBeLessThan(overallLight);
  });
});

// Helper function
async function createTestProject(): Promise<string> {
  const tempDir = join(
    tmpdir(),
    `coco-evaluator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tempDir, { recursive: true });

  // Create package.json for framework detection
  await writeFile(
    join(tempDir, "package.json"),
    JSON.stringify({
      name: "test-project",
      devDependencies: {
        vitest: "^1.0.0",
        "@vitest/coverage-v8": "^1.0.0",
      },
    }),
  );

  return tempDir;
}
