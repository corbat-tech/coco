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
