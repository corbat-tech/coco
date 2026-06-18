/**
 * Optional LSP-style code intelligence tools.
 *
 * These tools do not require a persistent language server. When a language
 * server is unavailable, they fall back to Coco's lightweight static parsers
 * and repository search so the agent can still navigate code safely.
 */

import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { glob } from "glob";
import { execa } from "execa";
import { defineTool, type ToolDefinition } from "./registry.js";
import {
  detectLanguage,
  parseTypeScript,
  type CodeDefinition,
  type DefinitionType,
} from "./codebase-map.js";

const SOURCE_GLOBS = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"];
const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/*.d.ts",
];

export interface LspStatusOutput {
  languageServers: Array<{ name: string; available: boolean }>;
  fallbackMode: "static-analysis";
}

export interface LspSymbol {
  file: string;
  name: string;
  type: DefinitionType;
  line: number;
  exported: boolean;
  signature?: string;
}

export interface LspReference {
  file: string;
  line: number;
  column: number;
  content: string;
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execa(command, ["--version"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function getSourceFiles(root: string, maxFiles: number): Promise<string[]> {
  const files = await glob(SOURCE_GLOBS, {
    cwd: root,
    absolute: false,
    ignore: DEFAULT_EXCLUDES,
    nodir: true,
  });
  return files.slice(0, maxFiles);
}

async function getFileSymbols(filePath: string): Promise<LspSymbol[]> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, "utf-8");
  const language = detectLanguage(absolutePath);
  if (language !== "typescript" && language !== "javascript") {
    return [];
  }

  return parseTypeScript(content).definitions.map((definition: CodeDefinition) => ({
    file: filePath,
    name: definition.name,
    type: definition.type,
    line: definition.line,
    exported: definition.exported,
    signature: definition.signature,
  }));
}

export const lspStatusTool: ToolDefinition<Record<string, never>, LspStatusOutput> = defineTool({
  name: "lsp_status",
  description:
    "Check optional language-server availability. Use before LSP-style navigation when you need to know whether Coco is using static fallbacks.",
  category: "search",
  parameters: z.object({}),
  async execute() {
    return {
      languageServers: [
        {
          name: "typescript-language-server",
          available: await commandAvailable("typescript-language-server"),
        },
        { name: "tsserver", available: await commandAvailable("tsserver") },
      ],
      fallbackMode: "static-analysis",
    };
  },
});

export const lspDocumentSymbolsTool: ToolDefinition<{ file: string }, { symbols: LspSymbol[] }> =
  defineTool({
    name: "lsp_document_symbols",
    description:
      "Return LSP-style document symbols for a TypeScript/JavaScript file using static analysis fallback.",
    category: "search",
    parameters: z.object({
      file: z.string().describe("File path to inspect"),
    }),
    async execute({ file }) {
      return { symbols: await getFileSymbols(file) };
    },
  });

export const lspWorkspaceSymbolsTool: ToolDefinition<
  { query: string; path?: string; maxFiles?: number; maxResults?: number },
  { symbols: LspSymbol[]; searchedFiles: number; truncated: boolean }
> = defineTool({
  name: "lsp_workspace_symbols",
  description:
    "Find LSP-style workspace symbols by name across TypeScript/JavaScript files using static analysis fallback.",
  category: "search",
  parameters: z.object({
    query: z.string().describe("Symbol name or substring to find"),
    path: z.string().optional().describe("Workspace directory, defaults to cwd"),
    maxFiles: z.number().optional().default(300),
    maxResults: z.number().optional().default(100),
  }),
  async execute({ query, path: workspacePath, maxFiles = 300, maxResults = 100 }) {
    const root = path.resolve(workspacePath ?? process.cwd());
    const files = await getSourceFiles(root, maxFiles);
    const lowerQuery = query.toLowerCase();
    const symbols: LspSymbol[] = [];

    for (const file of files) {
      const fileSymbols = await getFileSymbols(path.join(root, file));
      for (const symbol of fileSymbols) {
        if (!symbol.name.toLowerCase().includes(lowerQuery)) continue;
        symbols.push({ ...symbol, file });
        if (symbols.length >= maxResults) {
          return { symbols, searchedFiles: files.length, truncated: true };
        }
      }
    }

    return { symbols, searchedFiles: files.length, truncated: false };
  },
});

export const lspDefinitionTool: ToolDefinition<
  { symbol: string; path?: string; maxFiles?: number },
  { definition?: LspSymbol; candidates: LspSymbol[] }
> = defineTool({
  name: "lsp_definition",
  description:
    "Find the likely definition of a symbol using exported symbols first, then local definitions.",
  category: "search",
  parameters: z.object({
    symbol: z.string().describe("Exact symbol name to locate"),
    path: z.string().optional().describe("Workspace directory, defaults to cwd"),
    maxFiles: z.number().optional().default(300),
  }),
  async execute({ symbol, path: workspacePath, maxFiles = 300 }) {
    const root = path.resolve(workspacePath ?? process.cwd());
    const files = await getSourceFiles(root, maxFiles);
    const candidates: LspSymbol[] = [];

    for (const file of files) {
      const fileSymbols = await getFileSymbols(path.join(root, file));
      for (const candidate of fileSymbols) {
        if (candidate.name !== symbol) continue;
        candidates.push({ ...candidate, file });
      }
    }

    const definition = candidates.find((candidate) => candidate.exported) ?? candidates[0];
    return { definition, candidates };
  },
});

export const lspReferencesTool: ToolDefinition<
  { symbol: string; path?: string; maxFiles?: number; maxResults?: number },
  { references: LspReference[]; searchedFiles: number; truncated: boolean }
> = defineTool({
  name: "lsp_references",
  description:
    "Find likely references to a symbol across TypeScript/JavaScript files using whole-word text search.",
  category: "search",
  parameters: z.object({
    symbol: z.string().describe("Symbol name to find"),
    path: z.string().optional().describe("Workspace directory, defaults to cwd"),
    maxFiles: z.number().optional().default(300),
    maxResults: z.number().optional().default(100),
  }),
  async execute({ symbol, path: workspacePath, maxFiles = 300, maxResults = 100 }) {
    const root = path.resolve(workspacePath ?? process.cwd());
    const files = await getSourceFiles(root, maxFiles);
    const pattern = new RegExp(`\\b${escapeRegExp(symbol)}\\b`);
    const references: LspReference[] = [];

    for (const file of files) {
      const absolutePath = path.join(root, file);
      const content = await fs.readFile(absolutePath, "utf-8");
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? "";
        const match = pattern.exec(line);
        if (!match) continue;
        references.push({
          file,
          line: index + 1,
          column: match.index + 1,
          content: line.trim(),
        });
        if (references.length >= maxResults) {
          return { references, searchedFiles: files.length, truncated: true };
        }
      }
    }

    return { references, searchedFiles: files.length, truncated: false };
  },
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const lspTools = [
  lspStatusTool,
  lspDocumentSymbolsTool,
  lspWorkspaceSymbolsTool,
  lspDefinitionTool,
  lspReferencesTool,
];
