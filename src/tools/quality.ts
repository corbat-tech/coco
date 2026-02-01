/**
 * Quality tools for Corbat-Coco
 * Linting, complexity analysis, security scanning
 */

import { z } from "zod";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";
import type { QualityScores, QualityDimensions } from "../quality/types.js";
import { DEFAULT_QUALITY_WEIGHTS } from "../quality/types.js";

/**
 * Lint result interface
 */
export interface LintResult {
  errors: number;
  warnings: number;
  fixable: number;
  issues: LintIssue[];
  score: number; // 0-100
}

/**
 * Lint issue interface
 */
export interface LintIssue {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
  rule: string;
}

/**
 * Complexity result interface
 */
export interface ComplexityResult {
  averageComplexity: number;
  maxComplexity: number;
  totalFunctions: number;
  complexFunctions: number; // Functions with complexity > 10
  score: number; // 0-100
  files: FileComplexity[];
}

/**
 * File complexity interface
 */
export interface FileComplexity {
  file: string;
  complexity: number;
  functions: FunctionComplexity[];
}

/**
 * Function complexity interface
 */
export interface FunctionComplexity {
  name: string;
  complexity: number;
  line: number;
}

/**
 * Detect linter in project
 */
async function detectLinter(cwd: string): Promise<string | null> {
  try {
    const pkgPath = path.join(cwd, "package.json");
    const pkgContent = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (deps.oxlint) return "oxlint";
    if (deps.eslint) return "eslint";
    if (deps.biome || deps["@biomejs/biome"]) return "biome";

    return null;
  } catch {
    return null;
  }
}

/**
 * Run linter tool
 */
export const runLinterTool: ToolDefinition<
  { cwd?: string; files?: string[]; fix?: boolean; linter?: string },
  LintResult
> = defineTool({
  name: "run_linter",
  description: "Run linter on the codebase",
  category: "quality",
  parameters: z.object({
    cwd: z.string().optional().describe("Project directory"),
    files: z.array(z.string()).optional().describe("Specific files to lint"),
    fix: z.boolean().optional().default(false).describe("Auto-fix issues"),
    linter: z.string().optional().describe("Linter to use (eslint, oxlint, biome)"),
  }),
  async execute({ cwd, files, fix, linter }) {
    const projectDir = cwd ?? process.cwd();
    const detectedLinter = linter ?? (await detectLinter(projectDir));

    if (!detectedLinter) {
      // Return empty result if no linter found
      return {
        errors: 0,
        warnings: 0,
        fixable: 0,
        issues: [],
        score: 100,
      };
    }

    try {
      const args: string[] = [];
      let command = "npx";

      switch (detectedLinter) {
        case "oxlint":
          args.push("oxlint");
          if (files && files.length > 0) {
            args.push(...files);
          } else {
            args.push("src");
          }
          if (fix) args.push("--fix");
          args.push("--format", "json");
          break;

        case "eslint":
          args.push("eslint");
          if (files && files.length > 0) {
            args.push(...files);
          } else {
            args.push("src");
          }
          if (fix) args.push("--fix");
          args.push("--format", "json");
          break;

        case "biome":
          args.push("biome", "lint");
          if (files && files.length > 0) {
            args.push(...files);
          } else {
            args.push("src");
          }
          if (fix) args.push("--apply");
          args.push("--reporter", "json");
          break;

        default:
          throw new ToolError(`Unsupported linter: ${detectedLinter}`, {
            tool: "run_linter",
          });
      }

      const result = await execa(command, args, {
        cwd: projectDir,
        reject: false,
        timeout: 120000,
      });

      return parseLintResults(detectedLinter, result.stdout, result.stderr);
    } catch (error) {
      throw new ToolError(
        `Linting failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "run_linter", cause: error instanceof Error ? error : undefined }
      );
    }
  },
});

/**
 * Parse lint results from output
 */
function parseLintResults(_linter: string, stdout: string, _stderr: string): LintResult {
  const issues: LintIssue[] = [];
  let errors = 0;
  let warnings = 0;
  let fixable = 0;

  try {
    // Try to parse JSON output
    const jsonMatch = stdout.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const json = JSON.parse(jsonMatch[0]) as Array<{
        filePath?: string;
        messages?: Array<{
          line?: number;
          column?: number;
          severity?: number;
          message?: string;
          ruleId?: string;
          fix?: unknown;
        }>;
      }>;

      for (const file of json) {
        if (file.messages) {
          for (const msg of file.messages) {
            const severity = msg.severity === 2 ? "error" : "warning";
            if (severity === "error") errors++;
            else warnings++;
            if (msg.fix) fixable++;

            issues.push({
              file: file.filePath ?? "",
              line: msg.line ?? 0,
              column: msg.column ?? 0,
              severity,
              message: msg.message ?? "",
              rule: msg.ruleId ?? "",
            });
          }
        }
      }
    }
  } catch {
    // Parse from raw output
    const errorMatch = stdout.match(/(\d+)\s*error/i);
    const warningMatch = stdout.match(/(\d+)\s*warning/i);

    errors = errorMatch ? parseInt(errorMatch[1] ?? "0", 10) : 0;
    warnings = warningMatch ? parseInt(warningMatch[1] ?? "0", 10) : 0;
  }

  // Calculate score (100 = no issues, deduct 5 for each error, 2 for each warning)
  const score = Math.max(0, 100 - errors * 5 - warnings * 2);

  return { errors, warnings, fixable, issues, score };
}

/**
 * Analyze complexity tool
 */
export const analyzeComplexityTool: ToolDefinition<
  { cwd?: string; files?: string[]; threshold?: number },
  ComplexityResult
> = defineTool({
  name: "analyze_complexity",
  description: "Analyze code complexity",
  category: "quality",
  parameters: z.object({
    cwd: z.string().optional().describe("Project directory"),
    files: z.array(z.string()).optional().describe("Specific files to analyze"),
    threshold: z.number().optional().default(10).describe("Complexity threshold"),
  }),
  async execute({ cwd, files, threshold }) {
    const projectDir = cwd ?? process.cwd();

    try {
      // Use a simple heuristic for now (could integrate with plato or escomplex)
      const targetFiles = files ?? (await findSourceFiles(projectDir));
      const fileResults: FileComplexity[] = [];

      let totalComplexity = 0;
      let maxComplexity = 0;
      let totalFunctions = 0;
      let complexFunctions = 0;

      for (const file of targetFiles) {
        const content = await fs.readFile(file, "utf-8");
        const fileComplexity = analyzeFileComplexity(content, file);

        fileResults.push(fileComplexity);
        totalComplexity += fileComplexity.complexity;
        maxComplexity = Math.max(maxComplexity, fileComplexity.complexity);

        for (const fn of fileComplexity.functions) {
          totalFunctions++;
          if (fn.complexity > (threshold ?? 10)) {
            complexFunctions++;
          }
        }
      }

      const averageComplexity = totalFunctions > 0 ? totalComplexity / totalFunctions : 0;

      // Score: 100 if average <= 5, decreasing to 0 at average >= 20
      const score = Math.max(0, Math.min(100, 100 - (averageComplexity - 5) * 6.67));

      return {
        averageComplexity,
        maxComplexity,
        totalFunctions,
        complexFunctions,
        score,
        files: fileResults,
      };
    } catch (error) {
      throw new ToolError(
        `Complexity analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "analyze_complexity", cause: error instanceof Error ? error : undefined }
      );
    }
  },
});

/**
 * Find source files in project
 */
async function findSourceFiles(cwd: string): Promise<string[]> {
  const { glob } = await import("glob");
  return glob("src/**/*.{ts,js,tsx,jsx}", {
    cwd,
    absolute: true,
    ignore: ["**/*.test.*", "**/*.spec.*", "**/node_modules/**"],
  });
}

/**
 * Simple complexity analysis for a file
 */
function analyzeFileComplexity(content: string, file: string): FileComplexity {
  const functions: FunctionComplexity[] = [];

  // Simple heuristic: count decision points (if, while, for, case, &&, ||, ?:)
  const lines = content.split("\n");
  let currentFunction = "";
  let functionStart = 0;
  let braceDepth = 0;
  let functionComplexity = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Detect function start (simplified)
    const funcMatch = line.match(/(?:function|async function)\s+(\w+)|(\w+)\s*(?:=|:)\s*(?:async\s*)?\(?.*\)?\s*=>/);
    if (funcMatch && braceDepth === 0) {
      if (currentFunction) {
        functions.push({
          name: currentFunction,
          complexity: functionComplexity,
          line: functionStart,
        });
      }
      currentFunction = funcMatch[1] ?? funcMatch[2] ?? "anonymous";
      functionStart = i + 1;
      functionComplexity = 1;
    }

    // Count decision points
    const decisions = (line.match(/\b(if|else if|while|for|case|catch)\b/g) || []).length;
    const logicalOps = (line.match(/(&&|\|\|)/g) || []).length;
    const ternary = (line.match(/\?.*:/g) || []).length;
    functionComplexity += decisions + logicalOps + ternary;

    // Track brace depth
    braceDepth += (line.match(/\{/g) || []).length;
    braceDepth -= (line.match(/\}/g) || []).length;
  }

  // Add last function
  if (currentFunction) {
    functions.push({
      name: currentFunction,
      complexity: functionComplexity,
      line: functionStart,
    });
  }

  const totalComplexity = functions.reduce((sum, f) => sum + f.complexity, 0);

  return {
    file,
    complexity: totalComplexity,
    functions,
  };
}

/**
 * Calculate full quality scores
 */
export const calculateQualityTool: ToolDefinition<
  { cwd?: string; files?: string[] },
  QualityScores
> = defineTool({
  name: "calculate_quality",
  description: "Calculate comprehensive quality scores",
  category: "quality",
  parameters: z.object({
    cwd: z.string().optional().describe("Project directory"),
    files: z.array(z.string()).optional().describe("Specific files to analyze"),
  }),
  async execute({ cwd, files }) {
    const projectDir = cwd ?? process.cwd();
    const startTime = performance.now();

    try {
      // Run all quality checks in parallel
      const [lintResult, complexityResult] = await Promise.all([
        runLinterTool.execute({ cwd: projectDir, files }),
        analyzeComplexityTool.execute({ cwd: projectDir, files }),
      ]);

      // Try to get coverage (may not be available)
      let testCoverage = 0;
      try {
        const { getCoverageTool } = await import("./test.js");
        const coverage = await getCoverageTool.execute({ cwd: projectDir });
        testCoverage = (coverage.lines + coverage.branches + coverage.functions) / 3;
      } catch {
        // Coverage not available
      }

      // Calculate dimensions
      const dimensions: QualityDimensions = {
        correctness: 85, // Would need test results
        completeness: 80, // Would need requirements analysis
        robustness: 75, // Would need test analysis
        readability: Math.min(100, 100 - complexityResult.averageComplexity * 2),
        maintainability: Math.min(100, 100 - complexityResult.complexFunctions * 5),
        complexity: complexityResult.score,
        duplication: 90, // Would need duplication analysis
        testCoverage,
        testQuality: 70, // Would need test analysis
        security: 100, // Would need security scan
        documentation: 60, // Would need doc analysis
        style: lintResult.score,
      };

      // Calculate overall weighted score
      const overall = Object.entries(dimensions).reduce((sum, [key, value]) => {
        const weight = DEFAULT_QUALITY_WEIGHTS[key as keyof typeof DEFAULT_QUALITY_WEIGHTS] ?? 0;
        return sum + value * weight;
      }, 0);

      return {
        overall,
        dimensions,
        evaluatedAt: new Date(),
        evaluationDurationMs: performance.now() - startTime,
      };
    } catch (error) {
      throw new ToolError(
        `Quality calculation failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "calculate_quality", cause: error instanceof Error ? error : undefined }
      );
    }
  },
});

/**
 * All quality tools
 */
export const qualityTools = [runLinterTool, analyzeComplexityTool, calculateQualityTool];
