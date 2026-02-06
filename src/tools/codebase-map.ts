/**
 * Codebase Map tool for Corbat-Coco
 * Generate structural map of codebase: classes, functions, exports, interfaces
 * Token-efficient overview without reading full file contents
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";

const fs = await import("node:fs/promises");
const path = await import("node:path");
const { glob } = await import("glob");

/**
 * Maximum files to process
 */
const DEFAULT_MAX_FILES = 200;

/**
 * Supported languages and their extensions
 */
const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  python: [".py"],
  java: [".java"],
  go: [".go"],
  rust: [".rs"],
};

/**
 * Default exclude patterns
 */
const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/target/**",
  "**/.next/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.min.*",
  "**/*.d.ts",
];

/**
 * Definition types
 */
export type DefinitionType =
  | "class"
  | "function"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "variable"
  | "method";

/**
 * A single code definition
 */
export interface CodeDefinition {
  name: string;
  type: DefinitionType;
  line: number;
  exported: boolean;
  signature?: string;
}

/**
 * File map entry
 */
export interface FileMapEntry {
  path: string;
  language: string;
  definitions: CodeDefinition[];
  imports: string[];
  exports: string[];
  lineCount: number;
}

/**
 * Codebase map output
 */
export interface CodebaseMapOutput {
  files: FileMapEntry[];
  summary: {
    totalFiles: number;
    totalDefinitions: number;
    languages: Record<string, number>;
    exportedSymbols: number;
  };
  duration: number;
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  for (const [lang, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if (extensions.includes(ext)) return lang;
  }
  return null;
}

/**
 * Parse TypeScript/JavaScript definitions
 */
export function parseTypeScript(content: string): {
  definitions: CodeDefinition[];
  imports: string[];
  exports: string[];
} {
  const definitions: CodeDefinition[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const lineNum = i + 1;

    // Imports
    const importMatch = line.match(
      /^import\s+(?:(?:\{[^}]*\}|[\w*]+)\s+from\s+)?["']([^"']+)["']/,
    );
    if (importMatch) {
      imports.push(importMatch[1]!);
      continue;
    }

    // Export class
    const exportClassMatch = line.match(
      /^export\s+(default\s+)?(?:abstract\s+)?class\s+(\w+)/,
    );
    if (exportClassMatch) {
      definitions.push({
        name: exportClassMatch[2]!,
        type: "class",
        line: lineNum,
        exported: true,
        signature: line.trim().replace(/\{.*$/, "").trim(),
      });
      continue;
    }

    // Non-exported class
    const classMatch = line.match(/^(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      definitions.push({
        name: classMatch[1]!,
        type: "class",
        line: lineNum,
        exported: false,
        signature: line.trim().replace(/\{.*$/, "").trim(),
      });
      continue;
    }

    // Export function
    const exportFuncMatch = line.match(
      /^export\s+(default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/,
    );
    if (exportFuncMatch) {
      definitions.push({
        name: exportFuncMatch[2]!,
        type: "function",
        line: lineNum,
        exported: true,
        signature: line.trim().replace(/\{.*$/, "").trim(),
      });
      continue;
    }

    // Non-exported function
    const funcMatch = line.match(/^(?:async\s+)?function\s*\*?\s*(\w+)/);
    if (funcMatch) {
      definitions.push({
        name: funcMatch[1]!,
        type: "function",
        line: lineNum,
        exported: false,
        signature: line.trim().replace(/\{.*$/, "").trim(),
      });
      continue;
    }

    // Export interface
    const exportIfaceMatch = line.match(/^export\s+interface\s+(\w+)/);
    if (exportIfaceMatch) {
      definitions.push({
        name: exportIfaceMatch[1]!,
        type: "interface",
        line: lineNum,
        exported: true,
      });
      continue;
    }

    // Non-exported interface
    const ifaceMatch = line.match(/^interface\s+(\w+)/);
    if (ifaceMatch) {
      definitions.push({
        name: ifaceMatch[1]!,
        type: "interface",
        line: lineNum,
        exported: false,
      });
      continue;
    }

    // Export type
    const exportTypeMatch = line.match(/^export\s+type\s+(\w+)/);
    if (exportTypeMatch) {
      definitions.push({
        name: exportTypeMatch[1]!,
        type: "type",
        line: lineNum,
        exported: true,
      });
      continue;
    }

    // Non-exported type
    const typeMatch = line.match(/^type\s+(\w+)/);
    if (typeMatch) {
      definitions.push({
        name: typeMatch[1]!,
        type: "type",
        line: lineNum,
        exported: false,
      });
      continue;
    }

    // Export enum
    const exportEnumMatch = line.match(/^export\s+(const\s+)?enum\s+(\w+)/);
    if (exportEnumMatch) {
      definitions.push({
        name: exportEnumMatch[2]!,
        type: "enum",
        line: lineNum,
        exported: true,
      });
      continue;
    }

    // Export const (arrow functions and values)
    const exportConstMatch = line.match(
      /^export\s+const\s+(\w+)\s*(?::\s*[^=]+)?\s*=/,
    );
    if (exportConstMatch) {
      const isFunction =
        line.includes("=>") ||
        line.includes("function") ||
        line.includes("defineTool");
      definitions.push({
        name: exportConstMatch[1]!,
        type: isFunction ? "function" : "const",
        line: lineNum,
        exported: true,
      });
      continue;
    }

    // Exported names (re-exports)
    const reExportMatch = line.match(/^export\s+\{([^}]+)\}/);
    if (reExportMatch) {
      const names = reExportMatch[1]!.split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!.trim());
      for (const name of names) {
        if (name && !name.startsWith("type ")) {
          exports.push(name);
        }
      }
      continue;
    }
  }

  // Collect exports
  for (const def of definitions) {
    if (def.exported) exports.push(def.name);
  }

  return { definitions, imports, exports: [...new Set(exports)] };
}

/**
 * Parse Python definitions
 */
export function parsePython(content: string): {
  definitions: CodeDefinition[];
  imports: string[];
  exports: string[];
} {
  const definitions: CodeDefinition[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const lineNum = i + 1;

    // Imports
    const importMatch = line.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)/);
    if (importMatch) {
      imports.push(importMatch[1] ?? importMatch[2]!.split(",")[0]!.trim());
      continue;
    }

    // Class
    const classMatch = line.match(/^class\s+(\w+)/);
    if (classMatch) {
      const isExported = !classMatch[1]!.startsWith("_");
      definitions.push({
        name: classMatch[1]!,
        type: "class",
        line: lineNum,
        exported: isExported,
        signature: line.trim().replace(/:.*$/, "").trim(),
      });
      if (isExported) exports.push(classMatch[1]!);
      continue;
    }

    // Function (top-level only)
    const funcMatch = line.match(/^(async\s+)?def\s+(\w+)\s*\(/);
    if (funcMatch) {
      const isExported = !funcMatch[2]!.startsWith("_");
      definitions.push({
        name: funcMatch[2]!,
        type: "function",
        line: lineNum,
        exported: isExported,
        signature: line.trim().replace(/:.*$/, "").trim(),
      });
      if (isExported) exports.push(funcMatch[2]!);
      continue;
    }

    // Top-level constant (UPPER_CASE)
    const constMatch = line.match(/^([A-Z][A-Z_0-9]+)\s*=/);
    if (constMatch) {
      definitions.push({
        name: constMatch[1]!,
        type: "const",
        line: lineNum,
        exported: true,
      });
      exports.push(constMatch[1]!);
    }
  }

  return { definitions, imports, exports };
}

/**
 * Parse Java definitions
 */
export function parseJava(content: string): {
  definitions: CodeDefinition[];
  imports: string[];
  exports: string[];
} {
  const definitions: CodeDefinition[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const lineNum = i + 1;

    // Imports
    const importMatch = line.match(/^import\s+([\w.]+);/);
    if (importMatch) {
      imports.push(importMatch[1]!);
      continue;
    }

    // Class/Interface/Enum/Record
    const typeMatch = line.match(
      /(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?(?:final\s+)?(class|interface|enum|record)\s+(\w+)/,
    );
    if (typeMatch) {
      const isPublic = line.includes("public");
      definitions.push({
        name: typeMatch[2]!,
        type: typeMatch[1] === "record" ? "class" : (typeMatch[1] as DefinitionType),
        line: lineNum,
        exported: isPublic,
        signature: line.trim().replace(/\{.*$/, "").trim(),
      });
      if (isPublic) exports.push(typeMatch[2]!);
      continue;
    }

    // Method (public)
    const methodMatch = line.match(
      /\s+(?:public|protected)\s+(?:static\s+)?(?:abstract\s+)?(?:final\s+)?(?:synchronized\s+)?[\w<>\[\],\s]+\s+(\w+)\s*\(/,
    );
    if (methodMatch && !line.includes("class ") && !line.includes("interface ")) {
      definitions.push({
        name: methodMatch[1]!,
        type: "method",
        line: lineNum,
        exported: line.includes("public"),
        signature: line.trim().replace(/\{.*$/, "").trim(),
      });
    }
  }

  return { definitions, imports, exports };
}

/**
 * Parse Go definitions
 */
export function parseGo(content: string): {
  definitions: CodeDefinition[];
  imports: string[];
  exports: string[];
} {
  const definitions: CodeDefinition[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const lineNum = i + 1;

    // Imports
    const importMatch = line.match(/^\s*"([^"]+)"/);
    if (importMatch && i > 0 && content.slice(0, content.indexOf(line)).includes("import")) {
      imports.push(importMatch[1]!);
      continue;
    }

    // Function
    const funcMatch = line.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/);
    if (funcMatch) {
      const isExported = funcMatch[1]![0] === funcMatch[1]![0]!.toUpperCase();
      definitions.push({
        name: funcMatch[1]!,
        type: "function",
        line: lineNum,
        exported: isExported,
        signature: line.trim().replace(/\{.*$/, "").trim(),
      });
      if (isExported) exports.push(funcMatch[1]!);
      continue;
    }

    // Type (struct, interface)
    const typeMatch = line.match(/^type\s+(\w+)\s+(struct|interface)/);
    if (typeMatch) {
      const isExported = typeMatch[1]![0] === typeMatch[1]![0]!.toUpperCase();
      definitions.push({
        name: typeMatch[1]!,
        type: typeMatch[2] === "struct" ? "class" : "interface",
        line: lineNum,
        exported: isExported,
      });
      if (isExported) exports.push(typeMatch[1]!);
      continue;
    }

    // Type alias
    const typeAliasMatch = line.match(/^type\s+(\w+)\s+/);
    if (typeAliasMatch && !line.includes("struct") && !line.includes("interface")) {
      const isExported = typeAliasMatch[1]![0] === typeAliasMatch[1]![0]!.toUpperCase();
      definitions.push({
        name: typeAliasMatch[1]!,
        type: "type",
        line: lineNum,
        exported: isExported,
      });
      if (isExported) exports.push(typeAliasMatch[1]!);
    }
  }

  return { definitions, imports, exports };
}

/**
 * Parse Rust definitions
 */
export function parseRust(content: string): {
  definitions: CodeDefinition[];
  imports: string[];
  exports: string[];
} {
  const definitions: CodeDefinition[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const lineNum = i + 1;

    // Use imports
    const useMatch = line.match(/^use\s+([\w:]+)/);
    if (useMatch) {
      imports.push(useMatch[1]!);
      continue;
    }

    // Function
    const funcMatch = line.match(/^(pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (funcMatch) {
      const isPublic = !!funcMatch[1];
      definitions.push({
        name: funcMatch[2]!,
        type: "function",
        line: lineNum,
        exported: isPublic,
        signature: line.trim().replace(/\{.*$/, "").trim(),
      });
      if (isPublic) exports.push(funcMatch[2]!);
      continue;
    }

    // Struct
    const structMatch = line.match(/^(pub\s+)?struct\s+(\w+)/);
    if (structMatch) {
      const isPublic = !!structMatch[1];
      definitions.push({
        name: structMatch[2]!,
        type: "class",
        line: lineNum,
        exported: isPublic,
      });
      if (isPublic) exports.push(structMatch[2]!);
      continue;
    }

    // Enum
    const enumMatch = line.match(/^(pub\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      const isPublic = !!enumMatch[1];
      definitions.push({
        name: enumMatch[2]!,
        type: "enum",
        line: lineNum,
        exported: isPublic,
      });
      if (isPublic) exports.push(enumMatch[2]!);
      continue;
    }

    // Trait
    const traitMatch = line.match(/^(pub\s+)?trait\s+(\w+)/);
    if (traitMatch) {
      const isPublic = !!traitMatch[1];
      definitions.push({
        name: traitMatch[2]!,
        type: "interface",
        line: lineNum,
        exported: isPublic,
      });
      if (isPublic) exports.push(traitMatch[2]!);
      continue;
    }

    // Type alias
    const typeMatch = line.match(/^(pub\s+)?type\s+(\w+)/);
    if (typeMatch) {
      const isPublic = !!typeMatch[1];
      definitions.push({
        name: typeMatch[2]!,
        type: "type",
        line: lineNum,
        exported: isPublic,
      });
      if (isPublic) exports.push(typeMatch[2]!);
    }
  }

  return { definitions, imports, exports };
}

/**
 * Parse file based on language
 */
function parseFile(
  content: string,
  language: string,
): { definitions: CodeDefinition[]; imports: string[]; exports: string[] } {
  switch (language) {
    case "typescript":
    case "javascript":
      return parseTypeScript(content);
    case "python":
      return parsePython(content);
    case "java":
      return parseJava(content);
    case "go":
      return parseGo(content);
    case "rust":
      return parseRust(content);
    default:
      return { definitions: [], imports: [], exports: [] };
  }
}

/**
 * Codebase map tool
 */
export const codebaseMapTool: ToolDefinition<
  {
    path?: string;
    include?: string;
    exclude?: string[];
    languages?: Array<
      "typescript" | "javascript" | "python" | "java" | "go" | "rust"
    >;
    maxFiles?: number;
    depth?: "overview" | "detailed";
  },
  CodebaseMapOutput
> = defineTool({
  name: "codebase_map",
  description: `Generate a structural map of the codebase showing classes, functions, interfaces, types, and exports.
Token-efficient: returns only definitions and signatures, not full code bodies.

Examples:
- Map current project: { "path": "." }
- Map specific directory: { "path": "src/tools", "languages": ["typescript"] }
- With custom includes: { "path": ".", "include": "**/*.ts" }`,
  category: "search",
  parameters: z.object({
    path: z
      .string()
      .optional()
      .default(".")
      .describe("Root directory to map"),
    include: z
      .string()
      .optional()
      .describe("Glob pattern for files to include"),
    exclude: z
      .array(z.string())
      .optional()
      .describe("Additional patterns to exclude"),
    languages: z
      .array(
        z.enum(["typescript", "javascript", "python", "java", "go", "rust"]),
      )
      .optional()
      .describe("Languages to parse (auto-detected if not specified)"),
    maxFiles: z
      .number()
      .min(1)
      .max(1000)
      .optional()
      .default(DEFAULT_MAX_FILES)
      .describe("Maximum files to process"),
    depth: z
      .enum(["overview", "detailed"])
      .optional()
      .default("overview")
      .describe("Level of detail"),
  }),
  async execute({
    path: rootPath,
    include,
    exclude,
    languages,
    maxFiles,
    depth,
  }) {
    const startTime = performance.now();

    // Resolve absolute path
    const absPath = path.resolve(rootPath!);

    // Check directory exists
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isDirectory()) {
        throw new ToolError(`Path is not a directory: ${absPath}`, {
          tool: "codebase_map",
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ToolError(`Directory not found: ${absPath}`, {
          tool: "codebase_map",
        });
      }
      throw error;
    }

    // Build glob pattern
    let pattern: string;
    if (include) {
      pattern = include;
    } else if (languages && languages.length > 0) {
      const extensions = languages.flatMap(
        (lang) => LANGUAGE_EXTENSIONS[lang] ?? [],
      );
      pattern =
        extensions.length === 1
          ? `**/*${extensions[0]}`
          : `**/*{${extensions.join(",")}}`;
    } else {
      // All supported extensions
      const allExts = Object.values(LANGUAGE_EXTENSIONS).flat();
      pattern = `**/*{${allExts.join(",")}}`;
    }

    // Find files
    const excludePatterns = [...DEFAULT_EXCLUDES, ...(exclude ?? [])];
    const files = await glob(pattern, {
      cwd: absPath,
      ignore: excludePatterns,
      nodir: true,
      absolute: false,
    });

    // Limit files
    const limitedFiles = files.slice(0, maxFiles);

    // Process files
    const fileEntries: FileMapEntry[] = [];
    const languageCounts: Record<string, number> = {};
    let totalDefinitions = 0;
    let exportedSymbols = 0;

    for (const file of limitedFiles) {
      const fullPath = path.join(absPath, file);
      const language = detectLanguage(file);
      if (!language) continue;

      // Filter by requested languages
      if (languages && !languages.includes(language as typeof languages[number])) {
        continue;
      }

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const lineCount = content.split("\n").length;
        const parsed = parseFile(content, language);

        // For overview mode, limit to exported items only
        const definitions =
          depth === "overview"
            ? parsed.definitions.filter((d) => d.exported)
            : parsed.definitions;

        fileEntries.push({
          path: file,
          language,
          definitions,
          imports: parsed.imports,
          exports: parsed.exports,
          lineCount,
        });

        languageCounts[language] = (languageCounts[language] ?? 0) + 1;
        totalDefinitions += definitions.length;
        exportedSymbols += parsed.exports.length;
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    return {
      files: fileEntries,
      summary: {
        totalFiles: fileEntries.length,
        totalDefinitions,
        languages: languageCounts,
        exportedSymbols,
      },
      duration: performance.now() - startTime,
    };
  },
});

/**
 * All codebase map tools
 */
export const codebaseMapTools = [codebaseMapTool];
