/**
 * Configuration diff utility for Corbat-Coco
 * Compare two configurations and report changes
 */

/**
 * Diff operation type
 */
export type DiffOperation = "added" | "removed" | "changed" | "unchanged";

/**
 * Single diff entry
 */
export interface DiffEntry {
  path: string;
  operation: DiffOperation;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Diff result
 */
export interface DiffResult {
  /** All diff entries */
  entries: DiffEntry[];
  /** Number of additions */
  added: number;
  /** Number of removals */
  removed: number;
  /** Number of changes */
  changed: number;
  /** Whether configs are identical */
  identical: boolean;
  /** Human-readable summary */
  summary: string;
}

/**
 * Options for diff operation
 */
export interface DiffOptions {
  /** Include unchanged entries in result */
  includeUnchanged?: boolean;
  /** Maximum depth to traverse (default: unlimited) */
  maxDepth?: number;
  /** Ignore specific paths (glob patterns) */
  ignorePaths?: string[];
}

/**
 * Check if a value is a plain object
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if path matches any ignore pattern
 */
function shouldIgnore(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob matching: * matches any segment, ** matches any path
    // Escape backslashes first to prevent incomplete sanitization
    const regex = pattern
      .replace(/\\/g, "\\\\")
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "{{GLOBSTAR}}")
      .replace(/\*/g, "[^.]+")
      .replace(/{{GLOBSTAR}}/g, ".*");
    if (new RegExp(`^${regex}$`).test(path)) {
      return true;
    }
  }
  return false;
}

/**
 * Deep compare two values and return diff entries
 */
function deepCompare(
  oldValue: unknown,
  newValue: unknown,
  path: string,
  options: DiffOptions,
  depth: number,
  entries: DiffEntry[],
): void {
  // Check max depth
  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      entries.push({ path, operation: "changed", oldValue, newValue });
    } else if (options.includeUnchanged) {
      entries.push({ path, operation: "unchanged", oldValue, newValue });
    }
    return;
  }

  // Check ignore patterns
  if (options.ignorePaths && shouldIgnore(path, options.ignorePaths)) {
    return;
  }

  // Handle undefined/null
  if (oldValue === undefined && newValue === undefined) {
    if (options.includeUnchanged) {
      entries.push({ path, operation: "unchanged", oldValue, newValue });
    }
    return;
  }

  if (oldValue === undefined) {
    entries.push({ path, operation: "added", newValue });
    return;
  }

  if (newValue === undefined) {
    entries.push({ path, operation: "removed", oldValue });
    return;
  }

  // Both values exist - compare by type
  const oldType = typeof oldValue;
  const newType = typeof newValue;

  // Type mismatch
  if (oldType !== newType) {
    entries.push({ path, operation: "changed", oldValue, newValue });
    return;
  }

  // Arrays
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const maxLen = Math.max(oldValue.length, newValue.length);
    let arrayChanged = false;

    for (let i = 0; i < maxLen; i++) {
      const itemPath = `${path}[${i}]`;
      const oldItem = oldValue[i];
      const newItem = newValue[i];

      if (oldItem === undefined && newItem !== undefined) {
        entries.push({ path: itemPath, operation: "added", newValue: newItem });
        arrayChanged = true;
      } else if (oldItem !== undefined && newItem === undefined) {
        entries.push({ path: itemPath, operation: "removed", oldValue: oldItem });
        arrayChanged = true;
      } else if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
        deepCompare(oldItem, newItem, itemPath, options, depth + 1, entries);
        arrayChanged = true;
      } else if (options.includeUnchanged) {
        entries.push({
          path: itemPath,
          operation: "unchanged",
          oldValue: oldItem,
          newValue: newItem,
        });
      }
    }

    if (!arrayChanged && options.includeUnchanged) {
      entries.push({ path, operation: "unchanged", oldValue, newValue });
    }
    return;
  }

  // Objects
  if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    const allKeys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);

    for (const key of allKeys) {
      const keyPath = path ? `${path}.${key}` : key;
      deepCompare(oldValue[key], newValue[key], keyPath, options, depth + 1, entries);
    }
    return;
  }

  // Primitives
  if (oldValue === newValue) {
    if (options.includeUnchanged) {
      entries.push({ path, operation: "unchanged", oldValue, newValue });
    }
  } else {
    entries.push({ path, operation: "changed", oldValue, newValue });
  }
}

/**
 * Compare two configurations and return a diff result
 *
 * @example
 * const diff = diffConfigs(
 *   { provider: { model: "claude-3" }, quality: { minScore: 80 } },
 *   { provider: { model: "claude-4" }, quality: { minScore: 85 } }
 * );
 * // diff.entries = [
 * //   { path: "provider.model", operation: "changed", oldValue: "claude-3", newValue: "claude-4" },
 * //   { path: "quality.minScore", operation: "changed", oldValue: 80, newValue: 85 }
 * // ]
 */
export function diffConfigs(
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>,
  options: DiffOptions = {},
): DiffResult {
  const entries: DiffEntry[] = [];

  // Perform deep comparison
  deepCompare(oldConfig, newConfig, "", options, 0, entries);

  // Calculate stats
  const added = entries.filter((e) => e.operation === "added").length;
  const removed = entries.filter((e) => e.operation === "removed").length;
  const changed = entries.filter((e) => e.operation === "changed").length;
  const identical = added === 0 && removed === 0 && changed === 0;

  // Generate summary
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  if (changed > 0) parts.push(`${changed} changed`);

  const summary = identical
    ? "Configurations are identical"
    : `Configuration changes: ${parts.join(", ")}`;

  return {
    entries,
    added,
    removed,
    changed,
    identical,
    summary,
  };
}

/**
 * Format diff result as a human-readable string
 *
 * @example
 * const formatted = formatDiff(diffResult);
 * // Output:
 * // + provider.timeout: 30000
 * // - quality.maxIterations: 10
 * // ~ provider.model: "claude-3" → "claude-4"
 */
export function formatDiff(result: DiffResult, colorize: boolean = false): string {
  if (result.identical) {
    return "No changes";
  }

  const lines: string[] = [];

  for (const entry of result.entries) {
    if (entry.operation === "unchanged") continue;

    const formatValue = (v: unknown): string => {
      if (typeof v === "string") return `"${v}"`;
      if (v === undefined) return "undefined";
      if (v === null) return "null";
      return JSON.stringify(v);
    };

    let prefix: string;
    let line: string;

    switch (entry.operation) {
      case "added":
        prefix = colorize ? "\x1b[32m+\x1b[0m" : "+";
        line = `${prefix} ${entry.path}: ${formatValue(entry.newValue)}`;
        break;
      case "removed":
        prefix = colorize ? "\x1b[31m-\x1b[0m" : "-";
        line = `${prefix} ${entry.path}: ${formatValue(entry.oldValue)}`;
        break;
      case "changed":
        prefix = colorize ? "\x1b[33m~\x1b[0m" : "~";
        line = `${prefix} ${entry.path}: ${formatValue(entry.oldValue)} → ${formatValue(entry.newValue)}`;
        break;
      default:
        continue;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Check if configuration has breaking changes
 * Breaking changes are removals or type changes to required fields
 */
export function hasBreakingChanges(
  result: DiffResult,
  requiredPaths: string[] = [],
): { breaking: boolean; paths: string[] } {
  const breakingPaths: string[] = [];

  for (const entry of result.entries) {
    // Removals of required paths are breaking
    if (entry.operation === "removed") {
      const isRequired = requiredPaths.some(
        (rp) => entry.path === rp || entry.path.startsWith(`${rp}.`),
      );
      if (isRequired) {
        breakingPaths.push(entry.path);
      }
    }

    // Type changes to required paths are breaking
    if (entry.operation === "changed") {
      const oldType = typeof entry.oldValue;
      const newType = typeof entry.newValue;
      if (oldType !== newType) {
        const isRequired = requiredPaths.some(
          (rp) => entry.path === rp || entry.path.startsWith(`${rp}.`),
        );
        if (isRequired) {
          breakingPaths.push(entry.path);
        }
      }
    }
  }

  return {
    breaking: breakingPaths.length > 0,
    paths: breakingPaths,
  };
}
