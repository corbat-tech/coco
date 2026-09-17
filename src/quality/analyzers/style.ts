/**
 * Style Analyzer
 * Measures linter output (oxlint, eslint, or biome)
 */

import { runQualityCommand as execa } from "../command.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Style analysis result
 */
export interface StyleResult {
  score: number;
  errors: number;
  warnings: number;
  linterUsed: string | null;
  details: string;
}

/**
 * Detected linter type
 */
type LinterType = "oxlint" | "eslint" | "biome" | null;

/**
 * Detect which linter is available in the project
 */
async function detectLinter(projectPath: string): Promise<LinterType> {
  try {
    const pkgContent = await readFile(join(projectPath, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgContent) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps.oxlint) return "oxlint";
    if (deps["@biomejs/biome"] || deps.biome) return "biome";
    if (deps.eslint) return "eslint";

    return null;
  } catch {
    return null;
  }
}

/** Parse supported machine-readable linter output; failures are never zero issues. */
async function runLinter(
  projectPath: string,
  linter: Exclude<LinterType, null>,
): Promise<{ errors: number; warnings: number }> {
  const args =
    linter === "biome"
      ? ["--no-install", "@biomejs/biome", "lint", "src", "--reporter=json"]
      : ["--no-install", linter, "src", "--format=json"];
  const result = await execa("npx", args, { cwd: projectPath, reject: false, timeout: 120000 });
  if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error("Linter process failed");
  const output = JSON.parse(result.stdout) as unknown;
  if (linter === "eslint") {
    if (
      !Array.isArray(output) ||
      !output.every(
        (item) => typeof item.errorCount === "number" && typeof item.warningCount === "number",
      )
    )
      throw new Error("Invalid ESLint report");
    const errors = output.reduce((n, item) => n + item.errorCount, 0);
    const warnings = output.reduce((n, item) => n + item.warningCount, 0);
    if (
      !Number.isInteger(errors) ||
      !Number.isInteger(warnings) ||
      errors < 0 ||
      warnings < 0 ||
      (result.exitCode === 1 && errors + warnings === 0)
    )
      throw new Error("Invalid ESLint counts or failure without diagnostics");
    return { errors, warnings };
  }
  const diagnostics = Array.isArray(output)
    ? output
    : (output as { diagnostics?: unknown[] } | null)?.diagnostics;
  if (!Array.isArray(diagnostics)) throw new Error("Invalid linter diagnostics report");
  let errors = 0,
    warnings = 0;
  for (const diagnostic of diagnostics) {
    if (!diagnostic || typeof diagnostic !== "object" || !("severity" in diagnostic))
      throw new Error("Invalid linter diagnostic");
    if (
      diagnostic.severity === "error" ||
      diagnostic.severity === "fatal" ||
      diagnostic.severity === 2
    )
      errors++;
    else if (
      diagnostic.severity === "warning" ||
      diagnostic.severity === "warn" ||
      diagnostic.severity === 1
    )
      warnings++;
    else if (diagnostic.severity !== "info" && diagnostic.severity !== "hint")
      throw new Error("Unknown linter severity");
  }
  if (result.exitCode === 1 && errors + warnings === 0)
    throw new Error("Linter failed without diagnostics");
  return { errors, warnings };
}

/**
 * Style Analyzer
 */
export class StyleAnalyzer {
  constructor(private projectPath: string) {}

  /**
   * Analyze style/linting quality
   */
  async analyze(): Promise<StyleResult> {
    const linter = await detectLinter(this.projectPath);

    if (!linter) {
      return {
        score: 50, // Neutral score when no linter is configured
        errors: 0,
        warnings: 0,
        linterUsed: null,
        details: "No linter configured",
      };
    }

    const result = await runLinter(this.projectPath, linter);

    // Score: start at 100, deduct for errors and warnings
    const score = Math.round(
      Math.max(0, Math.min(100, 100 - result.errors * 5 - result.warnings * 2)),
    );

    const details = [
      `Linter: ${linter}`,
      `${result.errors} errors, ${result.warnings} warnings`,
    ].join(", ");

    return {
      score,
      errors: result.errors,
      warnings: result.warnings,
      linterUsed: linter,
      details,
    };
  }
}

/**
 * Create style analyzer instance
 */
export function createStyleAnalyzer(projectPath: string): StyleAnalyzer {
  return new StyleAnalyzer(projectPath);
}
