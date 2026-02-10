/**
 * Tests for Documentation Analyzer
 */

import { describe, it, expect, afterAll } from "vitest";
import { DocumentationAnalyzer } from "./documentation.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { glob } from "glob";

describe("DocumentationAnalyzer", () => {
  describe("JSDoc Coverage", () => {
    it("should report 100% jsdocCoverage when all exports have JSDoc", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "fully-documented.ts"),
        `/** Adds two numbers */
export function add(a: number, b: number): number {
  return a + b;
}

/** User interface */
export interface User {
  name: string;
  age: number;
}

/** Default greeting */
export const GREETING = "hello";

/** Multiplies two numbers */
export function multiply(a: number, b: number): number {
  return a * b;
}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "fully-documented.ts")]);

      expect(result.exportedDeclarations).toBe(4);
      expect(result.documentedDeclarations).toBe(4);
      expect(result.jsdocCoverage).toBe(100);
    });

    it("should report 0% jsdocCoverage when no exports have JSDoc", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "undocumented.ts"),
        `export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export interface Config {
  port: number;
}

export type Status = "active" | "inactive";
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "undocumented.ts")]);

      expect(result.exportedDeclarations).toBe(4);
      expect(result.documentedDeclarations).toBe(0);
      expect(result.jsdocCoverage).toBe(0);
    });

    it("should report proportional jsdocCoverage for mixed documentation", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "mixed.ts"),
        `/** Documented function */
export function documented(): void {}

export function undocumented1(): void {}

/** Another documented export */
export const CONSTANT = 42;

export function undocumented2(): void {}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "mixed.ts")]);

      expect(result.exportedDeclarations).toBe(4);
      expect(result.documentedDeclarations).toBe(2);
      expect(result.jsdocCoverage).toBe(50);
    });

    it("should recognize multiline JSDoc comments", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "multiline.ts"),
        `/**
 * Creates a user with the given name.
 * @param name - The user's name
 * @returns A new user object
 */
export function createUser(name: string): { name: string } {
  return { name };
}

/**
 * Validates input data.
 *
 * Performs thorough validation including:
 * - Type checking
 * - Range validation
 * - Format verification
 */
export function validate(data: unknown): boolean {
  return true;
}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "multiline.ts")]);

      expect(result.exportedDeclarations).toBe(2);
      expect(result.documentedDeclarations).toBe(2);
      expect(result.jsdocCoverage).toBe(100);
    });

    it("should not count regular comments as JSDoc", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "regular-comments.ts"),
        `// This is a regular comment
export function notDocumented(): void {}

/* This is a block comment but not JSDoc */
export function alsoNotDocumented(): void {}

/** This IS a JSDoc comment */
export function documented(): void {}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "regular-comments.ts")]);

      expect(result.exportedDeclarations).toBe(3);
      expect(result.documentedDeclarations).toBe(1);
      expect(result.jsdocCoverage).toBeCloseTo((1 / 3) * 100, 0);
    });

    it("should handle exported classes", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "class.ts"),
        `/** A service class */
export class UserService {
  getUser(id: string) { return null; }
}

export class UndocumentedService {
  process() {}
}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "class.ts")]);

      expect(result.exportedDeclarations).toBe(2);
      expect(result.documentedDeclarations).toBe(1);
      expect(result.jsdocCoverage).toBe(50);
    });
  });

  describe("README Detection", () => {
    it("should detect README.md and add 20 points to score", async () => {
      const tempDir = await createTempProject();
      await writeFile(join(tempDir, "README.md"), "# My Project\nSome description.");
      await writeFile(
        join(tempDir, "index.ts"),
        `/** Entry point */
export function main(): void {}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "index.ts")]);

      expect(result.hasReadme).toBe(true);
      // Score = 100 * 0.7 (jsdocCoverage) + 20 (readme) = 90
      expect(result.score).toBe(90);
    });

    it("should report hasReadme false when README.md is missing", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "index.ts"),
        `/** Entry point */
export function main(): void {}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "index.ts")]);

      expect(result.hasReadme).toBe(false);
      // Score = 100 * 0.7 + 0 = 70
      expect(result.score).toBe(70);
    });
  });

  describe("CHANGELOG Detection", () => {
    it("should detect CHANGELOG.md and add 10 points to score", async () => {
      const tempDir = await createTempProject();
      await writeFile(join(tempDir, "CHANGELOG.md"), "# Changelog\n## 1.0.0\n- Initial release");
      await writeFile(
        join(tempDir, "lib.ts"),
        `/** Helper */
export function helper(): void {}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "lib.ts")]);

      expect(result.hasChangelog).toBe(true);
      // Score = 100 * 0.7 + 0 (no readme) + 10 (changelog) = 80
      expect(result.score).toBe(80);
    });

    it("should detect CHANGES.md as an alternative changelog", async () => {
      const tempDir = await createTempProject();
      await writeFile(join(tempDir, "CHANGES.md"), "# Changes");
      await writeFile(
        join(tempDir, "lib.ts"),
        `/** Helper */
export function helper(): void {}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "lib.ts")]);

      expect(result.hasChangelog).toBe(true);
    });

    it("should report hasChangelog false when neither changelog file exists", async () => {
      const tempDir = await createTempProject();
      await writeFile(join(tempDir, "lib.ts"), `export function helper(): void {}`);

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "lib.ts")]);

      expect(result.hasChangelog).toBe(false);
    });
  });

  describe("Score Calculation", () => {
    it("should return maximum score for full JSDoc, README, and CHANGELOG", async () => {
      const tempDir = await createTempProject();
      await writeFile(join(tempDir, "README.md"), "# Project");
      await writeFile(join(tempDir, "CHANGELOG.md"), "# Changelog");
      await writeFile(
        join(tempDir, "lib.ts"),
        `/** Function A */
export function a(): void {}

/** Function B */
export function b(): void {}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "lib.ts")]);

      // Score = 100 * 0.7 + 20 + 10 = 100
      expect(result.score).toBe(100);
      expect(result.jsdocCoverage).toBe(100);
      expect(result.hasReadme).toBe(true);
      expect(result.hasChangelog).toBe(true);
    });

    it("should return 30 for no JSDoc but README + CHANGELOG", async () => {
      const tempDir = await createTempProject();
      await writeFile(join(tempDir, "README.md"), "# Project");
      await writeFile(join(tempDir, "CHANGELOG.md"), "# Changelog");
      await writeFile(
        join(tempDir, "lib.ts"),
        `export function undocumented(): void {}
export function alsoUndocumented(): void {}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "lib.ts")]);

      // Score = 0 * 0.7 + 20 + 10 = 30
      expect(result.score).toBe(30);
      expect(result.jsdocCoverage).toBe(0);
    });

    it("should return 0 for no exports, no README, no CHANGELOG", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "internal.ts"),
        `// No exports
function privateHelper() { return 1; }
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "internal.ts")]);

      expect(result.jsdocCoverage).toBe(0);
      expect(result.hasReadme).toBe(false);
      expect(result.hasChangelog).toBe(false);
      expect(result.score).toBe(0);
    });
  });

  describe("Multiple Files", () => {
    it("should aggregate documentation counts across files", async () => {
      const tempDir = await createTempProject();

      await writeFile(
        join(tempDir, "a.ts"),
        `/** Documented A */
export function a(): void {}
`,
      );

      await writeFile(
        join(tempDir, "b.ts"),
        `export function b(): void {}

/** Documented C */
export function c(): void {}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "a.ts"), join(tempDir, "b.ts")]);

      // a.ts: 1 exported, 1 documented; b.ts: 2 exported, 1 documented
      expect(result.exportedDeclarations).toBe(3);
      expect(result.documentedDeclarations).toBe(2);
      expect(result.jsdocCoverage).toBeCloseTo((2 / 3) * 100, 0);
    });
  });

  describe("Details String", () => {
    it("should produce a human-readable details string", async () => {
      const tempDir = await createTempProject();
      await writeFile(join(tempDir, "README.md"), "# Readme");
      await writeFile(
        join(tempDir, "lib.ts"),
        `/** Documented */
export function fn(): void {}

export function undoc(): void {}
`,
      );

      const analyzer = new DocumentationAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "lib.ts")]);

      expect(result.details).toContain("1/2 exports documented");
      expect(result.details).toContain("README: yes");
      expect(result.details).toContain("CHANGELOG: no");
    });
  });

  afterAll(async () => {
    const tempDirs = await glob(join(tmpdir(), "coco-docs-test-*"));
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function createTempProject(): Promise<string> {
  const tempDir = join(
    tmpdir(),
    `coco-docs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}
