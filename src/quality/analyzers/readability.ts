/**
 * Readability Analyzer
 * Analyzes code readability through naming, function length, nesting depth, and weighted nesting complexity
 */

import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { readFile } from "node:fs/promises";
import { glob } from "glob";

/**
 * Readability analysis result
 */
export interface ReadabilityResult {
  score: number;
  namingScore: number;
  functionLengthScore: number;
  nestingDepthScore: number;
  cognitiveComplexityScore: number;
  averageFunctionLength: number;
  maxNestingDepth: number;
  averageCognitiveComplexity: number;
  details: string;
}

/**
 * Per-file readability metrics
 */
interface FileReadability {
  goodNames: number;
  totalNames: number;
  functionLengths: number[];
  maxNestingDepth: number;
  cognitiveComplexities: number[];
}

/**
 * Analyze readability patterns in AST
 */
function analyzeReadabilityPatterns(ast: TSESTree.Program): FileReadability {
  let goodNames = 0;
  let totalNames = 0;
  const functionLengths: number[] = [];
  let maxNestingDepth = 0;
  const cognitiveComplexities: number[] = [];

  // Allowed single-char names
  const allowedSingleChar = new Set(["i", "j", "k", "_", "e", "x", "y", "t", "n"]);

  /**
   * Check if name is good quality
   */
  function isGoodName(name: string): boolean {
    if (name.length === 1) {
      return allowedSingleChar.has(name);
    }
    return name.length >= 3 && name.length <= 30;
  }

  /**
   * Traverse AST and analyze function
   */
  function analyzeFunction(node: TSESTree.Node): void {
    // Calculate function length
    if (node.loc) {
      const length = node.loc.end.line - node.loc.start.line + 1;
      functionLengths.push(length);
    }

    // Calculate nesting depth and cognitive complexity
    let localMaxNesting = 0;
    let cognitiveComplexity = 0;

    /**
     * Weighted nesting complexity traversal.
     * This metric differs from SonarSource Cognitive Complexity:
     * - Adds 1 per control structure + current nesting depth for loops, switches, catches, ternaries
     * - Adds 1 for if statements (no nesting penalty)
     * - Adds 1 for && and || operators (no nesting penalty)
     * - Increments nesting for nested functions
     * - Does NOT account for: recursion, method overloading, boolean operator sequences
     * Scoring formula: max(0, min(100, 100 - (avgWeightedComplexity - 5) * 5))
     */
    function traverseForComplexity(
      n: TSESTree.Node,
      currentNesting: number,
    ): void {
      localMaxNesting = Math.max(localMaxNesting, currentNesting);

      let nextNesting = currentNesting;
      let incrementsNesting = false;

      switch (n.type) {
        case "IfStatement":
          cognitiveComplexity += 1;
          incrementsNesting = true;
          break;

        case "ForStatement":
        case "ForInStatement":
        case "ForOfStatement":
        case "WhileStatement":
        case "DoWhileStatement":
          cognitiveComplexity += 1 + currentNesting;
          incrementsNesting = true;
          break;

        case "SwitchStatement":
          cognitiveComplexity += 1 + currentNesting;
          incrementsNesting = true;
          break;

        case "CatchClause":
          cognitiveComplexity += 1 + currentNesting;
          incrementsNesting = true;
          break;

        case "ConditionalExpression":
          cognitiveComplexity += 1 + currentNesting;
          incrementsNesting = true;
          break;

        case "LogicalExpression":
          if (n.operator === "&&" || n.operator === "||") {
            cognitiveComplexity += 1;
          }
          break;

        case "FunctionExpression":
        case "ArrowFunctionExpression":
          incrementsNesting = true;
          break;
      }

      if (incrementsNesting) {
        nextNesting = currentNesting + 1;
      }

      traverseChildren(n, (child) => traverseForComplexity(child, nextNesting));
    }

    traverseForComplexity(node, 0);
    maxNestingDepth = Math.max(maxNestingDepth, localMaxNesting);
    cognitiveComplexities.push(cognitiveComplexity);
  }

  /**
   * Collect naming identifiers
   */
  function collectNames(node: TSESTree.Node): void {
    switch (node.type) {
      case "FunctionDeclaration":
        if (node.id) {
          totalNames++;
          if (isGoodName(node.id.name)) {
            goodNames++;
          }
        }
        // Collect parameter names
        for (const param of node.params) {
          collectParamNames(param);
        }
        break;

      case "FunctionExpression":
      case "ArrowFunctionExpression":
        // Collect parameter names
        for (const param of node.params) {
          collectParamNames(param);
        }
        break;

      case "VariableDeclarator":
        if (node.id.type === "Identifier") {
          totalNames++;
          if (isGoodName(node.id.name)) {
            goodNames++;
          }
        }
        break;

      case "MethodDefinition":
        if (node.key.type === "Identifier") {
          totalNames++;
          if (isGoodName(node.key.name)) {
            goodNames++;
          }
        }
        // Collect parameter names
        if (node.value.type === "FunctionExpression") {
          for (const param of node.value.params) {
            collectParamNames(param);
          }
        }
        break;
    }
  }

  /**
   * Collect parameter names recursively
   */
  function collectParamNames(param: TSESTree.Parameter): void {
    if (param.type === "Identifier") {
      totalNames++;
      if (isGoodName(param.name)) {
        goodNames++;
      }
    } else if (param.type === "AssignmentPattern" && param.left.type === "Identifier") {
      totalNames++;
      if (isGoodName(param.left.name)) {
        goodNames++;
      }
    } else if (param.type === "RestElement" && param.argument.type === "Identifier") {
      totalNames++;
      if (isGoodName(param.argument.name)) {
        goodNames++;
      }
    }
  }

  /**
   * Main traversal
   */
  function traverse(node: TSESTree.Node): void {
    const isFunctionNode =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "MethodDefinition";

    // Collect names
    collectNames(node);

    // Analyze function metrics
    if (isFunctionNode) {
      analyzeFunction(node);
    }

    traverseChildren(node, traverse);
  }

  /**
   * Traverse child nodes
   */
  function traverseChildren(
    node: TSESTree.Node,
    callback: (child: TSESTree.Node) => void,
  ): void {
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const child = (node as unknown as Record<string, unknown>)[key];
      if (child && typeof child === "object") {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object" && item.type) {
              callback(item);
            }
          }
        } else if ((child as Record<string, unknown>).type) {
          callback(child as TSESTree.Node);
        }
      }
    }
  }

  traverse(ast);

  return {
    goodNames,
    totalNames,
    functionLengths,
    maxNestingDepth,
    cognitiveComplexities,
  };
}

/**
 * Readability Analyzer
 */
export class ReadabilityAnalyzer {
  constructor(private projectPath: string) {}

  /**
   * Analyze readability of project files
   */
  async analyze(files?: string[]): Promise<ReadabilityResult> {
    const targetFiles = files ?? (await this.findSourceFiles());

    let totalGoodNames = 0;
    let totalNames = 0;
    const allFunctionLengths: number[] = [];
    let globalMaxNestingDepth = 0;
    const allCognitiveComplexities: number[] = [];

    for (const file of targetFiles) {
      try {
        const content = await readFile(file, "utf-8");
        const ast = parse(content, {
          loc: true,
          range: true,
          jsx: file.endsWith(".tsx") || file.endsWith(".jsx"),
        });

        const result = analyzeReadabilityPatterns(ast);
        totalGoodNames += result.goodNames;
        totalNames += result.totalNames;
        allFunctionLengths.push(...result.functionLengths);
        globalMaxNestingDepth = Math.max(globalMaxNestingDepth, result.maxNestingDepth);
        allCognitiveComplexities.push(...result.cognitiveComplexities);
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Calculate naming score (25%)
    const namingScore = totalNames > 0 ? (totalGoodNames / totalNames) * 100 : 100;

    // Calculate function length score (25%)
    const averageFunctionLength =
      allFunctionLengths.length > 0
        ? allFunctionLengths.reduce((a, b) => a + b, 0) / allFunctionLengths.length
        : 0;
    const functionLengthScore =
      allFunctionLengths.length > 0
        ? Math.max(0, Math.min(100, 100 - (averageFunctionLength - 20) * 2.5))
        : 100;

    // Calculate nesting depth score (25%)
    const maxNestingDepth = globalMaxNestingDepth;
    const nestingDepthScore = Math.max(0, Math.min(100, 100 - (maxNestingDepth - 2) * 20));

    // Calculate weighted nesting complexity score (25%)
    const averageCognitiveComplexity =
      allCognitiveComplexities.length > 0
        ? allCognitiveComplexities.reduce((a, b) => a + b, 0) / allCognitiveComplexities.length
        : 0;
    const cognitiveComplexityScore =
      allCognitiveComplexities.length > 0
        ? Math.max(0, Math.min(100, 100 - (averageCognitiveComplexity - 5) * 5))
        : 100;

    // Overall score: equal weights (25% each)
    const score = Math.round(
      namingScore * 0.25 +
        functionLengthScore * 0.25 +
        nestingDepthScore * 0.25 +
        cognitiveComplexityScore * 0.25,
    );

    const details = [
      `${totalGoodNames}/${totalNames} good names`,
      `avg func ${averageFunctionLength.toFixed(1)} LOC`,
      `max nesting ${maxNestingDepth}`,
      `avg weighted complexity ${averageCognitiveComplexity.toFixed(1)}`,
    ].join(", ");

    return {
      score,
      namingScore,
      functionLengthScore,
      nestingDepthScore,
      cognitiveComplexityScore,
      averageFunctionLength,
      maxNestingDepth,
      averageCognitiveComplexity,
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
 * Create readability analyzer instance
 */
export function createReadabilityAnalyzer(projectPath: string): ReadabilityAnalyzer {
  return new ReadabilityAnalyzer(projectPath);
}
