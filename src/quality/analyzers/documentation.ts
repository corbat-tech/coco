/**
 * Documentation Analyzer
 * Measures JSDoc coverage and project documentation presence
 */

import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "glob";
import { constants } from "node:fs";

/**
 * Documentation analysis result
 */
export interface DocumentationResult {
  score: number;
  jsdocCoverage: number;
  hasReadme: boolean;
  hasChangelog: boolean;
  exportedDeclarations: number;
  documentedDeclarations: number;
  details: string;
}

/**
 * Check if a node has a JSDoc comment preceding it
 */
function hasJSDocComment(node: TSESTree.Node, sourceCode: string): boolean {
  const startLine = node.loc.start.line;
  const lines = sourceCode.split("\n");

  // Look at lines before the declaration for /** ... */ patterns
  for (let i = startLine - 2; i >= Math.max(0, startLine - 10); i--) {
    const line = lines[i]?.trim() ?? "";

    // Found JSDoc closing
    if (line.endsWith("*/")) {
      // Check if it's a JSDoc (starts with /**)
      for (let j = i; j >= Math.max(0, i - 20); j--) {
        const commentLine = lines[j]?.trim() ?? "";
        if (commentLine.startsWith("/**")) return true;
        if (commentLine.startsWith("/*") && !commentLine.startsWith("/**")) return false;
      }
    }

    // If we hit a non-empty, non-comment line, stop looking
    if (line && !line.startsWith("*") && !line.startsWith("//") && !line.startsWith("/*")) {
      break;
    }
  }

  return false;
}

/**
 * Count exported declarations and their JSDoc coverage
 */
function analyzeExportDocumentation(
  ast: TSESTree.Program,
  sourceCode: string,
): { exported: number; documented: number } {
  let exported = 0;
  let documented = 0;

  for (const node of ast.body) {
    if (node.type === "ExportNamedDeclaration" && node.declaration) {
      const decl = node.declaration;

      switch (decl.type) {
        case "FunctionDeclaration":
          exported++;
          if (hasJSDocComment(node, sourceCode)) documented++;
          break;

        case "ClassDeclaration":
          exported++;
          if (hasJSDocComment(node, sourceCode)) documented++;
          break;

        case "TSInterfaceDeclaration":
        case "TSTypeAliasDeclaration":
        case "TSEnumDeclaration":
          exported++;
          if (hasJSDocComment(node, sourceCode)) documented++;
          break;

        case "VariableDeclaration":
          for (const _declarator of decl.declarations) {
            exported++;
            if (hasJSDocComment(node, sourceCode)) documented++;
          }
          break;
      }
    } else if (node.type === "ExportDefaultDeclaration") {
      exported++;
      if (hasJSDocComment(node, sourceCode)) documented++;
    }
  }

  return { exported, documented };
}

/**
 * Documentation Analyzer
 */
export class DocumentationAnalyzer {
  constructor(private projectPath: string) {}

  /**
   * Analyze documentation quality
   */
  async analyze(files?: string[]): Promise<DocumentationResult> {
    const targetFiles = files ?? (await this.findSourceFiles());

    let totalExported = 0;
    let totalDocumented = 0;

    for (const file of targetFiles) {
      try {
        const content = await readFile(file, "utf-8");
        const ast = parse(content, {
          loc: true,
          range: true,
          comment: true,
          jsx: file.endsWith(".tsx") || file.endsWith(".jsx"),
        });

        const result = analyzeExportDocumentation(ast, content);
        totalExported += result.exported;
        totalDocumented += result.documented;
      } catch {
        // Skip files that can't be parsed
      }
    }

    const jsdocCoverage = totalExported > 0 ? (totalDocumented / totalExported) * 100 : 0;
    const hasReadme = await this.fileExists("README.md");
    const hasChangelog =
      (await this.fileExists("CHANGELOG.md")) || (await this.fileExists("CHANGES.md"));

    // Score: 70% JSDoc coverage + 20% README + 10% CHANGELOG
    const score = Math.round(
      Math.max(
        0,
        Math.min(100, jsdocCoverage * 0.7 + (hasReadme ? 20 : 0) + (hasChangelog ? 10 : 0)),
      ),
    );

    const details = [
      `${totalDocumented}/${totalExported} exports documented (${jsdocCoverage.toFixed(1)}%)`,
      `README: ${hasReadme ? "yes" : "no"}`,
      `CHANGELOG: ${hasChangelog ? "yes" : "no"}`,
    ].join(", ");

    return {
      score,
      jsdocCoverage,
      hasReadme,
      hasChangelog,
      exportedDeclarations: totalExported,
      documentedDeclarations: totalDocumented,
      details,
    };
  }

  private async fileExists(relativePath: string): Promise<boolean> {
    try {
      await access(join(this.projectPath, relativePath), constants.R_OK);
      return true;
    } catch {
      return false;
    }
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
 * Create documentation analyzer instance
 */
export function createDocumentationAnalyzer(projectPath: string): DocumentationAnalyzer {
  return new DocumentationAnalyzer(projectPath);
}
