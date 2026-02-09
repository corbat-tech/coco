/**
 * Tests for Complexity Analyzer
 */

import { describe, it, expect } from "vitest";
import { ComplexityAnalyzer, DuplicationAnalyzer } from "./complexity.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ComplexityAnalyzer", () => {
  describe("Simple Functions", () => {
    it("should calculate complexity 1 for simple function", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "simple.ts"),
        `
        function add(a: number, b: number): number {
          return a + b;
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "simple.ts")]);

      expect(result.totalFunctions).toBe(1);
      expect(result.averageComplexity).toBe(1);
      expect(result.maxComplexity).toBe(1);
      expect(result.score).toBe(100); // Perfect score
    });

    it("should calculate complexity 2 for function with one if", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "withIf.ts"),
        `
        function isPositive(n: number): boolean {
          if (n > 0) {
            return true;
          }
          return false;
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "withIf.ts")]);

      expect(result.totalFunctions).toBe(1);
      expect(result.averageComplexity).toBe(2); // 1 base + 1 if
      expect(result.files[0]?.functions[0]?.complexity).toBe(2);
    });

    it("should calculate complexity correctly for loops", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "loops.ts"),
        `
        function sumArray(arr: number[]): number {
          let sum = 0;
          for (const n of arr) {
            sum += n;
          }
          return sum;
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "loops.ts")]);

      expect(result.averageComplexity).toBe(2); // 1 base + 1 for
    });

    it("should calculate complexity for ternary operator", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "ternary.ts"),
        `
        function getSign(n: number): string {
          return n > 0 ? "positive" : "negative";
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "ternary.ts")]);

      expect(result.averageComplexity).toBe(2); // 1 base + 1 ternary
    });

    it("should calculate complexity for logical operators", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "logical.ts"),
        `
        function isValid(x: number, y: number): boolean {
          return x > 0 && y > 0 || x === 0;
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "logical.ts")]);

      expect(result.averageComplexity).toBeGreaterThanOrEqual(3); // 1 base + 2 logical
    });
  });

  describe("Complex Functions", () => {
    it("should detect complex function (complexity > 10)", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "complex.ts"),
        `
        function validateInput(input: any): boolean {
          if (!input) return false;
          if (typeof input !== 'object') return false;
          if (!input.name) return false;
          if (!input.email) return false;
          if (!input.age) return false;
          if (input.age < 0) return false;
          if (input.age > 120) return false;
          if (!input.email.includes('@')) return false;
          if (input.name.length < 2) return false;
          if (input.name.length > 50) return false;
          return true;
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir, 10);
      const result = await analyzer.analyze([join(tempDir, "complex.ts")]);

      expect(result.averageComplexity).toBeGreaterThan(10);
      expect(result.complexFunctions).toBe(1); // One function > threshold
    });

    it("should handle nested conditions", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "nested.ts"),
        `
        function process(x: number): string {
          if (x > 0) {
            if (x > 10) {
              if (x > 100) {
                return "large";
              }
              return "medium";
            }
            return "small";
          }
          return "zero or negative";
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "nested.ts")]);

      expect(result.averageComplexity).toBe(4); // 1 base + 3 ifs
    });

    it("should handle switch statements", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "switch.ts"),
        `
        function getDay(n: number): string {
          switch (n) {
            case 1: return "Monday";
            case 2: return "Tuesday";
            case 3: return "Wednesday";
            default: return "Unknown";
          }
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "switch.ts")]);

      expect(result.averageComplexity).toBe(4); // 1 base + 3 cases
    });

    it("should handle try-catch", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "trycatch.ts"),
        `
        function parseJSON(str: string): any {
          try {
            return JSON.parse(str);
          } catch (e) {
            return null;
          }
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "trycatch.ts")]);

      expect(result.averageComplexity).toBe(2); // 1 base + 1 catch
    });
  });

  describe("Multiple Functions", () => {
    it("should analyze multiple functions in a file", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "multiple.ts"),
        `
        function add(a: number, b: number): number {
          return a + b; // Complexity: 1
        }

        function isEven(n: number): boolean {
          return n % 2 === 0; // Complexity: 1
        }

        function max(a: number, b: number): number {
          if (a > b) return a;
          return b; // Complexity: 2
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "multiple.ts")]);

      expect(result.totalFunctions).toBe(3);
      expect(result.averageComplexity).toBeCloseTo((1 + 1 + 2) / 3, 1);
    });

    it("should handle arrow functions", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "arrows.ts"),
        `
        const double = (x: number) => x * 2;
        const isPositive = (x: number) => x > 0;
        const clamp = (x: number, min: number, max: number) => {
          if (x < min) return min;
          if (x > max) return max;
          return x;
        };
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "arrows.ts")]);

      expect(result.totalFunctions).toBeGreaterThanOrEqual(3);
      expect(result.files[0]?.functions.some((f) => f.name === "double")).toBe(true);
    });

    it("should handle class methods", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "class.ts"),
        `
        class Calculator {
          add(a: number, b: number): number {
            return a + b;
          }

          subtract(a: number, b: number): number {
            return a - b;
          }

          divide(a: number, b: number): number {
            if (b === 0) throw new Error("Division by zero");
            return a / b;
          }
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "class.ts")]);

      expect(result.totalFunctions).toBeGreaterThanOrEqual(3);
      expect(result.files[0]?.functions.some((f) => f.name === "add")).toBe(true);
      expect(result.files[0]?.functions.some((f) => f.name === "divide")).toBe(true);
    });
  });

  describe("Score Calculation", () => {
    it("should give 100 score for low complexity (avg <= 5)", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "lowComplexity.ts"),
        `
        function a() { return 1; }
        function b() { return 2; }
        function c() { return 3; }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "lowComplexity.ts")]);

      expect(result.averageComplexity).toBeLessThanOrEqual(5);
      expect(result.score).toBe(100);
    });

    it("should decrease score for high complexity", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "highComplexity.ts"),
        `
        function complex(x: number): string {
          if (x > 100) return "a";
          if (x > 90) return "b";
          if (x > 80) return "c";
          if (x > 70) return "d";
          if (x > 60) return "e";
          if (x > 50) return "f";
          if (x > 40) return "g";
          if (x > 30) return "h";
          if (x > 20) return "i";
          if (x > 10) return "j";
          return "k";
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "highComplexity.ts")]);

      expect(result.averageComplexity).toBeGreaterThan(5);
      expect(result.score).toBeLessThan(100);
    });
  });

  describe("Maintainability Index", () => {
    it("should calculate maintainability index", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "maintainable.ts"),
        `
        function simple() {
          return "hello";
        }
      `,
      );

      const analyzer = new ComplexityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "maintainable.ts")]);

      expect(result.maintainabilityIndex).toBeGreaterThan(0);
      expect(result.maintainabilityIndex).toBeLessThanOrEqual(100);
    });
  });

  afterAll(async () => {
    // Cleanup temp directories
    const tempDirs = await import("glob").then((g) =>
      g.glob(join(tmpdir(), "coco-complexity-test-*")),
    );
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("DuplicationAnalyzer", () => {
  it("should detect no duplication in unique code", async () => {
    const tempDir = await createTempProject();
    await writeFile(
      join(tempDir, "unique1.ts"),
      `
      function one() { return 1; }
    `,
    );
    await writeFile(
      join(tempDir, "unique2.ts"),
      `
      function two() { return 2; }
    `,
    );

    const analyzer = new DuplicationAnalyzer(tempDir, 3);
    const result = await analyzer.analyze([
      join(tempDir, "unique1.ts"),
      join(tempDir, "unique2.ts"),
    ]);

    expect(result.duplicates.length).toBe(0);
    expect(result.percentage).toBe(0);
  });

  it("should detect duplicate code blocks", async () => {
    const tempDir = await createTempProject();
    const duplicateCode = `
      if (x > 0) {
        console.log("positive");
        return true;
      }
    `;

    await writeFile(
      join(tempDir, "file1.ts"),
      `
      function checkPositive(x: number): boolean {
        ${duplicateCode}
        return false;
      }
    `,
    );

    await writeFile(
      join(tempDir, "file2.ts"),
      `
      function validatePositive(x: number): boolean {
        ${duplicateCode}
        return false;
      }
    `,
    );

    const analyzer = new DuplicationAnalyzer(tempDir, 3);
    const result = await analyzer.analyze([join(tempDir, "file1.ts"), join(tempDir, "file2.ts")]);

    expect(result.duplicates.length).toBeGreaterThan(0);
    expect(result.percentage).toBeGreaterThan(0);
  });

  it("should report duplication percentage", async () => {
    const tempDir = await createTempProject();

    await writeFile(
      join(tempDir, "dup1.ts"),
      `
      const a = 1;
      const b = 2;
      const c = 3;
      const d = 4;
      const e = 5;
    `,
    );

    await writeFile(
      join(tempDir, "dup2.ts"),
      `
      const a = 1;
      const b = 2;
      const c = 3;
      const d = 4;
      const e = 5;
    `,
    );

    const analyzer = new DuplicationAnalyzer(tempDir, 3);
    const result = await analyzer.analyze([join(tempDir, "dup1.ts"), join(tempDir, "dup2.ts")]);

    expect(result.totalLines).toBeGreaterThan(0);
    expect(result.duplicateLines).toBeGreaterThan(0);
    expect(result.percentage).toBeGreaterThan(0);
  });
});

// Helper function
async function createTempProject(): Promise<string> {
  const tempDir = join(
    tmpdir(),
    `coco-complexity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}
