/**
 * File suggestion utilities for error recovery.
 *
 * When a file path doesn't exist (ENOENT), these utilities suggest
 * similar files that the user may have meant.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { levenshtein } from "../skills/matcher.js";

/**
 * A suggested file with its similarity score.
 */
export interface FileSuggestion {
  /** Absolute path to the suggested file */
  path: string;
  /** Levenshtein distance from the missing basename (lower = more similar) */
  distance: number;
}

/** Maximum directory entries to scan */
const MAX_DIR_ENTRIES = 200;

/** Maximum suggestions to return */
const MAX_SUGGESTIONS = 5;

/** Default excluded directories for deep search */
const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".idea",
  ".vscode",
  ".DS_Store",
]);

/** Default options for findFileRecursive */
const DEFAULT_FIND_OPTIONS: Required<FindFileOptions> = {
  maxDepth: 8,
  timeoutMs: 3000,
  includeHidden: true,
  excludeDirs: DEFAULT_EXCLUDE_DIRS,
  maxResults: 5,
  type: "file",
};

/**
 * Options for findFileRecursive
 */
export interface FindFileOptions {
  /** Maximum depth to search (default: 8) */
  maxDepth?: number;
  /** Timeout in milliseconds (default: 3000) */
  timeoutMs?: number;
  /** Include hidden directories (default: true) */
  includeHidden?: boolean;
  /** Set of directory names to exclude (default: common build/vendor dirs) */
  excludeDirs?: Set<string>;
  /** Maximum results to return (default: 5) */
  maxResults?: number;
  /** Type of entries to find (default: "file") */
  type?: "file" | "directory" | "both";
}

/**
 * Recursively find files/directories matching a target name.
 *
 * Uses BFS for shallow-first discovery. Stops early when maxResults found.
 * Respects timeout and depth limits. Handles permission errors gracefully.
 *
 * @param rootDir - Directory to start searching from
 * @param target - Target basename to find
 * @param options - Search options
 * @returns Array of matching paths with similarity scores
 */
export async function findFileRecursive(
  rootDir: string,
  target: string,
  options: FindFileOptions = {},
): Promise<FileSuggestion[]> {
  const opts = { ...DEFAULT_FIND_OPTIONS, ...options };
  const targetLower = target.toLowerCase();
  const results: FileSuggestion[] = [];
  const startTime = Date.now();

  // Check timeout
  const isTimedOut = () => Date.now() - startTime > opts.timeoutMs;

  // BFS queue: [dirPath, depth]
  const queue: [string, number][] = [[path.resolve(rootDir), 0]];
  const visited = new Set<string>();

  while (queue.length > 0 && results.length < opts.maxResults) {
    if (isTimedOut()) break;

    const [currentDir, depth] = queue.shift()!;

    if (visited.has(currentDir)) continue;
    visited.add(currentDir);

    if (depth > opts.maxDepth) continue;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (isTimedOut()) break;

        const entryName = entry.name;
        const entryPath = path.join(currentDir, entryName);

        // Skip hidden entries unless includeHidden is true
        if (!opts.includeHidden && entryName.startsWith(".")) continue;

        // Skip excluded directories
        if (entry.isDirectory() && opts.excludeDirs.has(entryName)) continue;

        // Check if this entry matches
        const isMatch =
          (opts.type === "file" && entry.isFile()) ||
          (opts.type === "directory" && entry.isDirectory()) ||
          opts.type === "both";

        if (isMatch) {
          const entryNameLower = entryName.toLowerCase();
          let distance: number;

          // Exact case-insensitive match gets distance 0
          if (entryNameLower === targetLower) {
            distance = 0;
          } else {
            // Fuzzy match using Levenshtein
            distance = levenshtein(targetLower, entryNameLower);
          }

          // Only include if reasonably similar
          const maxDistance = Math.max(target.length * 0.6, 3);
          if (distance <= maxDistance) {
            results.push({ path: entryPath, distance });
          }
        }

        // Queue subdirectories for BFS
        if (entry.isDirectory() && !opts.excludeDirs.has(entryName)) {
          queue.push([entryPath, depth + 1]);
        }
      }
    } catch {
      // ENOENT/EACCES on a directory - skip and continue
      continue;
    }
  }

  // Sort by distance (best matches first) and limit results
  return results
    .sort((a, b) => a.distance - b.distance)
    .slice(0, opts.maxResults);
}

/**
 * Suggest similar files with deep search fallback.
 *
 * Strategy:
 * 1. Fast path: Check parent directory (immediate feedback)
 * 2. Fallback: Deep recursive search from root
 *
 * @param missingPath - The path that doesn't exist
 * @param rootDir - Root directory for deep search (default: process.cwd())
 * @param options - Options for deep search
 * @returns Array of file suggestions
 */
export async function suggestSimilarFilesDeep(
  missingPath: string,
  rootDir: string = process.cwd(),
  options?: FindFileOptions,
): Promise<FileSuggestion[]> {
  // Fast path: parent directory scan
  const fastResults = await suggestSimilarFiles(missingPath, {
    maxResults: options?.maxResults ?? MAX_SUGGESTIONS,
  });

  if (fastResults.length > 0) {
    return fastResults;
  }

  // Fallback: deep recursive search
  const absPath = path.resolve(missingPath);
  const target = path.basename(absPath);

  return findFileRecursive(rootDir, target, options);
}

/**
 * Suggest similar directories with deep search fallback.
 *
 * @param missingPath - The directory path that doesn't exist
 * @param rootDir - Root directory for deep search (default: process.cwd())
 * @param options - Options for deep search
 * @returns Array of directory suggestions
 */
export async function suggestSimilarDirsDeep(
  missingPath: string,
  rootDir: string = process.cwd(),
  options?: FindFileOptions,
): Promise<FileSuggestion[]> {
  const absPath = path.resolve(missingPath);
  const target = path.basename(absPath);

  // Try parent directory first
  const parentDir = path.dirname(absPath);
  try {
    const entries = await fs.readdir(parentDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    const scored: FileSuggestion[] = dirs
      .map((d) => ({
        path: path.join(parentDir, d.name),
        distance: levenshtein(target.toLowerCase(), d.name.toLowerCase()),
      }))
      .filter((s) => s.distance <= Math.max(target.length * 0.6, 3))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, options?.maxResults ?? MAX_SUGGESTIONS);

    if (scored.length > 0) {
      return scored;
    }
  } catch {
    // Parent doesn't exist, continue to deep search
  }

  // Fallback: deep recursive search for directories
  return findFileRecursive(rootDir, target, { ...options, type: "directory" });
}

/**
 * Suggest similar files when a path doesn't exist.
 *
 * Strategy:
 * 1. List the parent directory of the missing path
 * 2. Rank entries by Levenshtein distance against the missing basename
 * 3. Return the top matches
 */
export async function suggestSimilarFiles(
  missingPath: string,
  options?: { maxResults?: number },
): Promise<FileSuggestion[]> {
  const absPath = path.resolve(missingPath);
  const dir = path.dirname(absPath);
  const target = path.basename(absPath);
  const maxResults = options?.maxResults ?? MAX_SUGGESTIONS;

  try {
    const entries = await fs.readdir(dir);
    const limited = entries.slice(0, MAX_DIR_ENTRIES);

    const scored: FileSuggestion[] = limited
      .map((name) => ({
        path: path.join(dir, name),
        distance: levenshtein(target.toLowerCase(), name.toLowerCase()),
      }))
      .filter((s) => s.distance <= Math.max(target.length * 0.6, 3))
      .sort((a, b) => a.distance - b.distance);

    return scored.slice(0, maxResults);
  } catch {
    // Parent directory doesn't exist — nothing to suggest at this level
    return [];
  }
}

/**
 * Suggest similar paths, searching also by directory segments.
 * Falls back to basename-only search via suggestSimilarFiles.
 */
export async function suggestSimilarPaths(
  missingPath: string,
  options?: { maxResults?: number },
): Promise<FileSuggestion[]> {
  // First try the direct parent approach
  const fileSuggestions = await suggestSimilarFiles(missingPath, options);
  if (fileSuggestions.length > 0) return fileSuggestions;

  // If parent directory doesn't exist, try grandparent
  const absPath = path.resolve(missingPath);
  const grandparent = path.dirname(path.dirname(absPath));
  const parentBasename = path.basename(path.dirname(absPath));
  const maxResults = options?.maxResults ?? MAX_SUGGESTIONS;

  try {
    const entries = await fs.readdir(grandparent, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).slice(0, MAX_DIR_ENTRIES);

    const scored: FileSuggestion[] = dirs
      .map((d) => ({
        path: path.join(grandparent, d.name),
        distance: levenshtein(parentBasename.toLowerCase(), d.name.toLowerCase()),
      }))
      .filter((s) => s.distance <= Math.max(parentBasename.length * 0.6, 3))
      .sort((a, b) => a.distance - b.distance);

    return scored.slice(0, maxResults);
  } catch {
    return [];
  }
}

/**
 * Format suggestions into a human-readable string for error messages.
 *
 * @param suggestions - The file suggestions to format
 * @param baseDir - Base directory for computing relative paths
 * @returns Formatted string, empty if no suggestions
 */
export function formatSuggestions(suggestions: FileSuggestion[], baseDir?: string): string {
  if (suggestions.length === 0) return "";

  const base = baseDir ?? process.cwd();
  const lines = suggestions.map((s) => {
    const rel = path.relative(base, s.path);
    return `  - ${rel}`;
  });

  return `\nDid you mean?\n${lines.join("\n")}`;
}
