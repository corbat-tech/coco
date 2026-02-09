/**
 * Memory Loader
 *
 * Loads and parses memory files (COCO.md, CLAUDE.md) from the filesystem.
 * Supports hierarchical loading with import resolution.
 *
 * @module memory/loader
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import type {
  MemoryConfig,
  MemoryContext,
  MemoryError,
  MemoryFile,
  MemoryImport,
  MemoryLevel,
  MemorySection,
} from "./types.js";
import {
  createDefaultMemoryConfig,
  createMissingMemoryFile,
  LOCAL_SUFFIX,
  MEMORY_LEVELS,
} from "./types.js";
import { CONFIG_PATHS } from "../../../config/paths.js";

/**
 * Regular expression to match section headings: ## Heading
 */
const SECTION_HEADING_REGEX = /^## (.+)$/;

/**
 * User config directory for global memory files (~/.coco/)
 */
const USER_CONFIG_DIR = CONFIG_PATHS.home;

/**
 * Result of finding memory files at each level
 */
export interface MemoryFilePaths {
  /** User level file path (if found) */
  user?: string;
  /** Project level file path (if found) */
  project?: string;
  /** Local level file path (if found) */
  local?: string;
}

/**
 * Result of import resolution
 */
export interface ImportResolutionResult {
  /** Processed content with imports inlined */
  content: string;
  /** All imports that were found */
  imports: MemoryImport[];
}

/**
 * Memory loader for loading and parsing memory files.
 *
 * Loads memory from three levels in order:
 * 1. User level: ~/.coco/COCO.md
 * 2. Project level: ./COCO.md or ./CLAUDE.md
 * 3. Local level: ./COCO.local.md or ./CLAUDE.local.md
 *
 * Later levels override earlier ones.
 *
 * @example
 * ```typescript
 * const loader = new MemoryLoader();
 * const context = await loader.loadMemory("/path/to/project");
 * console.log(context.combinedContent);
 * ```
 */
export class MemoryLoader {
  private config: MemoryConfig;

  /**
   * Create a new MemoryLoader
   * @param config - Partial configuration to override defaults
   */
  constructor(config?: Partial<MemoryConfig>) {
    this.config = createDefaultMemoryConfig(config);
  }

  /**
   * Load all memory for a project
   * @param projectPath - Path to the project directory
   * @returns Combined memory context from all levels
   */
  async loadMemory(projectPath: string): Promise<MemoryContext> {
    const errors: MemoryError[] = [];
    const files: MemoryFile[] = [];

    // Find memory files at each level
    const filePaths = await this.findMemoryFiles(projectPath);

    // Load files in order: user -> project -> local
    for (const level of MEMORY_LEVELS) {
      // Skip user level if disabled
      if (level === "user" && !this.config.includeUserLevel) {
        continue;
      }

      const filePath = filePaths[level];
      if (filePath) {
        try {
          const memoryFile = await this.loadFile(filePath, level);
          files.push(memoryFile);

          // Add errors for failed imports
          for (const imp of memoryFile.imports) {
            if (!imp.resolved && imp.error) {
              errors.push({
                file: filePath,
                level,
                error: `Import failed: ${imp.originalPath} - ${imp.error}`,
                recoverable: true,
              });
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({
            file: filePath,
            level,
            error: `Failed to load memory file: ${message}`,
            recoverable: true,
          });
        }
      }
    }

    // Combine all memory
    const combinedContent = this.combineMemory(files);
    const totalSize = combinedContent.length;

    // Check size limit
    if (totalSize > this.config.maxTotalSize) {
      errors.push({
        file: "",
        level: "project",
        error: `Combined memory size (${totalSize}) exceeds limit (${this.config.maxTotalSize})`,
        recoverable: true,
      });
    }

    return {
      files,
      combinedContent,
      totalSize,
      errors,
    };
  }

  /**
   * Load a single memory file
   * @param filePath - Absolute path to the file
   * @param level - Memory level (user, project, local)
   * @returns Loaded memory file
   */
  async loadFile(filePath: string, level: MemoryLevel): Promise<MemoryFile> {
    const resolvedPath = this.resolvePath(filePath);

    try {
      const stat = await fs.stat(resolvedPath);
      const rawContent = await fs.readFile(resolvedPath, "utf-8");

      // Resolve imports
      const { content, imports } = await this.resolveImports(
        rawContent,
        path.dirname(resolvedPath),
        0,
      );

      // Parse sections
      const sections = this.parseSections(content);

      return {
        path: resolvedPath,
        level,
        content,
        sections,
        imports,
        modifiedAt: stat.mtime,
        exists: true,
      };
    } catch {
      // File doesn't exist or can't be read
      return createMissingMemoryFile(resolvedPath, level);
    }
  }

  /**
   * Find memory files for a project
   * @param projectPath - Path to the project directory
   * @returns Paths to found memory files at each level
   */
  async findMemoryFiles(projectPath: string): Promise<MemoryFilePaths> {
    const result: MemoryFilePaths = {};

    // User level: ~/.coco/COCO.md
    if (this.config.includeUserLevel) {
      const userDir = this.resolvePath(USER_CONFIG_DIR);
      for (const pattern of this.config.filePatterns) {
        const userPath = path.join(userDir, pattern);
        if (await this.fileExists(userPath)) {
          result.user = userPath;
          break;
        }
      }
    }

    // Project level: ./COCO.md or ./CLAUDE.md
    const absoluteProjectPath = path.resolve(projectPath);
    for (const pattern of this.config.filePatterns) {
      const projectFilePath = path.join(absoluteProjectPath, pattern);
      if (await this.fileExists(projectFilePath)) {
        result.project = projectFilePath;
        break;
      }
    }

    // Local level: ./COCO.local.md or ./CLAUDE.local.md
    for (const pattern of this.config.filePatterns) {
      // Convert COCO.md to COCO.local.md
      const baseName = pattern.replace(/\.md$/, "");
      const localFileName = `${baseName}${LOCAL_SUFFIX}`;
      const localPath = path.join(absoluteProjectPath, localFileName);
      if (await this.fileExists(localPath)) {
        result.local = localPath;
        break;
      }
    }

    return result;
  }

  /**
   * Resolve import paths in content
   * @param content - Content with potential @path imports
   * @param basePath - Base directory for resolving relative paths
   * @param depth - Current recursion depth
   * @returns Processed content with imports inlined
   */
  async resolveImports(
    content: string,
    basePath: string,
    depth: number,
  ): Promise<ImportResolutionResult> {
    const imports: MemoryImport[] = [];

    // Check max depth
    if (depth >= this.config.maxImportDepth) {
      return { content, imports };
    }

    // Track lines for line number reporting
    const lines = content.split("\n");
    const processedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const lineNumber = i + 1;

      // Check if line is an import (starts with @ and has a path)
      const importMatch = line.match(/^@([^\s]+)\s*$/);

      if (importMatch && importMatch[1]) {
        const importPath = importMatch[1];
        const resolvedPath = this.resolveImportPath(importPath, basePath);

        const memoryImport: MemoryImport = {
          originalPath: `@${importPath}`,
          resolvedPath,
          line: lineNumber,
          resolved: false,
        };

        try {
          // Check for file existence
          if (await this.fileExists(resolvedPath)) {
            const importedContent = await fs.readFile(resolvedPath, "utf-8");

            // Recursively resolve imports in the imported content
            const nestedResult = await this.resolveImports(
              importedContent,
              path.dirname(resolvedPath),
              depth + 1,
            );

            // Add the imported content (with a comment showing the source)
            processedLines.push(`<!-- Imported from: ${importPath} -->`);
            processedLines.push(nestedResult.content);
            processedLines.push(`<!-- End import: ${importPath} -->`);

            memoryImport.resolved = true;
            memoryImport.content = nestedResult.content;
            imports.push(memoryImport, ...nestedResult.imports);
          } else {
            // File not found
            memoryImport.error = `File not found: ${resolvedPath}`;
            imports.push(memoryImport);

            // Keep the original import line as a comment
            processedLines.push(`<!-- Import not found: ${importPath} -->`);
          }
        } catch (error) {
          // Error reading file
          const errorMessage = error instanceof Error ? error.message : String(error);
          memoryImport.error = errorMessage;
          imports.push(memoryImport);

          processedLines.push(`<!-- Import error (${importPath}): ${errorMessage} -->`);
        }
      } else {
        // Regular line, keep as-is
        processedLines.push(line);
      }
    }

    return {
      content: processedLines.join("\n"),
      imports,
    };
  }

  /**
   * Combine all memory files into a single context string
   * @param files - Array of loaded memory files
   * @returns Combined content
   */
  combineMemory(files: MemoryFile[]): string {
    if (files.length === 0) {
      return "";
    }

    const parts: string[] = [];

    for (const file of files) {
      if (file.exists && file.content.trim()) {
        // Add a separator comment indicating the source
        parts.push(`<!-- Memory: ${file.level} level (${path.basename(file.path)}) -->`);
        parts.push(file.content);
        parts.push("");
      }
    }

    return parts.join("\n").trim();
  }

  /**
   * Parse sections from content
   * @param content - Content to parse
   * @returns Array of parsed sections
   */
  parseSections(content: string): MemorySection[] {
    const sections: MemorySection[] = [];
    const lines = content.split("\n");

    let currentSection: MemorySection | null = null;
    let contentLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const lineNumber = i + 1;

      const headingMatch = line.match(SECTION_HEADING_REGEX);

      if (headingMatch && headingMatch[1]) {
        // Save previous section if exists
        if (currentSection) {
          currentSection.content = contentLines.join("\n").trim();
          currentSection.endLine = lineNumber - 1;
          sections.push(currentSection);
        }

        // Start new section
        currentSection = {
          title: headingMatch[1],
          content: "",
          startLine: lineNumber,
          endLine: lineNumber,
        };
        contentLines = [];
      } else if (currentSection) {
        // Add line to current section
        contentLines.push(line);
      } else {
        // Content before first section - create an implicit section
        if (line.trim()) {
          currentSection = {
            title: "",
            content: "",
            startLine: 1,
            endLine: 1,
          };
          contentLines.push(line);
        }
      }
    }

    // Save last section
    if (currentSection) {
      currentSection.content = contentLines.join("\n").trim();
      currentSection.endLine = lines.length;
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * Resolve a path that may start with ~
   * @param filePath - Path to resolve
   * @returns Resolved absolute path
   */
  private resolvePath(filePath: string): string {
    if (filePath.startsWith("~")) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return path.resolve(filePath);
  }

  /**
   * Resolve an import path relative to a base directory
   * @param importPath - The import path (without @)
   * @param basePath - Base directory for relative paths
   * @returns Resolved absolute path
   */
  private resolveImportPath(importPath: string, basePath: string): string {
    // Handle home directory
    if (importPath.startsWith("~")) {
      return path.join(os.homedir(), importPath.slice(1));
    }

    // Handle absolute paths
    if (path.isAbsolute(importPath)) {
      return importPath;
    }

    // Relative path
    return path.resolve(basePath, importPath);
  }

  /**
   * Check if a file exists
   * @param filePath - Path to check
   * @returns True if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a memory loader with optional configuration
 * @param config - Partial configuration to override defaults
 * @returns MemoryLoader instance
 *
 * @example
 * ```typescript
 * const loader = createMemoryLoader({ maxImportDepth: 3 });
 * const context = await loader.loadMemory("/path/to/project");
 * ```
 */
export function createMemoryLoader(config?: Partial<MemoryConfig>): MemoryLoader {
  return new MemoryLoader(config);
}
