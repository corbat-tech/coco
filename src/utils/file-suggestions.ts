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
