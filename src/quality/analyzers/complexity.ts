/**
 * Real Complexity Analyzer for Corbat-Coco
 * AST-based cyclomatic complexity + duplication detection
 */

import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { readFile } from "node:fs/promises";
import { glob } from "glob";

/**
 * Function complexity details
 */
export interface FunctionComplexity {
  name: string;
  complexity: number;
  loc: number; // Lines of code
  line: number;
  column: number;
}

/**
 * File complexity details
 */
export interface FileComplexity {
  file: string;
  averageComplexity: number;
  maxComplexity: number;
  totalComplexity: number;
  functions: FunctionComplexity[];
  loc: number;
}

/**
 * Complexity result
 */
export interface ComplexityResult {
  averageComplexity: number;
  maxComplexity: number;
  totalFunctions: number;
  complexFunctions: number; // Functions with complexity > threshold
  score: number; // 0-100
  files: FileComplexity[];
  maintainabilityIndex: number; // 0-100
}

/**
 * Duplication result
 */
export interface DuplicationResult {
  duplicateLines: number;
  totalLines: number;
  percentage: number;
  duplicates: Array<{
    lines: string[];
    files: Array<{ file: string; line: number }>;
  }>;
}

/**
 * Calculate cyclomatic complexity of AST node
 */
function calculateComplexity(node: TSESTree.Node): number {
  let complexity = 1; // Base complexity

  function traverse(n: TSESTree.Node) {
    // Decision points increase complexity
    switch (n.type) {
      case "IfStatement":
        complexity++;
        break;
      case "WhileStatement":
      case "DoWhileStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
        complexity++;
        break;
      case "SwitchCase":
        if (n.test) complexity++; // case (not default)
        break;
      case "CatchClause":
        complexity++;
        break;
      case "ConditionalExpression": // ternary
        complexity++;
        break;
      case "LogicalExpression":
        if (n.operator === "&&" || n.operator === "||") {
          complexity++;
        }
        break;
    }

    // Recursively traverse children
    for (const key of Object.keys(n)) {
      const child = (n as any)[key];
      if (child && typeof child === "object") {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object" && item.type) {
              traverse(item);
            }
          }
        } else if (child.type) {
          traverse(child);
        }
      }
    }
  }

  traverse(node);
  return complexity;
}

/**
 * Count lines of code (excluding blank and comments)
 */
function countLOC(code: string): number {
  const lines = code.split("\n");
  let loc = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip blank lines and single-line comments
    if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
      loc++;
    }
  }

  return loc;
}

/**
 * Extract function complexities from AST
 */
function extractFunctionComplexities(
  ast: TSESTree.Program,
  sourceCode: string,
): FunctionComplexity[] {
  const functions: FunctionComplexity[] = [];

  function traverse(node: TSESTree.Node) {
    let functionNode: TSESTree.FunctionLike | null = null;
    let functionName = "anonymous";

    switch (node.type) {
      case "FunctionDeclaration":
        functionNode = node;
        functionName = node.id?.name || "anonymous";
        break;

      case "FunctionExpression":
      case "ArrowFunctionExpression":
        functionNode = node;
        // Try to get name from parent variable declarator
        break;

      case "MethodDefinition":
        if (node.value.type === "FunctionExpression") {
          functionNode = node.value;
          if (node.key.type === "Identifier") {
            functionName = node.key.name;
          }
        }
        break;

      case "VariableDeclarator":
        if (
          node.init &&
          (node.init.type === "FunctionExpression" || node.init.type === "ArrowFunctionExpression")
        ) {
          functionNode = node.init;
          if (node.id.type === "Identifier") {
            functionName = node.id.name;
          }
        }
        break;
    }

    if (functionNode) {
      const complexity = calculateComplexity(functionNode);
      const loc = countLOC(sourceCode.substring(functionNode.range[0], functionNode.range[1]));

      functions.push({
        name: functionName,
        complexity,
        loc,
        line: functionNode.loc.start.line,
        column: functionNode.loc.start.column,
      });
    }

    // Traverse children
    for (const key of Object.keys(node)) {
      const child = (node as any)[key];
      if (child && typeof child === "object") {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object" && item.type) {
              traverse(item);
            }
          }
        } else if (child.type) {
          traverse(child);
        }
      }
    }
  }

  traverse(ast);
  return functions;
}

/**
 * Complexity Analyzer
 */
export class ComplexityAnalyzer {
  constructor(
    private projectPath: string,
    private threshold: number = 10,
  ) {}

  /**
   * Analyze complexity of project files
   */
  async analyze(files?: string[]): Promise<ComplexityResult> {
    const targetFiles = files ?? (await this.findSourceFiles());

    const fileResults: FileComplexity[] = [];
    let totalComplexity = 0;
    let maxComplexity = 0;
    let totalFunctions = 0;
    let complexFunctions = 0;
    let totalLOC = 0;

    for (const file of targetFiles) {
      try {
        const content = await readFile(file, "utf-8");
        const fileResult = await this.analyzeFile(file, content);

        fileResults.push(fileResult);
        totalComplexity += fileResult.totalComplexity;
        maxComplexity = Math.max(maxComplexity, fileResult.maxComplexity);
        totalFunctions += fileResult.functions.length;
        totalLOC += fileResult.loc;

        for (const fn of fileResult.functions) {
          if (fn.complexity > this.threshold) {
            complexFunctions++;
          }
        }
      } catch (error) {
        // Skip files that can't be parsed
        console.warn(`Failed to analyze ${file}: ${error}`);
      }
    }

    const averageComplexity = totalFunctions > 0 ? totalComplexity / totalFunctions : 0;

    // Score: 100 if average <= 5, decreasing to 0 at average >= 20
    const complexityScore = Math.max(0, Math.min(100, 100 - ((averageComplexity - 5) / 15) * 100));

    // Maintainability Index (simplified version)
    // MI = 171 - 5.2 * ln(V) - 0.23 * G - 16.2 * ln(LOC)
    // Simplified: High complexity and LOC decrease MI
    const maintainabilityIndex = Math.max(
      0,
      Math.min(100, 100 - averageComplexity * 2 - (totalLOC / 1000) * 5),
    );

    return {
      averageComplexity,
      maxComplexity,
      totalFunctions,
      complexFunctions,
      score: complexityScore,
      files: fileResults,
      maintainabilityIndex,
    };
  }

  /**
   * Analyze single file
   */
  private async analyzeFile(file: string, content: string): Promise<FileComplexity> {
    // Parse AST
    const ast = parse(content, {
      loc: true,
      range: true,
      comment: false,
      jsx: file.endsWith(".tsx") || file.endsWith(".jsx"),
    });

    // Extract function complexities
    const functions = extractFunctionComplexities(ast, content);

    const totalComplexity = functions.reduce((sum, f) => sum + f.complexity, 0);
    const averageComplexity = functions.length > 0 ? totalComplexity / functions.length : 0;
    const maxComplexity = Math.max(...functions.map((f) => f.complexity), 0);
    const loc = countLOC(content);

    return {
      file,
      averageComplexity,
      maxComplexity,
      totalComplexity,
      functions,
      loc,
    };
  }

  /**
   * Find source files in project
   */
  private async findSourceFiles(): Promise<string[]> {
    return glob("**/*.{ts,js,tsx,jsx}", {
      cwd: this.projectPath,
      absolute: true,
      ignore: ["**/node_modules/**", "**/*.test.*", "**/*.spec.*", "**/dist/**", "**/build/**"],
    });
  }
}

/**
 * Duplication Analyzer (basic implementation)
 */
export class DuplicationAnalyzer {
  constructor(
    private projectPath: string,
    private minLines: number = 5,
  ) {}

  /**
   * Detect code duplication
   */
  async analyze(files?: string[]): Promise<DuplicationResult> {
    const targetFiles = files ?? (await this.findSourceFiles());

    // Build map of code chunks to files
    const chunks = new Map<string, Array<{ file: string; line: number }>>();
    let totalLines = 0;

    for (const file of targetFiles) {
      try {
        const content = await readFile(file, "utf-8");
        const lines = content.split("\n");
        totalLines += lines.length;

        // Extract chunks of minLines consecutive lines
        for (let i = 0; i <= lines.length - this.minLines; i++) {
          const chunk = lines
            .slice(i, i + this.minLines)
            .join("\n")
            .trim();

          // Skip empty chunks
          if (chunk.length < 20) continue;

          if (!chunks.has(chunk)) {
            chunks.set(chunk, []);
          }
          chunks.get(chunk)!.push({ file, line: i + 1 });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // Find duplicates (chunks appearing in multiple locations)
    const duplicates: Array<{
      lines: string[];
      files: Array<{ file: string; line: number }>;
    }> = [];

    let duplicateLines = 0;

    for (const [chunk, locations] of chunks.entries()) {
      if (locations.length > 1) {
        duplicates.push({
          lines: chunk.split("\n"),
          files: locations,
        });
        duplicateLines += chunk.split("\n").length * (locations.length - 1);
      }
    }

    const percentage = totalLines > 0 ? (duplicateLines / totalLines) * 100 : 0;

    return {
      duplicateLines,
      totalLines,
      percentage,
      duplicates,
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
 * Create complexity analyzer
 */
export function createComplexityAnalyzer(
  projectPath: string,
  threshold?: number,
): ComplexityAnalyzer {
  return new ComplexityAnalyzer(projectPath, threshold);
}

/**
 * Create duplication analyzer
 */
export function createDuplicationAnalyzer(
  projectPath: string,
  minLines?: number,
): DuplicationAnalyzer {
  return new DuplicationAnalyzer(projectPath, minLines);
}
