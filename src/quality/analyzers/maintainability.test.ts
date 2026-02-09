/**
 * Tests for Maintainability Analyzer
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MaintainabilityAnalyzer } from "./maintainability.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "coco-maintainability-test-"));
  return tempDir;
}

describe("MaintainabilityAnalyzer", () => {
  describe("Short File", () => {
    it("should score high for a short file with few functions and imports", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "short-file.ts");

      // ~50 lines, 3 functions, 2 imports
      const lines: string[] = [];
      lines.push('import { readFile } from "node:fs/promises";');
      lines.push('import { join } from "node:path";');
      lines.push("");
      lines.push("function getUserName(userId: string): string {");
      lines.push('  const name = "user_" + userId;');
      lines.push("  return name;");
      lines.push("}");
      lines.push("");
      lines.push("function processInput(data: string): string {");
      lines.push("  return data.trim();");
      lines.push("}");
      lines.push("");
      lines.push("function formatOutput(value: number): string {");
      lines.push("  return value.toFixed(2);");
      lines.push("}");
      // Pad to ~50 lines with blank/comment lines
      for (let idx = 0; idx < 35; idx++) {
        lines.push(`// line ${idx + 16}`);
      }

      await writeFile(filePath, lines.join("\n"));

      const analyzer = new MaintainabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      // ~50 lines -> fileLengthScore = 100 (50 < 200)
      expect(result.fileLengthScore).toBe(100);
      // 3 functions -> functionCountScore = 100 (3 < 10)
      expect(result.functionCountScore).toBe(100);
      // 2 imports -> dependencyCountScore = 100 (2 < 5)
      expect(result.dependencyCountScore).toBe(100);
      expect(result.fileCount).toBe(1);
    });
  });

  describe("Long File", () => {
    it("should score fileLengthScore < 50 for a file with 500+ lines", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "long-file.ts");

      const lines: string[] = [];
      lines.push("function placeholder(): void {");
      lines.push("  return;");
      lines.push("}");
      // Pad to 510 lines total
      for (let idx = 3; idx < 510; idx++) {
        lines.push(`// filler line ${idx}`);
      }

      await writeFile(filePath, lines.join("\n"));

      const analyzer = new MaintainabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.averageFileLength).toBeGreaterThanOrEqual(500);
      // fileLengthScore = max(0, 100 - (510 - 200) * 0.33) = max(0, 100 - 102.3) = 0
      expect(result.fileLengthScore).toBeLessThan(50);
    });
  });

  describe("Many Functions", () => {
    it("should score functionCountScore < 50 for a file with 20+ functions", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "many-functions.ts");

      const lines: string[] = [];
      for (let idx = 0; idx < 22; idx++) {
        lines.push(`function func${String(idx).padStart(2, "0")}(): number {`);
        lines.push(`  return ${idx};`);
        lines.push("}");
        lines.push("");
      }

      await writeFile(filePath, lines.join("\n"));

      const analyzer = new MaintainabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.averageFunctionsPerFile).toBeGreaterThanOrEqual(20);
      // functionCountScore = max(0, 100 - (22 - 10) * 5) = max(0, 100 - 60) = 40
      expect(result.functionCountScore).toBeLessThan(50);
    });
  });

  describe("Many Imports", () => {
    it("should score dependencyCountScore < 50 for a file with 15 imports", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "many-imports.ts");

      const lines: string[] = [];
      for (let idx = 0; idx < 16; idx++) {
        lines.push(`import { thing${idx} } from "package-${idx}";`);
      }
      lines.push("");
      lines.push("function placeholder(): void {");
      lines.push("  return;");
      lines.push("}");

      await writeFile(filePath, lines.join("\n"));

      const analyzer = new MaintainabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.averageImportsPerFile).toBeGreaterThanOrEqual(15);
      // dependencyCountScore = max(0, 100 - (16 - 5) * 5) = max(0, 100 - 55) = 45
      expect(result.dependencyCountScore).toBeLessThan(50);
    });
  });

  describe("Coupling", () => {
    it("should score couplingScore < 80 for a file with mostly ../ imports", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "high-coupling.ts");

      const lines: string[] = [];
      // 8 cross-boundary imports
      for (let idx = 0; idx < 8; idx++) {
        lines.push(`import { mod${idx} } from "../other/module${idx}.js";`);
      }
      // 2 same-directory imports
      lines.push('import { local1 } from "./local1.js";');
      lines.push('import { local2 } from "./local2.js";');
      lines.push("");
      lines.push("function placeholder(): void {");
      lines.push("  return;");
      lines.push("}");

      await writeFile(filePath, lines.join("\n"));

      const analyzer = new MaintainabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      // crossBoundaryRatio = 8 / 10 = 0.8
      // couplingScore = max(0, 100 - 0.8 * 100 * 0.5) = 100 - 40 = 60
      expect(result.couplingScore).toBeLessThan(80);
    });

    it("should score couplingScore >= 90 for same-dir and node: imports only", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "low-coupling.ts");

      await writeFile(
        filePath,
        `
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { helper } from "./helper.js";
import { utils } from "./utils.js";

function placeholder(): void {
  return;
}
`,
      );

      const analyzer = new MaintainabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      // node: imports and ./ imports are not cross-boundary
      // crossBoundaryRatio = 0 / 4 = 0
      // couplingScore = 100 - 0 = 100
      expect(result.couplingScore).toBeGreaterThanOrEqual(90);
    });
  });

  describe("Empty File List", () => {
    it("should return score 100 and fileCount 0 for empty file list", async () => {
      const dir = await createTempDir();

      const analyzer = new MaintainabilityAnalyzer(dir);
      const result = await analyzer.analyze([]);

      expect(result.score).toBe(100);
      expect(result.fileCount).toBe(0);
      expect(result.fileLengthScore).toBe(100);
      expect(result.functionCountScore).toBe(100);
      expect(result.dependencyCountScore).toBe(100);
      expect(result.couplingScore).toBe(100);
      expect(result.averageFileLength).toBe(0);
      expect(result.averageFunctionsPerFile).toBe(0);
      expect(result.averageImportsPerFile).toBe(0);
    });
  });

  describe("Multiple Files", () => {
    it("should compute averages across multiple files", async () => {
      const dir = await createTempDir();

      const file1 = join(dir, "fileA.ts");
      const file2 = join(dir, "fileB.ts");

      // File A: ~20 lines, 2 functions, 1 import
      await writeFile(
        file1,
        `
import { join } from "node:path";

function alpha(): number {
  return 1;
}

function beta(): number {
  return 2;
}
`,
      );

      // File B: ~20 lines, 4 functions, 3 imports
      await writeFile(
        file2,
        `
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolve } from "node:path";

function gamma(): number {
  return 3;
}

function delta(): number {
  return 4;
}

function epsilon(): string {
  return "five";
}

function zeta(): boolean {
  return true;
}
`,
      );

      const analyzer = new MaintainabilityAnalyzer(dir);
      const result = await analyzer.analyze([file1, file2]);

      expect(result.fileCount).toBe(2);
      // Average functions per file: (2 + 4) / 2 = 3
      expect(result.averageFunctionsPerFile).toBe(3);
      // Average imports per file: (1 + 3) / 2 = 2
      expect(result.averageImportsPerFile).toBe(2);
      // Average file length should be the average of both file line counts
      expect(result.averageFileLength).toBeGreaterThan(0);
    });
  });

  describe("Details", () => {
    it("should contain avg lines/file, avg functions/file, avg imports/file, and coupling %", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "details-check.ts");

      await writeFile(
        filePath,
        `
import { readFile } from "node:fs/promises";

function doSomething(): void {
  return;
}

function doMore(): void {
  return;
}
`,
      );

      const analyzer = new MaintainabilityAnalyzer(dir);
      const result = await analyzer.analyze([filePath]);

      expect(result.details).toContain("avg lines/file");
      expect(result.details).toContain("avg functions/file");
      expect(result.details).toContain("avg imports/file");
      expect(result.details).toContain("cross-boundary coupling");
    });
  });
});
