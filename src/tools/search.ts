/**
 * Search tools for Corbat-Coco
 * Content search across files
 */

import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { glob } from "glob";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";

/**
 * Search match interface
 */
export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  content: string;
  contextBefore: string[];
  contextAfter: string[];
}

/**
 * Search result interface
 */
export interface SearchResult {
  matches: SearchMatch[];
  totalMatches: number;
  filesSearched: number;
  filesWithMatches: number;
  truncated: boolean;
}

/**
 * Grep/search tool
 */
export const grepTool: ToolDefinition<
  {
    pattern: string;
    path?: string;
    include?: string;
    exclude?: string[];
    contextLines?: number;
    maxResults?: number;
    caseSensitive?: boolean;
    wholeWord?: boolean;
  },
  SearchResult
> = defineTool({
  name: "grep",
  description: `Search for text patterns in files using regex.

Examples:
- Simple search: { "pattern": "TODO" }
- With context: { "pattern": "function\\s+\\w+", "contextLines": 2 }
- TypeScript only: { "pattern": "import", "include": "**/*.ts" }
- Case insensitive: { "pattern": "error", "caseSensitive": false }
- Whole words: { "pattern": "test", "wholeWord": true }`,
  category: "file",
  parameters: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().optional().describe("Directory or file to search (defaults to cwd)"),
    include: z.string().optional().describe("File glob pattern (e.g., '**/*.ts')"),
    exclude: z.array(z.string()).optional().describe("Patterns to exclude"),
    contextLines: z
      .number()
      .optional()
      .default(0)
      .describe("Lines of context before and after match"),
    maxResults: z.number().optional().default(100).describe("Maximum number of matches to return"),
    caseSensitive: z.boolean().optional().default(true).describe("Case sensitive search"),
    wholeWord: z.boolean().optional().default(false).describe("Match whole words only"),
  }),
  async execute({
    pattern,
    path: searchPath,
    include,
    exclude,
    contextLines,
    maxResults,
    caseSensitive,
    wholeWord,
  }) {
    const targetPath = searchPath ? path.resolve(searchPath) : process.cwd();
    const matches: SearchMatch[] = [];
    let filesSearched = 0;
    const filesWithMatches = new Set<string>();
    let truncated = false;

    try {
      // Build regex
      let regexPattern = pattern;
      if (wholeWord) {
        regexPattern = `\\b${pattern}\\b`;
      }
      const flags = caseSensitive ? "g" : "gi";
      const regex = new RegExp(regexPattern, flags);

      // Find files to search
      const stats = await fs.stat(targetPath);
      let filesToSearch: string[];

      if (stats.isFile()) {
        filesToSearch = [targetPath];
      } else {
        const globPattern = include ?? "**/*.{ts,tsx,js,jsx,json,md,txt}";
        const defaultExclude = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/coverage/**"];
        const excludePatterns = exclude ?? defaultExclude;

        filesToSearch = await glob(globPattern, {
          cwd: targetPath,
          absolute: true,
          ignore: excludePatterns,
          nodir: true,
        });
      }

      // Search files
      for (const file of filesToSearch) {
        if (matches.length >= (maxResults ?? 100)) {
          truncated = true;
          break;
        }

        filesSearched++;

        try {
          const content = await fs.readFile(file, "utf-8");
          const lines = content.split("\n");
          let fileHasMatch = false;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? "";
            regex.lastIndex = 0; // Reset regex state

            let match;
            while ((match = regex.exec(line)) !== null) {
              if (matches.length >= (maxResults ?? 100)) {
                truncated = true;
                break;
              }

              fileHasMatch = true;

              // Get context lines
              const ctxLines = contextLines ?? 0;
              const contextBefore: string[] = [];
              const contextAfter: string[] = [];

              for (let j = Math.max(0, i - ctxLines); j < i; j++) {
                contextBefore.push(lines[j] ?? "");
              }

              for (let j = i + 1; j <= Math.min(lines.length - 1, i + ctxLines); j++) {
                contextAfter.push(lines[j] ?? "");
              }

              matches.push({
                file: path.relative(process.cwd(), file),
                line: i + 1,
                column: match.index + 1,
                content: line,
                contextBefore,
                contextAfter,
              });

              // Only find first match per line if not global
              if (!flags.includes("g")) break;
            }

            if (truncated) break;
          }

          if (fileHasMatch) {
            filesWithMatches.add(file);
          }
        } catch {
          // Skip files that can't be read (binary, permissions, etc.)
        }
      }

      return {
        matches,
        totalMatches: matches.length,
        filesSearched,
        filesWithMatches: filesWithMatches.size,
        truncated,
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ToolError(`Invalid regex pattern: ${pattern}`, { tool: "grep" });
      }
      throw new ToolError(
        `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "grep", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Find in file tool (simpler single-file search)
 */
export const findInFileTool: ToolDefinition<
  { file: string; pattern: string; caseSensitive?: boolean },
  { matches: Array<{ line: number; content: string }>; count: number }
> = defineTool({
  name: "find_in_file",
  description: `Search for a pattern in a single file.

Examples:
- Find text: { "file": "src/app.ts", "pattern": "export" }
- Case insensitive: { "file": "README.md", "pattern": "install", "caseSensitive": false }
- Regex: { "file": "package.json", "pattern": '"version":\\s*"[^"]+"' }`,
  category: "file",
  parameters: z.object({
    file: z.string().describe("File path to search"),
    pattern: z.string().describe("Text or regex pattern"),
    caseSensitive: z.boolean().optional().default(true).describe("Case sensitive"),
  }),
  async execute({ file, pattern, caseSensitive }) {
    try {
      const absolutePath = path.resolve(file);
      const content = await fs.readFile(absolutePath, "utf-8");
      const lines = content.split("\n");
      const matches: Array<{ line: number; content: string }> = [];

      const flags = caseSensitive ? "" : "i";
      const regex = new RegExp(pattern, flags);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (regex.test(line)) {
          matches.push({
            line: i + 1,
            content: line,
          });
        }
      }

      return { matches, count: matches.length };
    } catch (error) {
      throw new ToolError(
        `Find in file failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "find_in_file", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * All search tools
 */
export const searchTools = [grepTool, findInFileTool];
