/**
 * Memory System Types for Corbat-Coco
 *
 * This module defines the type system for the hierarchical memory system,
 * mirroring Claude Code's CLAUDE.md memory hierarchy.
 *
 * Memory is loaded from three levels:
 * - User level: Global configuration (~/.config/corbat-coco/COCO.md)
 * - Project level: Repository-specific (./COCO.md or ./CLAUDE.md, committed)
 * - Local level: Personal overrides (./COCO.local.md, not committed)
 *
 * @module memory/types
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Default file patterns to search for memory files.
 * Files are checked in order; the first match is used.
 */
export const DEFAULT_FILE_PATTERNS = ["COCO.md", "CLAUDE.md"] as const;

/**
 * Suffix for local override files that should not be committed.
 * Example: COCO.md -> COCO.local.md
 */
export const LOCAL_SUFFIX = ".local.md";

/**
 * Regular expression pattern for parsing import directives.
 * Matches @path/to/file syntax for importing external content.
 *
 * @example
 * // Matches:
 * // @./docs/conventions.md
 * // @../shared/rules.md
 * // @/absolute/path.md
 */
export const IMPORT_PATTERN = /@([^\s]+)/g;

/**
 * Default configuration values for the memory system.
 */
export const MEMORY_DEFAULTS = {
  /** Maximum depth for resolving nested imports */
  maxImportDepth: 5,
  /** Maximum total content size in characters */
  maxTotalSize: 100_000,
  /** Whether to include user-level memory by default */
  includeUserLevel: true,
} as const;

// ============================================================================
// Memory Source Levels
// ============================================================================

/**
 * Memory source level indicating where a memory file originates.
 *
 * The levels form a hierarchy with increasing specificity:
 * - `user`: Global user preferences (~/.config/corbat-coco/COCO.md)
 * - `project`: Project-specific instructions (./COCO.md, committed to repo)
 * - `local`: Personal overrides (./COCO.local.md, gitignored)
 *
 * Higher specificity levels override lower ones when conflicts occur.
 */
export type MemoryLevel = "user" | "project" | "local";

/**
 * Array of all memory levels in order of precedence (lowest to highest).
 * Used for iterating through levels in the correct order.
 */
export const MEMORY_LEVELS: readonly MemoryLevel[] = [
  "user",
  "project",
  "local",
] as const;

// ============================================================================
// Memory Section
// ============================================================================

/**
 * Represents a parsed section within a memory file.
 *
 * Sections are delimited by markdown headings (## heading).
 * Each section contains instructions or configuration for a specific topic.
 *
 * @example
 * ```typescript
 * const section: MemorySection = {
 *   title: "Code Style",
 *   content: "- Use 2-space indentation\n- Prefer const over let",
 *   startLine: 10,
 *   endLine: 15
 * };
 * ```
 */
export interface MemorySection {
  /**
   * Section title extracted from the heading.
   * The leading ## and any trailing whitespace are stripped.
   */
  title: string;

  /**
   * Raw markdown content of the section, excluding the heading line.
   * Preserves original formatting including code blocks and lists.
   */
  content: string;

  /**
   * 1-based line number where the section heading appears.
   */
  startLine: number;

  /**
   * 1-based line number of the last line of the section content.
   * This is the line before the next heading or end of file.
   */
  endLine: number;
}

// ============================================================================
// Memory Import
// ============================================================================

/**
 * Represents an import directive that references external content.
 *
 * Imports use the @path/to/file syntax to include content from other files.
 * This allows modularizing memory across multiple files.
 *
 * @example
 * ```typescript
 * const memoryImport: MemoryImport = {
 *   originalPath: "@./docs/style-guide.md",
 *   resolvedPath: "/project/docs/style-guide.md",
 *   resolved: true,
 *   line: 5,
 *   content: "# Style Guide\n..."
 * };
 * ```
 */
export interface MemoryImport {
  /**
   * Original import path as written in the memory file.
   * Includes the @ prefix.
   *
   * @example "@./docs/conventions.md"
   */
  originalPath: string;

  /**
   * Fully resolved absolute path to the imported file.
   * Resolved relative to the containing memory file's directory.
   */
  resolvedPath: string;

  /**
   * Whether the import was successfully resolved and loaded.
   * False if the file doesn't exist or couldn't be read.
   */
  resolved: boolean;

  /**
   * 1-based line number where the import directive appears.
   */
  line: number;

  /**
   * Content of the imported file, if successfully resolved.
   * Undefined if the import failed.
   */
  content?: string;

  /**
   * Error message if the import failed to resolve.
   * Provides details about why the import couldn't be loaded.
   */
  error?: string;
}

// ============================================================================
// Memory File
// ============================================================================

/**
 * Represents a single memory file with its parsed content.
 *
 * Memory files are markdown documents containing instructions, preferences,
 * and configuration for the AI assistant. They can include sections
 * organized by headings and import other files.
 *
 * @example
 * ```typescript
 * const memoryFile: MemoryFile = {
 *   path: "/project/COCO.md",
 *   level: "project",
 *   content: "# Project Memory\n\n## Code Style\n...",
 *   sections: [...],
 *   imports: [...],
 *   modifiedAt: new Date("2024-01-15"),
 *   exists: true
 * };
 * ```
 */
export interface MemoryFile {
  /**
   * Absolute path to the memory file on the filesystem.
   */
  path: string;

  /**
   * Source level indicating the origin of this memory file.
   * Determines precedence when merging multiple memory sources.
   */
  level: MemoryLevel;

  /**
   * Processed content of the memory file (after import resolution).
   * Empty string if the file doesn't exist.
   */
  content: string;

  /**
   * Parsed sections extracted from the file content.
   * Each section corresponds to a ## heading and its content.
   */
  sections: MemorySection[];

  /**
   * Import directives found in the file and their resolution status.
   * Includes both successful and failed imports.
   */
  imports: MemoryImport[];

  /**
   * Timestamp when the file was last modified.
   * Used for cache invalidation and change detection.
   */
  modifiedAt: Date;

  /**
   * Whether the memory file exists on disk.
   * False for expected but missing memory files.
   */
  exists: boolean;
}

// ============================================================================
// Memory Error
// ============================================================================

/**
 * Represents an error that occurred while loading or parsing memory.
 *
 * Errors can be recoverable (warnings) or fatal (blocking).
 * Recoverable errors allow the system to continue with partial memory.
 *
 * @example
 * ```typescript
 * const error: MemoryError = {
 *   file: "/project/COCO.md",
 *   level: "project",
 *   error: "Circular import detected: ./a.md -> ./b.md -> ./a.md",
 *   recoverable: true
 * };
 * ```
 */
export interface MemoryError {
  /**
   * Path to the file where the error occurred.
   * May be the memory file itself or an imported file.
   */
  file: string;

  /**
   * Memory level of the file that caused the error.
   */
  level: MemoryLevel;

  /**
   * Human-readable description of the error.
   */
  error: string;

  /**
   * Whether the system can continue despite this error.
   *
   * - `true`: Warning - the system can proceed with partial memory
   * - `false`: Fatal - the memory loading process should abort
   */
  recoverable: boolean;
}

// ============================================================================
// Memory Context
// ============================================================================

/**
 * Combined memory context for a session, aggregating all memory sources.
 *
 * This is the primary interface used by the REPL and other components
 * to access the merged memory from all levels.
 *
 * @example
 * ```typescript
 * const context: MemoryContext = {
 *   files: [userMemory, projectMemory, localMemory],
 *   combinedContent: "# User Memory\n...\n# Project Memory\n...",
 *   totalSize: 15420,
 *   errors: []
 * };
 * ```
 */
export interface MemoryContext {
  /**
   * All loaded memory files, in order of precedence.
   * Includes files that don't exist (with exists: false).
   */
  files: MemoryFile[];

  /**
   * Combined content from all memory files, ready for use in prompts.
   *
   * The content is merged with clear delimiters between sources.
   * Later sources (higher precedence) appear after earlier ones.
   */
  combinedContent: string;

  /**
   * Total size of the combined content in characters.
   * Used for enforcing size limits and estimating token usage.
   */
  totalSize: number;

  /**
   * All errors encountered during memory loading.
   * Includes both recoverable warnings and fatal errors.
   */
  errors: MemoryError[];
}

// ============================================================================
// Memory Configuration
// ============================================================================

/**
 * Configuration options for the memory system.
 *
 * Controls how memory files are discovered, loaded, and processed.
 *
 * @example
 * ```typescript
 * const config: MemoryConfig = {
 *   maxImportDepth: 3,
 *   maxTotalSize: 50_000,
 *   filePatterns: ["COCO.md"],
 *   includeUserLevel: true
 * };
 * ```
 */
export interface MemoryConfig {
  /**
   * Maximum depth for resolving nested imports.
   *
   * Prevents infinite loops from circular imports and limits
   * the complexity of import chains.
   *
   * @default 5
   */
  maxImportDepth: number;

  /**
   * Maximum total content size in characters.
   *
   * Limits the combined size of all memory content to prevent
   * excessive context window usage.
   *
   * @default 100000
   */
  maxTotalSize: number;

  /**
   * File patterns to search for when loading memory.
   *
   * Patterns are checked in order; the first existing file is used.
   * Supports both COCO.md (Corbat-Coco) and CLAUDE.md (Claude Code) formats.
   *
   * @default ["COCO.md", "CLAUDE.md"]
   */
  filePatterns: string[];

  /**
   * Whether to include user-level memory from ~/.config/corbat-coco/.
   *
   * Set to false to disable global user preferences, using only
   * project and local memory.
   *
   * @default true
   */
  includeUserLevel: boolean;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a default MemoryConfig with standard settings.
 *
 * @param overrides - Partial config to merge with defaults
 * @returns Complete MemoryConfig with all fields populated
 *
 * @example
 * ```typescript
 * const config = createDefaultMemoryConfig({ maxImportDepth: 3 });
 * // { maxImportDepth: 3, maxTotalSize: 100000, ... }
 * ```
 */
export function createDefaultMemoryConfig(
  overrides?: Partial<MemoryConfig>
): MemoryConfig {
  return {
    maxImportDepth: MEMORY_DEFAULTS.maxImportDepth,
    maxTotalSize: MEMORY_DEFAULTS.maxTotalSize,
    filePatterns: [...DEFAULT_FILE_PATTERNS],
    includeUserLevel: MEMORY_DEFAULTS.includeUserLevel,
    ...overrides,
  };
}

/**
 * Creates an empty MemoryContext for initialization.
 *
 * @returns Empty MemoryContext with no files loaded
 *
 * @example
 * ```typescript
 * const context = createEmptyMemoryContext();
 * // { files: [], combinedContent: "", totalSize: 0, errors: [] }
 * ```
 */
export function createEmptyMemoryContext(): MemoryContext {
  return {
    files: [],
    combinedContent: "",
    totalSize: 0,
    errors: [],
  };
}

/**
 * Creates an empty MemoryFile placeholder for a non-existent file.
 *
 * @param path - Absolute path where the file would be located
 * @param level - Memory level for this file
 * @returns MemoryFile with exists: false
 *
 * @example
 * ```typescript
 * const missing = createMissingMemoryFile("/project/COCO.md", "project");
 * // { path: "/project/COCO.md", level: "project", exists: false, ... }
 * ```
 */
export function createMissingMemoryFile(
  path: string,
  level: MemoryLevel
): MemoryFile {
  return {
    path,
    level,
    content: "",
    sections: [],
    imports: [],
    modifiedAt: new Date(0),
    exists: false,
  };
}

/**
 * Creates a MemorySection with the required properties.
 *
 * @param title - Section title/heading
 * @param content - Section content
 * @param startLine - Starting line number
 * @param endLine - Ending line number
 * @returns MemorySection with all properties set
 *
 * @example
 * ```typescript
 * const section = createMemorySection("Code Style", "- Use tabs", 1, 5);
 * ```
 */
export function createMemorySection(
  title: string,
  content: string,
  startLine: number,
  endLine: number
): MemorySection {
  return {
    title,
    content,
    startLine,
    endLine,
  };
}
