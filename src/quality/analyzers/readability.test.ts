/**
 * Tests for Readability Analyzer
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReadabilityAnalyzer } from "./readability.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "coco-readability-test-"));
  return tempDir;
}

describe("ReadabilityAnalyzer", () => {
  describe("Naming Score", () => {
    it("should score >= 80 for good descriptive names", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "good-names.ts");
      await writeFile(
        filePath,
        `
function getUserName(userId: string): string {
  const userName = "test";
  return userName;
}

function processData(input: string[]): string[] {
  const results = input.map((item) => item.trim());
  return results;
}

function calculateTotal(prices: number[]): number {
  const total = prices.reduce((sum, price) => sum + price, 0);
  return total;
}
`,
      );

      const analyzer = new ReadabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.namingScore).toBeGreaterThanOrEqual(80);
    });

    it("should score low (< 50) for single-char non-allowed names", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "bad-names.ts");
      await writeFile(
        filePath,
        `
function a(b: number, c: number): number {
  const d = b + c;
  return d;
}

function f(g: string): string {
  const h = g.trim();
  return h;
}

function m(p: number, q: number): number {
  const r = p * q;
  return r;
}
`,
      );

      const analyzer = new ReadabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.namingScore).toBeLessThan(50);
    });
  });

  describe("Function Length Score", () => {
    it("should score >= 80 for short functions (<= 20 lines)", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "short-functions.ts");
      await writeFile(
        filePath,
        `
function greetUser(name: string): string {
  const greeting = "Hello";
  const message = greeting + " " + name;
  return message;
}

function addNumbers(first: number, second: number): number {
  const result = first + second;
  return result;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return year + "-" + month + "-" + day;
}
`,
      );

      const analyzer = new ReadabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.functionLengthScore).toBeGreaterThanOrEqual(80);
      expect(result.averageFunctionLength).toBeLessThanOrEqual(20);
    });

    it("should score < 50 for long functions (60+ lines)", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "long-function.ts");

      // Build a function with 65 lines of statements
      const lines: string[] = [];
      lines.push("function veryLongFunction(input: number): number {");
      lines.push("  let result = input;");
      for (let idx = 0; idx < 60; idx++) {
        lines.push(`  result = result + ${idx};`);
      }
      lines.push("  return result;");
      lines.push("}");

      await writeFile(filePath, lines.join("\n"));

      const analyzer = new ReadabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.averageFunctionLength).toBeGreaterThanOrEqual(60);
      // functionLengthScore = 100 - (60 - 20) * 2.5 = 100 - 100 = 0
      expect(result.functionLengthScore).toBeLessThan(50);
    });
  });

  describe("Nesting Depth Score", () => {
    it("should score >= 80 for low nesting (depth 1-2)", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "low-nesting.ts");
      await writeFile(
        filePath,
        `
function checkValue(value: number): string {
  if (value > 0) {
    return "positive";
  }
  return "non-positive";
}

function processItem(item: string): string {
  if (item.length > 0) {
    return item.toUpperCase();
  }
  return "";
}
`,
      );

      const analyzer = new ReadabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.maxNestingDepth).toBeLessThanOrEqual(2);
      // nestingDepthScore = 100 - (maxNesting - 2) * 20
      // At depth 2: 100 - 0 = 100, at depth 1: clamped to 100
      expect(result.nestingDepthScore).toBeGreaterThanOrEqual(80);
    });

    it("should score < 50 for deep nesting (5+ levels)", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "deep-nesting.ts");
      await writeFile(
        filePath,
        `
function deeplyNested(value: number): string {
  if (value > 0) {
    if (value > 10) {
      if (value > 100) {
        if (value > 1000) {
          if (value > 10000) {
            return "huge";
          }
          return "very large";
        }
        return "large";
      }
      return "medium";
    }
    return "small";
  }
  return "non-positive";
}
`,
      );

      const analyzer = new ReadabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.maxNestingDepth).toBeGreaterThanOrEqual(5);
      // nestingDepthScore = 100 - (5 - 2) * 20 = 100 - 60 = 40
      expect(result.nestingDepthScore).toBeLessThan(50);
    });
  });

  describe("Weighted Nesting Complexity Score", () => {
    it("should score >= 80 for simple sequential code", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "simple-code.ts");
      await writeFile(
        filePath,
        `
function computeTotal(prices: number[]): number {
  const subtotal = prices.reduce((sum, price) => sum + price, 0);
  const taxRate = 0.08;
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount;
  return total;
}

function formatCurrency(amount: number): string {
  const formatted = amount.toFixed(2);
  return "$" + formatted;
}
`,
      );

      const analyzer = new ReadabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.averageCognitiveComplexity).toBeLessThanOrEqual(5);
      expect(result.cognitiveComplexityScore).toBeGreaterThanOrEqual(80);
    });

    it("should score < 50 for high weighted nesting complexity with nested if/for/while and logical operators", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "complex-code.ts");
      await writeFile(
        filePath,
        `
function complexProcess(items: number[]): number {
  let result = 0;
  for (let idx = 0; idx < items.length; idx++) {
    if (items[idx] > 0 && items[idx] < 100) {
      for (let jdx = 0; jdx < items[idx]; jdx++) {
        if (jdx % 2 === 0 || jdx % 3 === 0) {
          while (result < jdx && result > -100) {
            if (result > 50 || result < -50) {
              result = result + 1;
            } else {
              result = result - 1;
            }
          }
        }
      }
    } else if (items[idx] >= 100) {
      if (items[idx] > 200 && items[idx] < 500) {
        result = result + items[idx];
      }
    }
  }
  return result;
}
`,
      );

      const analyzer = new ReadabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.averageCognitiveComplexity).toBeGreaterThan(15);
      // cognitiveComplexityScore = 100 - (avgComplexity - 5) * 5
      // With avg > 15: 100 - (15 - 5) * 5 = 100 - 50 = 50 (at 15), lower for higher
      expect(result.cognitiveComplexityScore).toBeLessThan(50);
    });
  });

  describe("Edge Cases", () => {
    it("should return score 100 for an empty file", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "empty.ts");
      await writeFile(filePath, "");

      const analyzer = new ReadabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.score).toBe(100);
      expect(result.namingScore).toBe(100);
      expect(result.functionLengthScore).toBe(100);
      expect(result.nestingDepthScore).toBe(100);
      expect(result.cognitiveComplexityScore).toBe(100);
    });
  });

  describe("Details", () => {
    it("should contain good names count, avg func length, max nesting, and avg weighted complexity in details", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "details.ts");
      await writeFile(
        filePath,
        `
function calculateSum(numbers: number[]): number {
  let total = 0;
  for (const num of numbers) {
    total = total + num;
  }
  return total;
}
`,
      );

      const analyzer = new ReadabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.details).toContain("good names");
      expect(result.details).toContain("avg func");
      expect(result.details).toContain("max nesting");
      expect(result.details).toContain("avg weighted complexity");
    });
  });
});
