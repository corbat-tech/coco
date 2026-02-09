/**
 * Behavioral tests for RobustnessAnalyzer
 * Uses real temporary files with specific code patterns to verify
 * detection of error handling, defensive coding, and input validation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RobustnessAnalyzer } from "./robustness.js";

describe("RobustnessAnalyzer", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "robustness-test-"));
    await mkdir(join(testDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("code with try/catch in all functions", () => {
    it("should report high tryCatchRatio when every function has error handling", async () => {
      const filePath = join(testDir, "src", "safe.ts");
      await writeFile(
        filePath,
        `export function readConfig(path: string): string {
  try {
    return JSON.parse(path);
  } catch (e) {
    return "{}";
  }
}

export function parseData(input: string): object {
  try {
    return JSON.parse(input);
  } catch (e) {
    return {};
  }
}

export function loadModule(name: string): any {
  try {
    return require(name);
  } catch (e) {
    return null;
  }
}`,
      );

      const analyzer = new RobustnessAnalyzer(testDir);
      const result = await analyzer.analyze([filePath]);

      expect(result.functionsAnalyzed).toBe(3);
      expect(result.functionsWithErrorHandling).toBe(3);
      expect(result.tryCatchRatio).toBe(100);
      // Score should be high because of the try/catch ratio
      expect(result.score).toBeGreaterThanOrEqual(40);
    });
  });

  describe("code with no error handling", () => {
    it("should report low score when functions lack try/catch, validation, and defensive patterns", async () => {
      const filePath = join(testDir, "src", "unsafe.ts");
      await writeFile(
        filePath,
        `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function greet(name: string): string {
  return "Hello " + name;
}

export function getLength(arr: any[]): number {
  return arr.length;
}`,
      );

      const analyzer = new RobustnessAnalyzer(testDir);
      const result = await analyzer.analyze([filePath]);

      expect(result.functionsAnalyzed).toBe(4);
      expect(result.functionsWithErrorHandling).toBe(0);
      expect(result.tryCatchRatio).toBe(0);
      expect(result.optionalChainingCount).toBe(0);
      expect(result.nullishCoalescingCount).toBe(0);
      expect(result.inputValidationScore).toBe(0);
      expect(result.defensiveCodingScore).toBe(0);
      expect(result.score).toBe(0);
    });
  });

  describe("code with optional chaining and nullish coalescing", () => {
    it("should produce higher defensiveCodingScore with ?. and ?? patterns", async () => {
      const filePath = join(testDir, "src", "defensive.ts");
      await writeFile(
        filePath,
        `export function getUserName(user: any): string {
  return user?.profile?.name ?? "Unknown";
}

export function getAddress(user: any): string {
  const street = user?.address?.street ?? "N/A";
  const city = user?.address?.city ?? "N/A";
  return street + ", " + city;
}

export function getAge(user: any): number {
  return user?.age ?? 0;
}`,
      );

      const analyzer = new RobustnessAnalyzer(testDir);
      const result = await analyzer.analyze([filePath]);

      expect(result.functionsAnalyzed).toBe(3);
      // Each ?. is detected via MemberExpression.optional or ChainExpression
      expect(result.optionalChainingCount).toBeGreaterThanOrEqual(5);
      // Each ?? is detected
      expect(result.nullishCoalescingCount).toBeGreaterThanOrEqual(4);
      // defensiveCodingScore = min(100, (optionalChaining + nullishCoalescing) / functions * 40)
      // With at least 9 defensive patterns across 3 functions: (9/3) * 40 = 120 -> clamped to 100
      expect(result.defensiveCodingScore).toBeGreaterThanOrEqual(40);
      expect(result.score).toBeGreaterThan(0);
    });
  });

  describe("code with null checks and typeof checks", () => {
    it("should produce higher inputValidationScore with validation patterns", async () => {
      const filePath = join(testDir, "src", "validated.ts");
      await writeFile(
        filePath,
        `export function processValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return value.toUpperCase();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return String(value);
}

export function safeParse(input: unknown): object {
  if (input === null || input === undefined) {
    return {};
  }
  if (typeof input !== "string") {
    return {};
  }
  return JSON.parse(input);
}`,
      );

      const analyzer = new RobustnessAnalyzer(testDir);
      const result = await analyzer.analyze([filePath]);

      expect(result.functionsAnalyzed).toBe(2);
      // typeof checks: "string", "number", "string" -> 3 typeofChecks
      // null checks: value === null, value === undefined, input === null, input === undefined -> 4 nullChecks
      expect(result.inputValidationScore).toBeGreaterThan(0);

      // inputValidationScore = min(100, (typeGuards + typeofChecks + nullChecks) / functions * 50)
      // At least (0 + 3 + 4) / 2 * 50 = 175 -> clamped to 100
      expect(result.inputValidationScore).toBe(100);
      // Score should reflect the input validation
      expect(result.score).toBeGreaterThanOrEqual(30);
    });
  });

  describe("empty file", () => {
    it("should return score 0 for an empty file with no functions", async () => {
      const filePath = join(testDir, "src", "empty.ts");
      await writeFile(filePath, ``);

      const analyzer = new RobustnessAnalyzer(testDir);
      const result = await analyzer.analyze([filePath]);

      expect(result.score).toBe(0);
      expect(result.functionsAnalyzed).toBe(0);
      expect(result.functionsWithErrorHandling).toBe(0);
      expect(result.tryCatchRatio).toBe(0);
      expect(result.optionalChainingCount).toBe(0);
      expect(result.nullishCoalescingCount).toBe(0);
      expect(result.inputValidationScore).toBe(0);
      expect(result.defensiveCodingScore).toBe(0);
    });
  });

  describe("mixed robustness patterns", () => {
    it("should compute a weighted score combining try/catch, validation, and defensive coding", async () => {
      const filePath = join(testDir, "src", "mixed.ts");
      await writeFile(
        filePath,
        `export function fetchData(url: string): any {
  if (typeof url !== "string") {
    return null;
  }
  try {
    const response = JSON.parse(url);
    return response?.data ?? [];
  } catch (e) {
    return [];
  }
}

export function transform(input: unknown): string {
  if (input === null || input === undefined) {
    return "";
  }
  return String(input);
}`,
      );

      const analyzer = new RobustnessAnalyzer(testDir);
      const result = await analyzer.analyze([filePath]);

      expect(result.functionsAnalyzed).toBe(2);
      // fetchData has try/catch -> 1 function with error handling
      expect(result.functionsWithErrorHandling).toBeGreaterThanOrEqual(1);
      // tryCatchRatio = (1/2)*100 = 50
      expect(result.tryCatchRatio).toBe(50);
      // Has typeof check, null/undefined checks, optional chaining, nullish coalescing
      expect(result.optionalChainingCount).toBeGreaterThanOrEqual(1);
      expect(result.nullishCoalescingCount).toBeGreaterThanOrEqual(1);

      // Overall score: 40% tryCatch + 30% inputValidation + 30% defensiveCoding
      // All sub-scores are > 0, so overall should be meaningful
      expect(result.score).toBeGreaterThan(20);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe("type guard detection", () => {
    it("should count type alias declarations as type guards", async () => {
      const filePath = join(testDir, "src", "guards.ts");
      await writeFile(
        filePath,
        `type UserId = string & { __brand: "UserId" };
type OrderId = number & { __brand: "OrderId" };

export function createUserId(id: string): UserId {
  if (typeof id !== "string") {
    throw new Error("Invalid user id");
  }
  return id as UserId;
}`,
      );

      const analyzer = new RobustnessAnalyzer(testDir);
      const result = await analyzer.analyze([filePath]);

      // Two type alias declarations count as type guards
      expect(result.typeGuardCount).toBe(2);
      // typeof check counts toward input validation
      expect(result.inputValidationScore).toBeGreaterThan(0);
    });
  });

  describe("details string", () => {
    it("should include function counts, defensive patterns, and validation checks in details", async () => {
      const filePath = join(testDir, "src", "detailed.ts");
      await writeFile(
        filePath,
        `export function safe(x: unknown): string {
  try {
    if (x === null) return "";
    return x?.toString() ?? "";
  } catch {
    return "";
  }
}`,
      );

      const analyzer = new RobustnessAnalyzer(testDir);
      const result = await analyzer.analyze([filePath]);

      expect(result.details).toContain("functions with error handling");
      expect(result.details).toContain("optional chaining");
      expect(result.details).toContain("nullish coalescing");
      expect(result.details).toContain("validation checks");
    });
  });

  describe("multiple files aggregation", () => {
    it("should aggregate metrics across multiple files", async () => {
      const file1 = join(testDir, "src", "a.ts");
      const file2 = join(testDir, "src", "b.ts");

      await writeFile(
        file1,
        `export function funcA(x: unknown): string {
  try {
    return String(x);
  } catch {
    return "";
  }
}`,
      );

      await writeFile(
        file2,
        `export function funcB(y: unknown): number {
  if (typeof y === "number") {
    return y;
  }
  return 0;
}`,
      );

      const analyzer = new RobustnessAnalyzer(testDir);
      const result = await analyzer.analyze([file1, file2]);

      // 2 functions total across both files
      expect(result.functionsAnalyzed).toBe(2);
      // funcA has try/catch
      expect(result.functionsWithErrorHandling).toBe(1);
      // tryCatchRatio = 50%
      expect(result.tryCatchRatio).toBe(50);
      // funcB has typeof check
      expect(result.inputValidationScore).toBeGreaterThan(0);
    });
  });
});
