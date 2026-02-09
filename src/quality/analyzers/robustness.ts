/**
 * Robustness Analyzer
 * Detects error handling patterns, input validation, and defensive coding
 */

import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { readFile } from "node:fs/promises";
import { glob } from "glob";

/**
 * Robustness analysis result
 */
export interface RobustnessResult {
  score: number;
  tryCatchRatio: number;
  inputValidationScore: number;
  defensiveCodingScore: number;
  functionsAnalyzed: number;
  functionsWithErrorHandling: number;
  optionalChainingCount: number;
  nullishCoalescingCount: number;
  typeGuardCount: number;
  details: string;
}

/**
 * Per-file robustness metrics
 */
interface FileRobustness {
  functions: number;
  functionsWithTryCatch: number;
  optionalChaining: number;
  nullishCoalescing: number;
  typeGuards: number;
  typeofChecks: number;
  nullChecks: number;
}

/**
 * Count robustness patterns in AST
 */
function analyzeRobustnessPatterns(ast: TSESTree.Program): FileRobustness {
  let functions = 0;
  let functionsWithTryCatch = 0;
  let optionalChaining = 0;
  let nullishCoalescing = 0;
  let typeGuards = 0;
  let typeofChecks = 0;
  let nullChecks = 0;

  let insideFunction = false;
  let currentFunctionHasTryCatch = false;

  function traverse(node: TSESTree.Node): void {
    const isFunctionNode =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "MethodDefinition";

    if (isFunctionNode) {
      if (insideFunction && currentFunctionHasTryCatch) {
        functionsWithTryCatch++;
      }
      functions++;
      const previousInsideFunction = insideFunction;
      const previousHasTryCatch = currentFunctionHasTryCatch;
      insideFunction = true;
      currentFunctionHasTryCatch = false;

      traverseChildren(node);

      if (currentFunctionHasTryCatch) {
        functionsWithTryCatch++;
      }
      // Don't double-count: undo the increment we did above
      if (isFunctionNode) {
        functions--;
        functions++;
      }
      insideFunction = previousInsideFunction;
      currentFunctionHasTryCatch = previousHasTryCatch;
      return;
    }

    switch (node.type) {
      case "TryStatement":
        if (insideFunction) {
          currentFunctionHasTryCatch = true;
        }
        break;

      case "ChainExpression":
        optionalChaining++;
        break;

      case "MemberExpression":
        if (node.optional) {
          optionalChaining++;
        }
        break;

      case "CallExpression":
        if (node.optional) {
          optionalChaining++;
        }
        break;

      case "LogicalExpression":
        if (node.operator === "??") {
          nullishCoalescing++;
        }
        break;

      case "TSTypeAliasDeclaration":
        // Type predicates/guards in type declarations
        typeGuards++;
        break;

      case "UnaryExpression":
        if (node.operator === "typeof") {
          typeofChecks++;
        }
        break;

      case "BinaryExpression":
        // Check for null/undefined comparisons
        if (node.operator === "===" || node.operator === "!==" ||
            node.operator === "==" || node.operator === "!=") {
          if (isNullOrUndefined(node.left) || isNullOrUndefined(node.right)) {
            nullChecks++;
          }
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

  // Handle last function
  if (insideFunction && currentFunctionHasTryCatch) {
    // Already counted in traverse return
  }

  return {
    functions,
    functionsWithTryCatch,
    optionalChaining,
    nullishCoalescing,
    typeGuards,
    typeofChecks,
    nullChecks,
  };
}

/**
 * Check if node is null or undefined literal
 */
function isNullOrUndefined(node: TSESTree.Node): boolean {
  if (node.type === "Literal" && node.value === null) return true;
  if (node.type === "Identifier" && node.name === "undefined") return true;
  return false;
}

/**
 * Robustness Analyzer
 */
export class RobustnessAnalyzer {
  constructor(private projectPath: string) {}

  /**
   * Analyze robustness of project files
   */
  async analyze(files?: string[]): Promise<RobustnessResult> {
    const targetFiles = files ?? (await this.findSourceFiles());

    let totalFunctions = 0;
    let totalFunctionsWithTryCatch = 0;
    let totalOptionalChaining = 0;
    let totalNullishCoalescing = 0;
    let totalTypeGuards = 0;
    let totalTypeofChecks = 0;
    let totalNullChecks = 0;

    for (const file of targetFiles) {
      try {
        const content = await readFile(file, "utf-8");
        const ast = parse(content, {
          loc: true,
          range: true,
          jsx: file.endsWith(".tsx") || file.endsWith(".jsx"),
        });

        const result = analyzeRobustnessPatterns(ast);
        totalFunctions += result.functions;
        totalFunctionsWithTryCatch += result.functionsWithTryCatch;
        totalOptionalChaining += result.optionalChaining;
        totalNullishCoalescing += result.nullishCoalescing;
        totalTypeGuards += result.typeGuards;
        totalTypeofChecks += result.typeofChecks;
        totalNullChecks += result.nullChecks;
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Calculate sub-scores
    const tryCatchRatio =
      totalFunctions > 0 ? (totalFunctionsWithTryCatch / totalFunctions) * 100 : 0;

    // Input validation: type guards + typeof checks + null checks per function
    const validationPerFunction =
      totalFunctions > 0
        ? (totalTypeGuards + totalTypeofChecks + totalNullChecks) / totalFunctions
        : 0;
    const inputValidationScore = Math.min(100, validationPerFunction * 50);

    // Defensive coding: optional chaining + nullish coalescing per function
    const defensivePerFunction =
      totalFunctions > 0
        ? (totalOptionalChaining + totalNullishCoalescing) / totalFunctions
        : 0;
    const defensiveCodingScore = Math.min(100, defensivePerFunction * 40);

    // Overall score: weighted average
    // 40% try/catch ratio + 30% input validation + 30% defensive coding
    const score = Math.round(
      Math.max(
        0,
        Math.min(
          100,
          tryCatchRatio * 0.4 + inputValidationScore * 0.3 + defensiveCodingScore * 0.3,
        ),
      ),
    );

    const details = [
      `${totalFunctionsWithTryCatch}/${totalFunctions} functions with error handling`,
      `${totalOptionalChaining} optional chaining, ${totalNullishCoalescing} nullish coalescing`,
      `${totalTypeGuards + totalTypeofChecks + totalNullChecks} validation checks`,
    ].join(", ");

    return {
      score,
      tryCatchRatio,
      inputValidationScore,
      defensiveCodingScore,
      functionsAnalyzed: totalFunctions,
      functionsWithErrorHandling: totalFunctionsWithTryCatch,
      optionalChainingCount: totalOptionalChaining,
      nullishCoalescingCount: totalNullishCoalescing,
      typeGuardCount: totalTypeGuards,
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
 * Create robustness analyzer instance
 */
export function createRobustnessAnalyzer(projectPath: string): RobustnessAnalyzer {
  return new RobustnessAnalyzer(projectPath);
}
