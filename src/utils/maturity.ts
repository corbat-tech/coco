/**
 * Project maturity detection
 *
 * Heuristic-based detection of project maturity level.
 * Used by the review tool to adjust recommendations:
 * - empty: recommend project structure, CI, testing
 * - new: suggest tests, documentation, standards
 * - established: enforce existing patterns, check consistency
 */

import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "glob";

export type MaturityLevel = "empty" | "new" | "established";

export interface MaturityInfo {
  level: MaturityLevel;
  sourceFiles: number;
  testFiles: number;
  hasPackageJson: boolean;
  hasCI: boolean;
  hasLintConfig: boolean;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function dirHasFiles(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Detect project maturity level based on heuristics.
 */
export async function detectMaturity(cwd: string): Promise<MaturityInfo> {
  const hasPackageJson = await fileExists(join(cwd, "package.json"));

  if (!hasPackageJson) {
    // Check for other project indicators (go.mod, Cargo.toml, pyproject.toml, etc.)
    const otherManifests = [
      "go.mod", "Cargo.toml", "pyproject.toml", "pom.xml",
      "build.gradle", "Makefile", "CMakeLists.txt",
    ];
    let hasAnyManifest = false;
    for (const m of otherManifests) {
      if (await fileExists(join(cwd, m))) {
        hasAnyManifest = true;
        break;
      }
    }
    if (!hasAnyManifest) {
      return { level: "empty", sourceFiles: 0, testFiles: 0, hasPackageJson: false, hasCI: false, hasLintConfig: false };
    }
  }

  // Count source files
  const sourcePatterns = ["**/*.{ts,tsx,js,jsx,py,go,rs,java}", "!node_modules/**", "!dist/**", "!build/**", "!.git/**"];
  const sourceFiles = await glob(sourcePatterns[0]!, {
    cwd,
    ignore: ["node_modules/**", "dist/**", "build/**", ".git/**"],
  });

  if (sourceFiles.length < 5) {
    return {
      level: "empty",
      sourceFiles: sourceFiles.length,
      testFiles: 0,
      hasPackageJson,
      hasCI: false,
      hasLintConfig: false,
    };
  }

  // Count test files
  const testFiles = await glob("**/*.{test,spec}.{ts,tsx,js,jsx}", {
    cwd,
    ignore: ["node_modules/**", "dist/**", "build/**"],
  });

  // Check for CI
  const hasCI =
    (await fileExists(join(cwd, ".github/workflows"))) &&
    (await dirHasFiles(join(cwd, ".github/workflows")));

  // Check for lint config
  const lintConfigs = [
    ".eslintrc.js", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml", ".eslintrc",
    "biome.json", "biome.jsonc", ".oxlintrc.json",
  ];
  let hasLintConfig = false;
  for (const config of lintConfigs) {
    if (await fileExists(join(cwd, config))) {
      hasLintConfig = true;
      break;
    }
  }

  // Also check package.json for lint scripts as a lint config indicator
  if (!hasLintConfig && hasPackageJson) {
    try {
      const pkgRaw = await import("node:fs/promises").then((fs) =>
        fs.readFile(join(cwd, "package.json"), "utf-8"),
      );
      const pkg = JSON.parse(pkgRaw);
      if (pkg.scripts?.lint || pkg.scripts?.["lint:fix"]) {
        hasLintConfig = true;
      }
    } catch {
      // ignore
    }
  }

  // Determine level
  const isEstablished =
    sourceFiles.length >= 50 &&
    testFiles.length >= 5 &&
    (hasCI || hasLintConfig);

  const level: MaturityLevel = isEstablished ? "established" : "new";

  return {
    level,
    sourceFiles: sourceFiles.length,
    testFiles: testFiles.length,
    hasPackageJson,
    hasCI,
    hasLintConfig,
  };
}
