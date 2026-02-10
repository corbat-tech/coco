/**
 * Behavioral tests for CompletenessAnalyzer
 * Uses real temporary directories with real files to test export density,
 * test file ratio, and entry point detection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompletenessAnalyzer } from "./completeness.js";

describe("CompletenessAnalyzer", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "completeness-test-"));
    await mkdir(join(testDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("project with exports and matching test files", () => {
    it("should produce a high score when all source files have exports and tests", async () => {
      // Create source files with exports
      await writeFile(
        join(testDir, "src", "math.ts"),
        `export function add(a: number, b: number): number { return a + b; }
export function subtract(a: number, b: number): number { return a - b; }`,
      );

      await writeFile(
        join(testDir, "src", "strings.ts"),
        `export function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
export function lowercase(s: string): string { return s.toLowerCase(); }`,
      );

      // Create matching test files
      await writeFile(
        join(testDir, "src", "math.test.ts"),
        `import { add, subtract } from "./math.js";
describe("math", () => { it("adds", () => { expect(add(1,2)).toBe(3); }); });`,
      );

      await writeFile(
        join(testDir, "src", "strings.test.ts"),
        `import { capitalize } from "./strings.js";
describe("strings", () => { it("capitalizes", () => { expect(capitalize("a")).toBe("A"); }); });`,
      );

      // Create entry point
      await writeFile(
        join(testDir, "src", "index.ts"),
        `export { add, subtract } from "./math.js";
export { capitalize, lowercase } from "./strings.js";`,
      );

      const analyzer = new CompletenessAnalyzer(testDir);
      const result = await analyzer.analyze();

      // exportDensity: all 3 source files (math, strings, index) have exports -> 100%
      // testFileRatio: 2 out of 3 source files (math, strings) have matching test files -> ~66.7%
      // hasEntryPoint: true (src/index.ts) -> 20 points
      expect(result.exportDensity).toBe(100);
      expect(result.testFileRatio).toBeGreaterThan(60);
      expect(result.hasEntryPoint).toBe(true);
      expect(result.score).toBeGreaterThan(70);
      expect(result.totalExports).toBeGreaterThanOrEqual(6); // 2 + 2 + 2 re-exports
    });
  });

  describe("project with source files but no test files", () => {
    it("should return low testFileRatio when no test files exist", async () => {
      await writeFile(
        join(testDir, "src", "service.ts"),
        `export class UserService {
  getUser(id: string) { return { id, name: "test" }; }
}`,
      );

      await writeFile(
        join(testDir, "src", "utils.ts"),
        `export function formatDate(date: Date): string { return date.toISOString(); }`,
      );

      const analyzer = new CompletenessAnalyzer(testDir);
      const result = await analyzer.analyze();

      expect(result.testFileRatio).toBe(0);
      expect(result.testFileCount).toBe(0);
      expect(result.sourceFileCount).toBe(2);
      // exportDensity should still be high (both files export)
      expect(result.exportDensity).toBe(100);
      // Score: 40 (exports max) + 0 (no tests) + 0 (no entry point) = 40
      expect(result.score).toBeLessThanOrEqual(40);
    });
  });

  describe("project with no exports", () => {
    it("should return low export density when files lack exports", async () => {
      await writeFile(
        join(testDir, "src", "internal.ts"),
        `function helper() { return 42; }
const value = helper();
console.log(value);`,
      );

      await writeFile(
        join(testDir, "src", "config.ts"),
        `const config = { port: 3000, host: "localhost" };
function getPort() { return config.port; }`,
      );

      const analyzer = new CompletenessAnalyzer(testDir);
      const result = await analyzer.analyze();

      expect(result.exportDensity).toBe(0);
      expect(result.totalExports).toBe(0);
      expect(result.sourceFileCount).toBe(2);
      // Score: 0 (no exports) + 0 (no tests) + 0 (no entry point) = 0
      expect(result.score).toBe(0);
    });
  });

  describe("project with src/index.ts entry point", () => {
    it("should detect hasEntryPoint as true when src/index.ts exists", async () => {
      await writeFile(join(testDir, "src", "index.ts"), `export const version = "1.0.0";`);

      const analyzer = new CompletenessAnalyzer(testDir);
      const result = await analyzer.analyze();

      expect(result.hasEntryPoint).toBe(true);
    });

    it("should detect hasEntryPoint via package.json main field", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({ name: "test", main: "dist/index.js" }),
      );

      // No src/index.ts, but package.json main is set
      await writeFile(
        join(testDir, "src", "app.ts"),
        `export function run() { console.log("running"); }`,
      );

      const analyzer = new CompletenessAnalyzer(testDir);
      const result = await analyzer.analyze();

      expect(result.hasEntryPoint).toBe(true);
    });

    it("should detect hasEntryPoint via package.json exports field", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({ name: "test", exports: { ".": "./dist/index.js" } }),
      );

      const analyzer = new CompletenessAnalyzer(testDir);
      const result = await analyzer.analyze();

      expect(result.hasEntryPoint).toBe(true);
    });

    it("should return hasEntryPoint false when no entry point exists", async () => {
      await writeFile(join(testDir, "src", "lib.ts"), `export function lib() { return "lib"; }`);

      const analyzer = new CompletenessAnalyzer(testDir);
      const result = await analyzer.analyze();

      expect(result.hasEntryPoint).toBe(false);
    });
  });

  describe("empty project", () => {
    it("should return score 0 when no source files exist", async () => {
      // testDir/src/ exists but is empty
      const analyzer = new CompletenessAnalyzer(testDir);
      const result = await analyzer.analyze();

      expect(result.score).toBe(0);
      expect(result.sourceFileCount).toBe(0);
      expect(result.testFileCount).toBe(0);
      expect(result.totalExports).toBe(0);
      expect(result.exportDensity).toBe(0);
      expect(result.testFileRatio).toBe(0);
      expect(result.hasEntryPoint).toBe(false);
    });
  });

  describe("score calculation breakdown", () => {
    it("should weight: 40% export density, 40% test file ratio, 20% entry point", async () => {
      // Create a project with 100% exports, 50% test coverage, and entry point
      await writeFile(
        join(testDir, "src", "index.ts"),
        `export function main() { return "main"; }`,
      );
      await writeFile(
        join(testDir, "src", "helper.ts"),
        `export function help() { return "help"; }`,
      );
      // Only one test file matching "index"
      await writeFile(
        join(testDir, "src", "index.test.ts"),
        `describe("main", () => { it("works", () => {}); });`,
      );

      const analyzer = new CompletenessAnalyzer(testDir);
      const result = await analyzer.analyze();

      // exportDensity: 100% (both files export)
      // testFileRatio: 50% (1 of 2 source files has a test)
      // hasEntryPoint: true
      expect(result.exportDensity).toBe(100);
      expect(result.testFileRatio).toBe(50);
      expect(result.hasEntryPoint).toBe(true);

      // exportScore = min(40, 100 * 0.4) = 40
      // testScore = min(40, 50 * 0.4) = 20
      // entryScore = 20
      // total = 40 + 20 + 20 = 80
      expect(result.score).toBe(80);
    });
  });

  describe("analyze with explicit file list", () => {
    it("should analyze only the specified files when files argument is provided", async () => {
      await writeFile(join(testDir, "src", "a.ts"), `export function a() { return "a"; }`);
      await writeFile(
        join(testDir, "src", "b.ts"),
        `function b() { return "b"; }`, // no export
      );

      const analyzer = new CompletenessAnalyzer(testDir);

      // Only analyze file "a.ts"
      const resultA = await analyzer.analyze([join(testDir, "src", "a.ts")]);
      expect(resultA.exportDensity).toBe(100);
      expect(resultA.totalExports).toBe(1);
      expect(resultA.sourceFileCount).toBe(1);

      // Only analyze file "b.ts"
      const resultB = await analyzer.analyze([join(testDir, "src", "b.ts")]);
      expect(resultB.exportDensity).toBe(0);
      expect(resultB.totalExports).toBe(0);
      expect(resultB.sourceFileCount).toBe(1);
    });
  });

  describe("details string", () => {
    it("should include file counts, export density, test ratio, and entry point status", async () => {
      await writeFile(join(testDir, "src", "index.ts"), `export const value = 42;`);
      await writeFile(
        join(testDir, "src", "index.test.ts"),
        `describe("test", () => { it("works", () => {}); });`,
      );

      const analyzer = new CompletenessAnalyzer(testDir);
      const result = await analyzer.analyze();

      expect(result.details).toContain("1 source files");
      expect(result.details).toContain("1 test files");
      expect(result.details).toContain("1 exports");
      expect(result.details).toContain("100.0% files have exports");
      expect(result.details).toContain("100.0% source files have tests");
      expect(result.details).toContain("Entry point: found");
    });
  });
});
