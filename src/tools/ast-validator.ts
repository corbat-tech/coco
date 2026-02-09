/**
 * AST-aware validation for code editing
 * Validates syntax before applying changes
 */

import { parse } from "@typescript-eslint/typescript-estree";
import { defineTool } from "./registry.js";
import { z } from "zod";

export const ValidateCodeSchema = z.object({
  code: z.string().describe("Code to validate"),
  filePath: z.string().describe("File path for context"),
  language: z.enum(["typescript", "javascript"]).default("typescript"),
});

export type ValidateCodeInput = z.infer<typeof ValidateCodeSchema>;

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    line: number;
    column: number;
    message: string;
  }>;
  warnings: Array<{
    line: number;
    column: number;
    message: string;
  }>;
  ast?: unknown;
}

/**
 * Validate TypeScript/JavaScript code using AST parsing
 */
export async function validateCode(
  code: string,
  filePath: string,
  _language: "typescript" | "javascript",
): Promise<ValidationResult> {
  const errors: ValidationResult["errors"] = [];
  const warnings: ValidationResult["warnings"] = [];

  try {
    const ast = parse(code, {
      loc: true,
      range: true,
      comment: true,
      tokens: true,
      jsx: filePath.endsWith(".tsx") || filePath.endsWith(".jsx"),
      errorOnUnknownASTType: false,
      errorOnTypeScriptSyntacticAndSemanticIssues: false, // Disabled: not supported by parse()
      filePath,
    });

    // Check for common issues
    if (code.includes("any") && !code.includes("// @ts-expect-error")) {
      warnings.push({
        line: 0,
        column: 0,
        message: "Code contains 'any' type - consider using more specific types",
      });
    }

    if (code.includes("console.log") && !filePath.includes("test")) {
      warnings.push({
        line: 0,
        column: 0,
        message: "Code contains console.log - consider using proper logging",
      });
    }

    return {
      valid: true,
      errors,
      warnings,
      ast,
    };
  } catch (error: unknown) {
    const err = error as { lineNumber?: number; column?: number; message?: string };
    errors.push({
      line: err.lineNumber ?? 0,
      column: err.column ?? 0,
      message: err.message ?? "Unknown syntax error",
    });

    return {
      valid: false,
      errors,
      warnings,
    };
  }
}

/**
 * Extract imports from code
 */
export function extractImports(code: string): string[] {
  const imports: string[] = [];

  for (const line of code.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("import ")) continue;
    const fromMatch = /from\s+['"]([^'"]+)['"]/.exec(trimmed);
    if (fromMatch?.[1]) {
      imports.push(fromMatch[1]);
    }
  }

  return imports;
}

/**
 * Check for missing imports
 */
export function findMissingImports(code: string, _filePath: string): string[] {
  const imports = extractImports(code);
  const missing: string[] = [];

  // Check for common patterns that might need imports
  const patterns = [
    { pattern: /\bfs\./g, import: "node:fs/promises" },
    { pattern: /\bpath\./g, import: "node:path" },
    { pattern: /\bprocess\./g, import: "node:process" },
    { pattern: /\bchildProcess\./g, import: "node:child_process" },
  ];

  for (const { pattern, import: importPath } of patterns) {
    if (pattern.test(code) && !imports.some((imp) => imp.includes(importPath))) {
      missing.push(importPath);
    }
  }

  return missing;
}

/**
 * Tool: Validate code syntax before applying changes
 */
export const validateCodeTool = defineTool({
  name: "validateCode",
  description: "Validate TypeScript/JavaScript code syntax using AST parsing",
  category: "quality" as const,
  parameters: ValidateCodeSchema,
  async execute(input) {
    const { code, filePath, language } = input as ValidateCodeInput;
    const result = await validateCode(code, filePath, language);

    return {
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      hasAst: !!result.ast,
    };
  },
});

/**
 * Tool: Find missing imports in code
 */
export const findMissingImportsTool = defineTool({
  name: "findMissingImports",
  description: "Find potentially missing imports in TypeScript/JavaScript code",
  category: "quality" as const,
  parameters: z.object({
    code: z.string(),
    filePath: z.string(),
  }),
  async execute(input) {
    const { code, filePath } = input as { code: string; filePath: string };
    const missing = findMissingImports(code, filePath);
    const existing = extractImports(code);

    return {
      existingImports: existing,
      missingImports: missing,
      hasMissing: missing.length > 0,
    };
  },
});

export const astValidatorTools = [validateCodeTool, findMissingImportsTool];
