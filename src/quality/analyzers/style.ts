/**
 * Style Analyzer
 * Measures linter output (oxlint, eslint, or biome)
 */

import { execa } from "execa";
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

/**
 * Run oxlint and parse output
 */
async function runOxlint(
  projectPath: string,
): Promise<{ errors: number; warnings: number }> {
  try {
    const result = await execa("npx", ["oxlint", "src", "--format=json"], {
      cwd: projectPath,
      reject: false,
      timeout: 60000,
    });

    try {
      const output = JSON.parse(result.stdout);
      const errors = Array.isArray(output)
        ? output.filter((d: unknown) => {
            const diag = d as Record<string, unknown>;
            return diag.severity === 2 || diag.severity === "error";
          }).length
        : 0;
      const warnings = Array.isArray(output)
        ? output.filter((d: unknown) => {
            const diag = d as Record<string, unknown>;
            return diag.severity === 1 || diag.severity === "warning";
          }).length
        : 0;
      return { errors, warnings };
    } catch {
      // Parse text output: count "error" and "warning" lines
      const lines = (result.stdout + result.stderr).split("\n");
      let errors = 0;
      let warnings = 0;
      for (const line of lines) {
        if (/error\[/.test(line) || /✖.*error/.test(line)) errors++;
        if (/warning\[/.test(line) || /⚠.*warning/.test(line)) warnings++;
      }
      return { errors, warnings };
    }
  } catch {
    return { errors: 0, warnings: 0 };
  }
}

/**
 * Run eslint and parse output
 */
async function runEslint(
  projectPath: string,
): Promise<{ errors: number; warnings: number }> {
  try {
    const result = await execa("npx", ["eslint", "src", "--format=json"], {
      cwd: projectPath,
      reject: false,
      timeout: 120000,
    });

    try {
      const output = JSON.parse(result.stdout) as Array<{
        errorCount: number;
        warningCount: number;
      }>;
      const errors = output.reduce((sum, f) => sum + f.errorCount, 0);
      const warnings = output.reduce((sum, f) => sum + f.warningCount, 0);
      return { errors, warnings };
    } catch {
      return { errors: 0, warnings: 0 };
    }
  } catch {
    return { errors: 0, warnings: 0 };
  }
}

/**
 * Run biome and parse output
 */
async function runBiome(
  projectPath: string,
): Promise<{ errors: number; warnings: number }> {
  try {
    const result = await execa(
      "npx",
      ["@biomejs/biome", "lint", "src", "--reporter=json"],
      {
        cwd: projectPath,
        reject: false,
        timeout: 60000,
      },
    );

    try {
      const output = JSON.parse(result.stdout);
      const diagnostics = output.diagnostics ?? [];
      const errors = diagnostics.filter(
        (d: unknown) => (d as Record<string, unknown>).severity === "error",
      ).length;
      const warnings = diagnostics.filter(
        (d: unknown) => (d as Record<string, unknown>).severity === "warning",
      ).length;
      return { errors, warnings };
    } catch {
      return { errors: 0, warnings: 0 };
    }
  } catch {
    return { errors: 0, warnings: 0 };
  }
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

    let result: { errors: number; warnings: number };

    switch (linter) {
      case "oxlint":
        result = await runOxlint(this.projectPath);
        break;
      case "eslint":
        result = await runEslint(this.projectPath);
        break;
      case "biome":
        result = await runBiome(this.projectPath);
        break;
    }

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
