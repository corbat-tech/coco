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
import type { QualityScores } from "../quality/types.js";
import { createQualityEvaluatorWithRegistry } from "../quality/evaluator.js";

/**
 * Lint result interface
 */
export interface LintResult {
  errors: number;
  warnings: number;
  fixable: number;
  issues: LintIssue[];
  score: number | null; // 0-100, null when no data available
  linter?: string;
  message?: string;
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
  // JVM projects: try Maven/Gradle checkstyle
  try {
    await fs.access(path.join(cwd, "pom.xml"));
    return "maven-checkstyle";
  } catch {
    // not Maven
  }
  for (const f of ["build.gradle", "build.gradle.kts"]) {
    try {
      await fs.access(path.join(cwd, f));
      return "gradle-checkstyle";
    } catch {
      // not Gradle
    }
  }

  // Node.js linters
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
 * Resolve the Maven executable (wrapper preferred)
 */
async function mavenExec(cwd: string): Promise<string> {
  try {
    await fs.access(path.join(cwd, "mvnw"));
    return "./mvnw";
  } catch {
    return "mvn";
  }
}

/**
 * Resolve the Gradle executable (wrapper preferred)
 */
async function gradleExec(cwd: string): Promise<string> {
  try {
    await fs.access(path.join(cwd, "gradlew"));
    return "./gradlew";
  } catch {
    return "gradle";
  }
}

/**
 * Parse Maven/Gradle Checkstyle text output into LintResult.
 * Lines look like: [ERROR] /path/File.java:[10,5] (group) Rule: message
 */
function parseCheckstyleOutput(stdout: string, stderr: string): LintResult {
  const output = stdout + "\n" + stderr;
  const issues: LintIssue[] = [];
  let errors = 0;
  let warnings = 0;

  // Match: [ERROR] or [WARN] /file.java:[line,col] (group) Rule: msg
  const lineRe =
    /\[(ERROR|WARN(?:ING)?)\]\s+(.+?):(?:\[(\d+)(?:,(\d+))?\])?\s*(?:\([^)]*\))?\s*(.+)/gi;
  for (const m of output.matchAll(lineRe)) {
    const sev = (m[1] ?? "").toUpperCase().startsWith("ERROR") ? "error" : "warning";
    if (sev === "error") errors++;
    else warnings++;
    issues.push({
      file: m[2]?.trim() ?? "",
      line: parseInt(m[3] ?? "0", 10),
      column: parseInt(m[4] ?? "0", 10),
      severity: sev,
      message: m[5]?.trim() ?? "",
      rule: "",
    });
  }

  const score = Math.max(0, 100 - errors * 5 - warnings * 2);
  return { errors, warnings, fixable: 0, issues, score };
}

/**
 * Run linter tool
 */
export const runLinterTool: ToolDefinition<
  { cwd?: string; files?: string[]; fix?: boolean; linter?: string },
  LintResult
> = defineTool({
  name: "run_linter",
  description: `Run linter on the codebase (auto-detects eslint, oxlint, biome for Node.js; checkstyle for Maven/Gradle).

Examples:
- Lint all: {} → { "errors": 0, "warnings": 5, "score": 90 }
- Auto-fix (Node.js): { "fix": true }
- Specific files: { "files": ["src/app.ts", "src/utils.ts"] }
- Force linter: { "linter": "eslint" }
- Java project (Maven): automatically runs checkstyle:check if plugin is configured`,
  category: "quality",
  parameters: z.object({
    cwd: z.string().optional().describe("Project directory"),
    files: z.array(z.string()).optional().describe("Specific files to lint"),
    fix: z.boolean().optional().default(false).describe("Auto-fix issues (Node.js only)"),
    linter: z
      .string()
      .optional()
      .describe("Linter to use (eslint, oxlint, biome, maven-checkstyle, gradle-checkstyle)"),
  }),
  async execute({ cwd, files, fix, linter }) {
    const projectDir = cwd ?? process.cwd();
    const detectedLinter = linter ?? (await detectLinter(projectDir));

    if (!detectedLinter) {
      return {
        errors: 0,
        warnings: 0,
        fixable: 0,
        issues: [],
        score: null,
        linter: "none",
        message:
          "No linter detected (looked for: eslint, oxlint, biome for Node.js; checkstyle plugin for Maven/Gradle). Install one or use bash_exec to run a custom linter.",
      };
    }

    try {
      const args: string[] = [];
      let command = "npx";

      switch (detectedLinter) {
        case "maven-checkstyle": {
          command = await mavenExec(projectDir);
          args.push("checkstyle:check", "--no-transfer-progress", "-q");
          break;
        }

        case "gradle-checkstyle": {
          command = await gradleExec(projectDir);
          args.push("checkstyleMain", "--quiet");
          break;
        }

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

      // JVM checkstyle: if Maven/Gradle says "plugin not found" → return graceful no-linter
      const combinedOutput = (result.stdout ?? "") + (result.stderr ?? "");
      if (
        (detectedLinter === "maven-checkstyle" || detectedLinter === "gradle-checkstyle") &&
        /No plugin found|Task.*not found|checkstyle.*not configured/i.test(combinedOutput)
      ) {
        return {
          errors: 0,
          warnings: 0,
          fixable: 0,
          issues: [],
          score: null,
          linter: "none",
          message:
            "Checkstyle plugin not configured in build file. Add maven-checkstyle-plugin (Maven) or checkstyle plugin (Gradle) to enable Java linting.",
        };
      }

      if (detectedLinter === "maven-checkstyle" || detectedLinter === "gradle-checkstyle") {
        return {
          ...parseCheckstyleOutput(result.stdout ?? "", result.stderr ?? ""),
          linter: detectedLinter,
        };
      }

      return parseLintResults(detectedLinter, result.stdout ?? "", result.stderr ?? "");
    } catch (error) {
      throw new ToolError(
        `Linting failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "run_linter", cause: error instanceof Error ? error : undefined },
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
  description: `Analyze cyclomatic complexity of code.

Examples:
- Analyze all: {} → { "averageComplexity": 5.2, "maxComplexity": 15, "score": 85 }
- Custom threshold: { "threshold": 15 }
- Specific files: { "files": ["src/complex-module.ts"] }`,
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
      const msg = error instanceof Error ? error.message : String(error);
      throw new ToolError(
        `Complexity analysis failed: ${msg}. Try read_file to inspect the code manually.`,
        { tool: "analyze_complexity", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Find source files in project, adapting glob pattern to the detected stack.
 */
async function findSourceFiles(cwd: string): Promise<string[]> {
  const { glob } = await import("glob");

  // Detect JVM project
  let isJava = false;
  try {
    await fs.access(path.join(cwd, "pom.xml"));
    isJava = true;
  } catch {
    // not Maven
  }
  if (!isJava) {
    for (const f of ["build.gradle", "build.gradle.kts"]) {
      try {
        await fs.access(path.join(cwd, f));
        isJava = true;
        break;
      } catch {
        // not Gradle
      }
    }
  }

  if (isJava) {
    return glob("src/main/java/**/*.java", {
      cwd,
      absolute: true,
    });
  }

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

    // Detect function/method start (JS/TS and Java)
    const funcMatch =
      line.match(
        /(?:function|async function)\s+(\w+)|(\w+)\s*(?:=|:)\s*(?:async\s*)?\(?.*\)?\s*=>/,
      ) ??
      line.match(
        /(?:public|private|protected|static|final|native|synchronized|abstract)\s+\S+\s+(\w+)\s*\(/,
      );
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
 * Calculate full quality scores using the new QualityEvaluator
 * This replaces hardcoded values with real measurements
 */
export const calculateQualityTool: ToolDefinition<
  { cwd?: string; files?: string[]; useSnyk?: boolean },
  QualityScores
> = defineTool({
  name: "calculate_quality",
  description: `Calculate comprehensive quality scores using REAL analyzers (coverage, security, complexity).

This tool now uses the unified QualityEvaluator which provides:
- Real test coverage from c8/nyc instrumentation
- Security scanning (static analysis + npm audit + optional Snyk)
- AST-based complexity analysis
- Code duplication detection

Examples:
- Full analysis: {} → { "overall": 85, "dimensions": { "complexity": 90, "testCoverage": 82, "security": 100, ... } }
- Specific files: { "files": ["src/core/*.ts"] }
- With Snyk: { "useSnyk": true }`,
  category: "quality",
  parameters: z.object({
    cwd: z.string().optional().describe("Project directory"),
    files: z.array(z.string()).optional().describe("Specific files to analyze"),
    useSnyk: z
      .boolean()
      .optional()
      .default(false)
      .describe("Use Snyk for enhanced security scanning"),
  }),
  async execute({ cwd, files, useSnyk }) {
    const projectDir = cwd ?? process.cwd();

    try {
      // Use the new unified QualityEvaluator
      const evaluator = createQualityEvaluatorWithRegistry(projectDir, useSnyk);
      const evaluation = await evaluator.evaluate(files);

      // Return QualityScores format
      return evaluation.scores;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ToolError(
        `Quality calculation failed: ${msg}. Run run_linter and run_tests separately for partial results.`,
        { tool: "calculate_quality", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * All quality tools
 */
export const qualityTools = [runLinterTool, analyzeComplexityTool, calculateQualityTool];
