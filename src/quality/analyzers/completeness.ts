/**
 * Completeness Analyzer
 * Measures export density, test-file coverage ratio, and entry point presence
 */

import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { readFile, access } from "node:fs/promises";
import { join, basename } from "node:path";
import { glob } from "glob";
import { constants } from "node:fs";

/**
 * Completeness analysis result
 */
export interface CompletenessResult {
  score: number;
  exportDensity: number;
  testFileRatio: number;
  hasEntryPoint: boolean;
  sourceFileCount: number;
  testFileCount: number;
  totalExports: number;
  details: string;
}

/**
 * Count exported declarations in a file via AST
 */
function countExports(ast: TSESTree.Program): number {
  let exportCount = 0;

  for (const node of ast.body) {
    switch (node.type) {
      case "ExportNamedDeclaration":
        if (node.declaration) {
          // export function/class/const/interface
          exportCount++;
          if (
            node.declaration.type === "VariableDeclaration" &&
            node.declaration.declarations.length > 1
          ) {
            exportCount += node.declaration.declarations.length - 1;
          }
        } else if (node.specifiers.length > 0) {
          exportCount += node.specifiers.length;
        }
        break;
      case "ExportDefaultDeclaration":
        exportCount++;
        break;
      case "ExportAllDeclaration":
        exportCount++;
        break;
    }
  }

  return exportCount;
}

/**
 * Completeness Analyzer
 */
export class CompletenessAnalyzer {
  constructor(private projectPath: string) {}

  /**
   * Analyze project completeness
   */
  async analyze(files?: string[]): Promise<CompletenessResult> {
    const sourceFiles = files ?? (await this.findSourceFiles());
    const testFiles = await this.findTestFiles();

    // Calculate export density
    const { totalExports, exportDensity } = await this.analyzeExports(sourceFiles);

    // Calculate test-file ratio
    const testFileRatio = this.calculateTestFileRatio(sourceFiles, testFiles);

    // Check for entry point
    const hasEntryPoint = await this.checkEntryPoint();

    // Score calculation
    // exportDensity: % of files with at least 1 export, scaled to 40
    // testFileRatio: % of source files that have matching test files, scaled to 40
    // hasEntryPoint: 20 points
    const exportScore = Math.min(40, exportDensity * 0.4);
    const testScore = Math.min(40, testFileRatio * 0.4);
    const entryScore = hasEntryPoint ? 20 : 0;

    const score = Math.round(Math.max(0, Math.min(100, exportScore + testScore + entryScore)));

    const details = this.buildDetails(
      sourceFiles.length,
      testFiles.length,
      totalExports,
      exportDensity,
      testFileRatio,
      hasEntryPoint,
    );

    return {
      score,
      exportDensity,
      testFileRatio,
      hasEntryPoint,
      sourceFileCount: sourceFiles.length,
      testFileCount: testFiles.length,
      totalExports,
      details,
    };
  }

  /**
   * Analyze export density across files
   */
  private async analyzeExports(
    files: string[],
  ): Promise<{ totalExports: number; exportDensity: number }> {
    let totalExports = 0;
    let filesWithExports = 0;

    for (const file of files) {
      try {
        const content = await readFile(file, "utf-8");
        const ast = parse(content, {
          loc: true,
          range: true,
          jsx: file.endsWith(".tsx") || file.endsWith(".jsx"),
        });

        const exports = countExports(ast);
        totalExports += exports;
        if (exports > 0) filesWithExports++;
      } catch {
        // Skip files that can't be parsed
      }
    }

    const exportDensity = files.length > 0 ? (filesWithExports / files.length) * 100 : 0;

    return { totalExports, exportDensity };
  }

  /**
   * Calculate ratio of source files that have corresponding test files
   */
  private calculateTestFileRatio(sourceFiles: string[], testFiles: string[]): number {
    if (sourceFiles.length === 0) return 0;

    const testBaseNames = new Set(
      testFiles.map((f) => {
        const name = basename(f);
        // Remove .test.ts, .spec.ts suffixes to get original module name
        return name.replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "");
      }),
    );

    let coveredCount = 0;
    for (const sourceFile of sourceFiles) {
      const name = basename(sourceFile).replace(/\.(ts|tsx|js|jsx)$/, "");
      if (testBaseNames.has(name)) {
        coveredCount++;
      }
    }

    return (coveredCount / sourceFiles.length) * 100;
  }

  /**
   * Check if project has a clear entry point
   */
  private async checkEntryPoint(): Promise<boolean> {
    const entryPoints = [
      "src/index.ts",
      "src/index.js",
      "src/main.ts",
      "src/main.js",
      "index.ts",
      "index.js",
    ];

    for (const entry of entryPoints) {
      try {
        await access(join(this.projectPath, entry), constants.R_OK);
        return true;
      } catch {
        // Try next
      }
    }

    // Check package.json main/exports
    try {
      const pkgContent = await readFile(join(this.projectPath, "package.json"), "utf-8");
      const pkg = JSON.parse(pkgContent) as { main?: string; exports?: unknown };
      if (pkg.main || pkg.exports) return true;
    } catch {
      // No package.json
    }

    return false;
  }

  private buildDetails(
    sourceCount: number,
    testCount: number,
    totalExports: number,
    exportDensity: number,
    testFileRatio: number,
    hasEntryPoint: boolean,
  ): string {
    return [
      `${sourceCount} source files, ${testCount} test files`,
      `${totalExports} exports (${exportDensity.toFixed(1)}% files have exports)`,
      `${testFileRatio.toFixed(1)}% source files have tests`,
      `Entry point: ${hasEntryPoint ? "found" : "missing"}`,
    ].join(", ");
  }

  private async findSourceFiles(): Promise<string[]> {
    return glob("**/*.{ts,js,tsx,jsx}", {
      cwd: this.projectPath,
      absolute: true,
      ignore: ["**/node_modules/**", "**/*.test.*", "**/*.spec.*", "**/dist/**", "**/build/**"],
    });
  }

  private async findTestFiles(): Promise<string[]> {
    return glob("**/*.{test,spec}.{ts,tsx,js,jsx}", {
      cwd: this.projectPath,
      absolute: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    });
  }
}

/**
 * Create completeness analyzer instance
 */
export function createCompletenessAnalyzer(projectPath: string): CompletenessAnalyzer {
  return new CompletenessAnalyzer(projectPath);
}
