/**
 * Import Analyzer
 * Analyzes imports and dependencies in generated code
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import type { GeneratedFile } from "../../phases/complete/types.js";

export interface ImportInfo {
  source: string;
  specifiers: string[];
  isTypeOnly: boolean;
  isDynamic: boolean;
  location: { line: number; column: number };
}

export interface DependencyInfo {
  name: string;
  version?: string;
  isDevDependency: boolean;
  isInstalled: boolean;
}

export interface CircularDependency {
  cycle: string[];
  severity: "warning" | "error";
}

export interface ImportAnalysis {
  imports: ImportInfo[];
  missingDependencies: string[];
  unusedImports: string[];
  circularDependencies: CircularDependency[];
  suggestions: Array<{
    action: "install" | "remove" | "break-cycle";
    package?: string;
    version?: string;
    reason?: string;
  }>;
}

/**
 * Import Analyzer
 */
export class ImportAnalyzer {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Analyze imports in generated files
   */
  async analyzeImports(files: GeneratedFile[]): Promise<ImportAnalysis> {
    const allImports: ImportInfo[] = [];
    const dependencySet = new Set<string>();

    // Extract imports from all files
    for (const file of files) {
      if (this.isCodeFile(file.path)) {
        const imports = await this.extractImports(file.content, file.path);
        allImports.push(...imports);

        // Collect external dependencies (not relative imports)
        for (const imp of imports) {
          if (!imp.source.startsWith(".") && !imp.source.startsWith("/")) {
            // Extract package name (handle scoped packages)
            const packageName = this.extractPackageName(imp.source);
            dependencySet.add(packageName);
          }
        }
      }
    }

    // Check which dependencies are missing
    const packageJson = await this.readPackageJson();
    const installedDeps = new Set([
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.devDependencies || {}),
    ]);

    const missingDependencies = Array.from(dependencySet).filter((dep) => !installedDeps.has(dep));

    // Detect unused imports (simplified - would need full usage analysis)
    const unusedImports: string[] = [];

    // Detect circular dependencies
    const circularDependencies = await this.detectCircularDependencies(files);

    // Generate suggestions
    const suggestions = this.generateSuggestions(missingDependencies, circularDependencies);

    return {
      imports: allImports,
      missingDependencies,
      unusedImports,
      circularDependencies,
      suggestions,
    };
  }

  /**
   * Auto-fix import issues
   */
  async autoFix(analysis: ImportAnalysis): Promise<void> {
    // Auto-add missing dependencies to package.json
    if (analysis.missingDependencies.length > 0) {
      await this.addDependencies(analysis.missingDependencies);
    }

    // Note: Removing unused imports and breaking circular dependencies
    // would require modifying the generated files, which should be done
    // by the code generator during iteration
  }

  /**
   * Extract imports from code
   */
  private async extractImports(code: string, filePath: string): Promise<ImportInfo[]> {
    const imports: ImportInfo[] = [];

    try {
      const ast = parse(code, {
        loc: true,
        comment: true,
        tokens: true,
        jsx: filePath.endsWith(".tsx") || filePath.endsWith(".jsx"),
        errorOnUnknownASTType: false,
        errorOnTypeScriptSyntacticAndSemanticIssues: false,
      });

      // Traverse AST to find import declarations
      const traverse = (node: TSESTree.Node): void => {
        if (node.type === "ImportDeclaration") {
          const importNode = node as TSESTree.ImportDeclaration;
          imports.push({
            source: importNode.source.value as string,
            specifiers:
              importNode.specifiers?.map((s) => {
                if (s.type === "ImportSpecifier") {
                  return s.local?.name || (s.imported as TSESTree.Identifier)?.name || "";
                }
                return s.local?.name || "";
              }) || [],
            isTypeOnly: importNode.importKind === "type",
            isDynamic: false,
            location: {
              line: importNode.loc?.start.line || 0,
              column: importNode.loc?.start.column || 0,
            },
          });
        }

        // Check for dynamic imports: import('module')
        if (
          node.type === "CallExpression" &&
          (node as TSESTree.CallExpression).callee?.type === ("Import" as string) &&
          (node as TSESTree.CallExpression).arguments?.[0]?.type === "Literal"
        ) {
          const callNode = node as TSESTree.CallExpression;
          const firstArg = callNode.arguments[0] as TSESTree.Literal;
          imports.push({
            source: firstArg.value as string,
            specifiers: [],
            isTypeOnly: false,
            isDynamic: true,
            location: {
              line: callNode.loc?.start.line || 0,
              column: callNode.loc?.start.column || 0,
            },
          });
        }

        // Recursively traverse child nodes
        for (const key of Object.keys(node)) {
          const child = (node as unknown as Record<string, unknown>)[key];
          if (child && typeof child === "object") {
            if (Array.isArray(child)) {
              child.forEach((c: unknown) => {
                if (c && typeof c === "object" && (c as TSESTree.Node).type) traverse(c as TSESTree.Node);
              });
            } else if ((child as TSESTree.Node).type) {
              traverse(child as TSESTree.Node);
            }
          }
        }
      };

      traverse(ast);
    } catch (error) {
      console.warn(`[ImportAnalyzer] Failed to parse ${filePath}:`, error);
    }

    return imports;
  }

  /**
   * Extract package name from import source
   */
  private extractPackageName(source: string): string {
    // Handle scoped packages: @scope/package/subpath -> @scope/package
    if (source.startsWith("@")) {
      const parts = source.split("/");
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : source;
    }

    // Handle regular packages: package/subpath -> package
    const parts = source.split("/");
    return parts[0] || source;
  }

  /**
   * Detect circular dependencies
   */
  private async detectCircularDependencies(files: GeneratedFile[]): Promise<CircularDependency[]> {
    const graph = new Map<string, Set<string>>();
    const filePaths = new Set(files.filter((f) => this.isCodeFile(f.path)).map((f) => f.path));

    // Build dependency graph
    for (const file of files) {
      if (!this.isCodeFile(file.path)) continue;

      const imports = await this.extractImports(file.content, file.path);
      const deps = new Set<string>();

      for (const imp of imports) {
        if (imp.source.startsWith(".")) {
          // Resolve relative import to absolute path
          const resolvedPath = this.resolveImport(file.path, imp.source);

          // Try to match the resolved path to an actual file in the graph
          // since imports often use .js extension but files are .ts
          const matchedPath = this.findMatchingFile(resolvedPath, filePaths);
          if (matchedPath) {
            deps.add(matchedPath);
          } else {
            deps.add(resolvedPath);
          }
        }
      }

      graph.set(file.path, deps);
    }

    // Detect cycles using DFS
    const cycles: CircularDependency[] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (node: string, path: string[]): void => {
      if (stack.has(node)) {
        // Found a cycle
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart).concat(node);
        cycles.push({
          cycle,
          severity: cycle.length <= 3 ? "error" : "warning",
        });
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      stack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || new Set();
      for (const neighbor of neighbors) {
        dfs(neighbor, [...path]);
      }

      stack.delete(node);
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  /**
   * Find matching file path from known file paths
   * Handles .js → .ts extension mapping
   */
  private findMatchingFile(resolvedPath: string, filePaths: Set<string>): string | undefined {
    // Direct match
    if (filePaths.has(resolvedPath)) return resolvedPath;

    // Try swapping extensions (.js → .ts, .jsx → .tsx)
    const extMap: Record<string, string[]> = {
      ".js": [".ts", ".tsx"],
      ".jsx": [".tsx", ".ts"],
      ".ts": [".js"],
      ".tsx": [".jsx"],
    };

    const ext = path.extname(resolvedPath);
    const base = resolvedPath.slice(0, -ext.length);
    const alternatives = extMap[ext] || [];

    for (const altExt of alternatives) {
      const altPath = base + altExt;
      if (filePaths.has(altPath)) return altPath;
    }

    // Try without extension + common extensions
    if (!ext) {
      for (const tryExt of [".ts", ".tsx", ".js", ".jsx"]) {
        const withExt = resolvedPath + tryExt;
        if (filePaths.has(withExt)) return withExt;
      }
    }

    return undefined;
  }

  /**
   * Resolve relative import to absolute path
   */
  private resolveImport(fromPath: string, importPath: string): string {
    const dir = path.dirname(fromPath);
    let resolved = path.resolve(dir, importPath);

    // Add extension if missing
    if (!path.extname(resolved)) {
      // Try common extensions
      for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
        if (resolved.endsWith(ext)) break;
        resolved += ext;
        break;
      }
    }

    return resolved;
  }

  /**
   * Generate suggestions based on analysis
   */
  private generateSuggestions(
    missingDeps: string[],
    circularDeps: CircularDependency[],
  ): ImportAnalysis["suggestions"] {
    const suggestions: ImportAnalysis["suggestions"] = [];

    // Suggest installing missing dependencies
    for (const dep of missingDeps) {
      suggestions.push({
        action: "install",
        package: dep,
        version: "latest",
        reason: `Missing dependency "${dep}" needs to be installed`,
      });
    }

    // Suggest breaking circular dependencies
    for (const circular of circularDeps) {
      if (circular.severity === "error") {
        suggestions.push({
          action: "break-cycle",
          reason: `Circular dependency detected: ${circular.cycle.join(" -> ")}`,
        });
      }
    }

    return suggestions;
  }

  /**
   * Read package.json
   */
  private async readPackageJson(): Promise<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }> {
    try {
      const packageJsonPath = path.join(this.projectRoot, "package.json");
      const content = await fs.readFile(packageJsonPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * Add dependencies to package.json
   */
  private async addDependencies(packages: string[]): Promise<void> {
    const packageJsonPath = path.join(this.projectRoot, "package.json");
    let packageJson: Record<string, unknown>;

    try {
      const content = await fs.readFile(packageJsonPath, "utf-8");
      packageJson = JSON.parse(content) as Record<string, unknown>;
    } catch {
      console.warn("[ImportAnalyzer] Could not read package.json");
      return;
    }

    // Add missing packages (would need to determine versions)
    for (const pkg of packages) {
      if (!packageJson.dependencies) {
        packageJson.dependencies = {};
      }
      const deps = packageJson.dependencies as Record<string, string>;
      if (!deps[pkg]) {
        deps[pkg] = "latest"; // Would use npm registry API to get actual version
      }
    }

    // Write back
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf-8");
    console.log(`[ImportAnalyzer] Added ${packages.length} dependencies to package.json`);
  }

  /**
   * Check if file is a code file
   */
  private isCodeFile(filePath: string): boolean {
    return /\.(ts|tsx|js|jsx)$/.test(filePath);
  }
}

/**
 * Create an import analyzer
 */
export function createImportAnalyzer(projectRoot: string): ImportAnalyzer {
  return new ImportAnalyzer(projectRoot);
}
