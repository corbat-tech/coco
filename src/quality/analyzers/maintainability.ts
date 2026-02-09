/**
 * Maintainability Analyzer
 * Measures file length, function count, dependency count, and coupling
 */

import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { readFile } from "node:fs/promises";
import { glob } from "glob";

/**
 * Maintainability analysis result
 */
export interface MaintainabilityResult {
  score: number;
  fileLengthScore: number;
  functionCountScore: number;
  dependencyCountScore: number;
  couplingScore: number;
  averageFileLength: number;
  averageFunctionsPerFile: number;
  averageImportsPerFile: number;
  fileCount: number;
  details: string;
}

/**
 * Per-file maintainability metrics
 */
interface FileMaintainability {
  lineCount: number;
  functionCount: number;
  importCount: number;
  crossBoundaryImportCount: number;
}

/**
 * Count maintainability patterns in AST
 */
function analyzeMaintainabilityPatterns(
  ast: TSESTree.Program,
  filePath: string,
): FileMaintainability {
  let functionCount = 0;
  let importCount = 0;
  let crossBoundaryImportCount = 0;

  function traverse(node: TSESTree.Node): void {
    switch (node.type) {
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "MethodDefinition":
        functionCount++;
        break;

      case "ImportDeclaration":
        importCount++;
        if (isCrossBoundaryImport(node, filePath)) {
          crossBoundaryImportCount++;
        }
        break;
    }

    traverseChildren(node);
  }

  function traverseChildren(node: TSESTree.Node): void {
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const child = (node as unknown as Record<string, unknown>)[key];
      if (child && typeof child === "object") {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object" && (item as TSESTree.Node).type) {
              traverse(item as TSESTree.Node);
            }
          }
        } else if ((child as TSESTree.Node).type) {
          traverse(child as TSESTree.Node);
        }
      }
    }
  }

  traverse(ast);

  return {
    lineCount: 0, // Will be set separately from content
    functionCount,
    importCount,
    crossBoundaryImportCount,
  };
}

/**
 * Check if import is cross-boundary
 * Cross-boundary means:
 * - Starts with `../` (goes up a directory)
 * - Starts with `./` but navigates to a different directory (has `/` after `./xxx/`)
 * NOT cross-boundary:
 * - Starts with `node:` (built-in)
 * - No `.` prefix (third-party)
 * - Starts with `./` and stays in same directory (no additional `/` after `./`)
 */
function isCrossBoundaryImport(node: TSESTree.ImportDeclaration, _filePath: string): boolean {
  if (node.source.type !== "Literal" || typeof node.source.value !== "string") {
    return false;
  }

  const importPath = node.source.value;

  // Built-in modules are not cross-boundary
  if (importPath.startsWith("node:")) {
    return false;
  }

  // Third-party modules (no . prefix) are not cross-boundary for coupling
  if (!importPath.startsWith(".")) {
    return false;
  }

  // Goes up a directory - definitely cross-boundary
  if (importPath.startsWith("../")) {
    return true;
  }

  // Starts with ./ - check if it stays in same directory
  if (importPath.startsWith("./")) {
    // Remove the ./
    const relativePath = importPath.slice(2);
    // If there's a / in the remaining path, it navigates to a different directory
    return relativePath.includes("/");
  }

  return false;
}

/**
 * Count lines in content
 */
function countLines(content: string): number {
  return content.split("\n").length;
}

/**
 * Maintainability Analyzer
 */
export class MaintainabilityAnalyzer {
  constructor(private projectPath: string) {}

  /**
   * Analyze maintainability of project files
   */
  async analyze(files?: string[]): Promise<MaintainabilityResult> {
    const targetFiles = files ?? (await this.findSourceFiles());

    if (targetFiles.length === 0) {
      return {
        score: 100,
        fileLengthScore: 100,
        functionCountScore: 100,
        dependencyCountScore: 100,
        couplingScore: 100,
        averageFileLength: 0,
        averageFunctionsPerFile: 0,
        averageImportsPerFile: 0,
        fileCount: 0,
        details: "No files to analyze",
      };
    }

    let totalLines = 0;
    let totalFunctions = 0;
    let totalImports = 0;
    let totalCrossBoundaryImports = 0;
    let filesAnalyzed = 0;

    for (const file of targetFiles) {
      try {
        const content = await readFile(file, "utf-8");
        const lineCount = countLines(content);

        const ast = parse(content, {
          loc: true,
          range: true,
          jsx: file.endsWith(".tsx") || file.endsWith(".jsx"),
        });

        const result = analyzeMaintainabilityPatterns(ast, file);

        totalLines += lineCount;
        totalFunctions += result.functionCount;
        totalImports += result.importCount;
        totalCrossBoundaryImports += result.crossBoundaryImportCount;
        filesAnalyzed++;
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Calculate averages
    const averageFileLength = filesAnalyzed > 0 ? totalLines / filesAnalyzed : 0;
    const averageFunctionsPerFile = filesAnalyzed > 0 ? totalFunctions / filesAnalyzed : 0;
    const averageImportsPerFile = filesAnalyzed > 0 ? totalImports / filesAnalyzed : 0;

    // Calculate sub-scores

    // 1. File Length Score (30%)
    // Formula: max(0, min(100, 100 - (avgFileLOC - 200) * 0.33))
    const fileLengthScore = Math.max(
      0,
      Math.min(100, 100 - (averageFileLength - 200) * 0.33),
    );

    // 2. Function Count Score (25%)
    // Formula: max(0, min(100, 100 - (avgFuncsPerFile - 10) * 5))
    const functionCountScore = Math.max(
      0,
      Math.min(100, 100 - (averageFunctionsPerFile - 10) * 5),
    );

    // 3. Dependency Count Score (25%)
    // Formula: max(0, min(100, 100 - (avgImports - 5) * 5))
    const dependencyCountScore = Math.max(
      0,
      Math.min(100, 100 - (averageImportsPerFile - 5) * 5),
    );

    // 4. Coupling Score (20%)
    // crossBoundaryRatio = crossBoundaryImports / totalImports
    // Formula: max(0, min(100, 100 - crossBoundaryRatio * 100 * 0.5))
    const crossBoundaryRatio =
      totalImports > 0 ? totalCrossBoundaryImports / totalImports : 0;
    const couplingScore = Math.max(
      0,
      Math.min(100, 100 - crossBoundaryRatio * 100 * 0.5),
    );

    // Overall score: weighted average
    const score = Math.round(
      fileLengthScore * 0.3 +
        functionCountScore * 0.25 +
        dependencyCountScore * 0.25 +
        couplingScore * 0.2,
    );

    const details = [
      `${Math.round(averageFileLength)} avg lines/file`,
      `${averageFunctionsPerFile.toFixed(1)} avg functions/file`,
      `${averageImportsPerFile.toFixed(1)} avg imports/file`,
      `${Math.round(crossBoundaryRatio * 100)}% cross-boundary coupling`,
    ].join(", ");

    return {
      score,
      fileLengthScore,
      functionCountScore,
      dependencyCountScore,
      couplingScore,
      averageFileLength,
      averageFunctionsPerFile,
      averageImportsPerFile,
      fileCount: filesAnalyzed,
      details,
    };
  }

  private async findSourceFiles(): Promise<string[]> {
    return glob("**/*.{ts,js,tsx,jsx}", {
      cwd: this.projectPath,
      absolute: true,
      ignore: ["**/node_modules/**", "**/*.test.*", "**/*.spec.*", "**/dist/**", "**/build/**"],
    });
  }
}

/**
 * Create maintainability analyzer instance
 */
export function createMaintainabilityAnalyzer(projectPath: string): MaintainabilityAnalyzer {
  return new MaintainabilityAnalyzer(projectPath);
}
