/**
 * File tools for Corbat-Coco
 * Read, write, edit, and search files
 */

import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { defineTool, type ToolDefinition } from "./registry.js";
import { FileSystemError, ToolError } from "../utils/errors.js";
import { isWithinAllowedPath } from "./allowed-paths.js";
import {
  suggestSimilarFilesDeep,
  suggestSimilarDirsDeep,
  formatSuggestions,
} from "../utils/file-suggestions.js";
import { levenshtein } from "../skills/matcher.js";

/**
 * Sensitive file patterns that should be protected
 */
const SENSITIVE_PATTERNS = [
  /\.env(?:\.\w+)?$/, // .env, .env.local, etc.
  /credentials\.\w+$/i, // credentials.json, etc.
  /secrets?\.\w+$/i, // secret.json, secrets.yaml
  /\.pem$/, // Private keys
  /\.key$/, // Private keys
  /id_rsa(?:\.pub)?$/, // SSH keys
  /\.npmrc$/, // npm auth
  /\.pypirc$/, // PyPI auth
];

/**
 * System paths that should be blocked
 */
const BLOCKED_PATHS = ["/etc", "/var", "/usr", "/root", "/sys", "/proc", "/boot"];
const SAFE_COCO_HOME_READ_FILES = new Set([
  "mcp.json",
  "config.json",
  "COCO.md",
  "AGENTS.md",
  "CLAUDE.md",
  "projects.json",
  "trusted-tools.json",
  "allowed-paths.json",
]);
const SAFE_COCO_HOME_READ_DIR_PREFIXES = ["skills", "memories", "logs", "checkpoints", "sessions"];

/**
 * Validate encoding is safe
 */
const SAFE_ENCODINGS = new Set(["utf-8", "utf8", "ascii", "latin1", "binary", "hex", "base64"]);

function isEncodingSafe(encoding: string): boolean {
  return SAFE_ENCODINGS.has(encoding.toLowerCase());
}

/**
 * Check for null bytes in path (security)
 */
function hasNullByte(str: string): boolean {
  return str.includes("\0");
}

/**
 * Normalize path and remove dangerous sequences
 */
function normalizePath(filePath: string): string {
  // Remove null bytes
  // oxlint-disable-next-line no-control-regex -- Intentional: sanitizing null bytes from file paths
  let normalized = filePath.replace(/\0/g, "");
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && normalized.startsWith("~")) {
    if (normalized === "~") {
      normalized = home;
    } else if (normalized.startsWith("~/") || normalized.startsWith(`~${path.sep}`)) {
      normalized = path.join(home, normalized.slice(2));
    }
  }
  // Normalize path separators and resolve .. and .
  normalized = path.normalize(normalized);
  return normalized;
}

function resolveUserPath(filePath: string): string {
  return path.resolve(normalizePath(filePath));
}

function isWithinDirectory(targetPath: string, baseDir: string): boolean {
  const normalizedTarget = path.normalize(targetPath);
  const normalizedBase = path.normalize(baseDir);
  return (
    normalizedTarget === normalizedBase || normalizedTarget.startsWith(normalizedBase + path.sep)
  );
}

function isSafeCocoHomeReadPath(absolutePath: string, homeDir: string): boolean {
  const cocoHome = path.join(homeDir, ".coco");
  if (!isWithinDirectory(absolutePath, cocoHome)) {
    return false;
  }

  const relativePath = path.relative(cocoHome, absolutePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return false;
  }

  const segments = relativePath.split(path.sep).filter(Boolean);
  const firstSegment = segments[0];
  if (!firstSegment) {
    return false;
  }

  if (firstSegment === "tokens" || firstSegment === ".env") {
    return false;
  }

  if (segments.length === 1 && SAFE_COCO_HOME_READ_FILES.has(firstSegment)) {
    return true;
  }

  return SAFE_COCO_HOME_READ_DIR_PREFIXES.includes(firstSegment);
}

/**
 * Check if a path is allowed for file operations
 */
function isPathAllowed(
  filePath: string,
  operation: "read" | "write" | "delete",
): { allowed: boolean; reason?: string } {
  // Check for null bytes (path injection)
  if (hasNullByte(filePath)) {
    return { allowed: false, reason: "Path contains invalid characters" };
  }

  const normalized = normalizePath(filePath);
  const absolute = resolveUserPath(normalized);
  const cwd = process.cwd();

  // Check for system paths (use normalized comparison)
  for (const blocked of BLOCKED_PATHS) {
    const normalizedBlocked = path.normalize(blocked);
    // Check both exact match and prefix with separator
    if (absolute === normalizedBlocked || absolute.startsWith(normalizedBlocked + path.sep)) {
      return { allowed: false, reason: `Access to system path '${blocked}' is not allowed` };
    }
  }

  // Check home directory access (only allow within project or explicitly allowed paths)
  const home = process.env.HOME;
  if (home) {
    const normalizedHome = path.normalize(home);
    const normalizedCwd = path.normalize(cwd);
    if (absolute.startsWith(normalizedHome) && !absolute.startsWith(normalizedCwd)) {
      // Check if path is within user-authorized allowed paths
      if (isWithinAllowedPath(absolute, operation)) {
        // Path is explicitly authorized — continue to sensitive file checks below
      } else if (operation === "read") {
        if (isSafeCocoHomeReadPath(absolute, normalizedHome)) {
          return { allowed: true };
        }

        // Allow reading common config files in home (but NOT sensitive ones)
        const allowedHomeReads = [".gitconfig", ".zshrc", ".bashrc"];
        const basename = path.basename(absolute);
        // Block .npmrc, .pypirc as they may contain auth tokens
        if (!allowedHomeReads.includes(basename)) {
          const targetDir = path.dirname(absolute);
          return {
            allowed: false,
            reason: `Reading files outside project directory is not allowed. Use /allow-path ${targetDir} to grant access.`,
          };
        }
      } else {
        const targetDir = path.dirname(absolute);
        return {
          allowed: false,
          reason: `${operation} operations outside project directory are not allowed. Use /allow-path ${targetDir} to grant access.`,
        };
      }
    }
  }

  // Check for sensitive files on write/delete
  if (operation === "write" || operation === "delete") {
    const basename = path.basename(absolute);
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(basename)) {
        return {
          allowed: false,
          reason: `Operation on sensitive file '${basename}' requires explicit confirmation`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Resolve path safely, following symlinks and verifying final destination
 * @internal Reserved for future use with symlink validation
 */
export async function resolvePathSecurely(
  filePath: string,
  operation: "read" | "write" | "delete",
): Promise<string> {
  const normalized = normalizePath(filePath);
  const absolute = resolveUserPath(normalized);

  // First check the requested path
  const preCheck = isPathAllowed(absolute, operation);
  if (!preCheck.allowed) {
    throw new ToolError(preCheck.reason ?? "Path not allowed", { tool: `file_${operation}` });
  }

  // For existing files, resolve symlinks and check the real path
  try {
    const realPath = await fs.realpath(absolute);
    if (realPath !== absolute) {
      // Path was a symlink - verify the target is also allowed
      const postCheck = isPathAllowed(realPath, operation);
      if (!postCheck.allowed) {
        throw new ToolError(`Symlink target '${realPath}' is not allowed: ${postCheck.reason}`, {
          tool: `file_${operation}`,
        });
      }
    }
    return realPath;
  } catch (error) {
    // File doesn't exist yet (for write operations) - use the absolute path
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return absolute;
    }
    throw error;
  }
}

/**
 * Validate path and throw if not allowed (sync version for simple checks)
 */
function validatePath(filePath: string, operation: "read" | "write" | "delete"): void {
  const result = isPathAllowed(filePath, operation);
  if (!result.allowed) {
    throw new ToolError(result.reason ?? "Path not allowed", { tool: `file_${operation}` });
  }
}

/**
 * Validate encoding parameter
 * @internal Reserved for future use with strict encoding validation
 */
export function validateEncoding(encoding: string): void {
  if (!isEncodingSafe(encoding)) {
    throw new ToolError(
      `Unsupported encoding: ${encoding}. Use one of: ${[...SAFE_ENCODINGS].join(", ")}`,
      {
        tool: "file_read",
      },
    );
  }
}

/**
 * Default max file size for reading (10MB)
 */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Check if an error is ENOENT
 */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Enrich an ENOENT error with file suggestions (including deep search).
 */
async function enrichENOENT(filePath: string, operation: string): Promise<string> {
  const absPath = resolveUserPath(filePath);
  const suggestions = await suggestSimilarFilesDeep(absPath, process.cwd());
  const hint = formatSuggestions(suggestions, path.dirname(absPath));
  const action =
    operation === "read"
      ? "Use glob or list_dir to find the correct path."
      : "Check that the parent directory exists.";
  return `File not found: ${filePath}${hint}\n${action}`;
}

/**
 * Enrich an ENOENT error for directory operations (including deep search).
 */
async function enrichDirENOENT(dirPath: string): Promise<string> {
  const absPath = resolveUserPath(dirPath);
  const suggestions = await suggestSimilarDirsDeep(absPath, process.cwd());
  const hint = formatSuggestions(suggestions, path.dirname(absPath));
  return `Directory not found: ${dirPath}${hint}\nUse list_dir or glob to find the correct path.`;
}

/**
 * Read file tool
 */
export const readFileTool: ToolDefinition<
  { path: string; encoding?: string; maxSize?: number },
  { content: string; lines: number; size: number; truncated: boolean }
> = defineTool({
  name: "read_file",
  description: `Read the full text content of a file at the given path and return it as a string. Use this when you need the actual source code, configuration values, or text content of a specific file you already know the path to. Do NOT use this to list files in a directory (use list_directory), to check if a file exists (use file_exists), or to search for files by name pattern (use find_files). Returns an error if the path does not exist or is not a readable text file.

Examples:
- Read config: { "path": "package.json" }
- Read with encoding: { "path": "data.csv", "encoding": "latin1" }
- Limit large file: { "path": "large.log", "maxSize": 1048576 }`,
  category: "file",
  parameters: z.object({
    path: z.string().describe("Absolute or relative path to the file"),
    encoding: z.string().optional().default("utf-8").describe("File encoding"),
    maxSize: z.number().optional().describe("Maximum bytes to read (default: 10MB)"),
  }),
  async execute({ path: filePath, encoding, maxSize }) {
    validatePath(filePath, "read");
    try {
      const absolutePath = resolveUserPath(filePath);
      const stats = await fs.stat(absolutePath);
      const maxBytes = maxSize ?? DEFAULT_MAX_FILE_SIZE;
      let truncated = false;

      let content: string;
      if (stats.size > maxBytes) {
        // Read only up to maxSize
        const handle = await fs.open(absolutePath, "r");
        try {
          const buffer = Buffer.alloc(maxBytes);
          await handle.read(buffer, 0, maxBytes, 0);
          content = buffer.toString(encoding as BufferEncoding);
          truncated = true;
        } finally {
          await handle.close();
        }
      } else {
        content = await fs.readFile(absolutePath, encoding as BufferEncoding);
      }

      return {
        content,
        lines: content.split("\n").length,
        size: stats.size,
        truncated,
      };
    } catch (error) {
      if (isENOENT(error)) {
        const enriched = await enrichENOENT(filePath, "read");
        throw new FileSystemError(enriched, {
          path: filePath,
          operation: "read",
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new FileSystemError(`Failed to read file: ${filePath}`, {
        path: filePath,
        operation: "read",
        cause: error instanceof Error ? error : undefined,
      });
    }
  },
});

/**
 * Write file tool
 */
export const writeFileTool: ToolDefinition<
  { path: string; content: string; createDirs?: boolean; dryRun?: boolean },
  { path: string; size: number; dryRun: boolean; wouldCreate: boolean }
> = defineTool({
  name: "write_file",
  description: `Write text content to a file, replacing it entirely if it already exists or creating it if it does not. Use this when you want to create a new file or fully replace an existing file's content. Do NOT use this to make a small change to an existing file (use edit_file instead, which performs a targeted find-and-replace without rewriting the whole file). Set createDirs: true to automatically create missing parent directories; otherwise the parent directory must already exist.

Examples:
- Create file: { "path": "src/utils.ts", "content": "export const foo = 1;" }
- Preview only: { "path": "config.json", "content": "{}", "dryRun": true }
- With nested dirs: { "path": "src/new/module.ts", "content": "...", "createDirs": true }`,
  category: "file",
  parameters: z.object({
    path: z.string().describe("Absolute or relative path to the file"),
    content: z.string().describe("Content to write"),
    createDirs: z
      .boolean()
      .optional()
      .default(true)
      .describe("Create parent directories if needed"),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe("Preview operation without making changes"),
  }),
  async execute({ path: filePath, content, createDirs, dryRun }) {
    validatePath(filePath, "write");
    try {
      const absolutePath = resolveUserPath(filePath);

      // Check if file exists
      let wouldCreate = false;
      try {
        await fs.access(absolutePath);
      } catch {
        wouldCreate = true;
      }

      // Dry run - just return what would happen
      if (dryRun) {
        return {
          path: absolutePath,
          size: Buffer.byteLength(content, "utf-8"),
          dryRun: true,
          wouldCreate,
        };
      }

      if (createDirs) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      }

      await fs.writeFile(absolutePath, content, "utf-8");
      const stats = await fs.stat(absolutePath);

      return {
        path: absolutePath,
        size: stats.size,
        dryRun: false,
        wouldCreate,
      };
    } catch (error) {
      if (isENOENT(error)) {
        const enriched = await enrichENOENT(filePath, "write");
        throw new FileSystemError(enriched, {
          path: filePath,
          operation: "write",
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new FileSystemError(`Failed to write file: ${filePath}`, {
        path: filePath,
        operation: "write",
        cause: error instanceof Error ? error : undefined,
      });
    }
  },
});

/**
 * Edit file tool (find and replace)
 */
export const editFileTool: ToolDefinition<
  { path: string; oldText: string; newText: string; all?: boolean; dryRun?: boolean },
  { path: string; replacements: number; dryRun: boolean; preview?: string }
> = defineTool({
  name: "edit_file",
  description: `Make a targeted text replacement inside an existing file by finding oldText and replacing it with newText. Use this for surgical edits to source code, configuration files, or documentation — it is much safer than rewriting the whole file with write_file because it only touches the exact bytes you specify. The oldText must match exactly (including whitespace and indentation); if it appears more than once in the file, use all: true to replace every occurrence or make oldText longer to be unique. Do NOT use this to create new files (use write_file) or to rename/move files (use move_path).

Examples:
- Single replace: { "path": "src/app.ts", "oldText": "TODO:", "newText": "DONE:" }
- Replace all: { "path": "README.md", "oldText": "v1", "newText": "v2", "all": true }
- Preview changes: { "path": "config.ts", "oldText": "dev", "newText": "prod", "dryRun": true }`,
  category: "file",
  parameters: z.object({
    path: z.string().describe("Path to the file to edit"),
    oldText: z.string().describe("Text to find"),
    newText: z.string().describe("Text to replace with"),
    all: z.boolean().optional().default(false).describe("Replace all occurrences"),
    dryRun: z.boolean().optional().default(false).describe("Preview changes without applying"),
  }),
  async execute({ path: filePath, oldText, newText, all, dryRun }) {
    validatePath(filePath, "write");
    try {
      const absolutePath = resolveUserPath(filePath);
      let content = await fs.readFile(absolutePath, "utf-8");

      // Count replacements
      let replacements = 0;
      if (all) {
        const regex = new RegExp(escapeRegex(oldText), "g");
        const matches = content.match(regex);
        replacements = matches?.length ?? 0;
        content = content.replace(regex, newText);
      } else {
        if (content.includes(oldText)) {
          content = content.replace(oldText, newText);
          replacements = 1;
        }
      }

      if (replacements === 0) {
        // Find closest matching line to provide context
        const lines = content.split("\n");
        const searchLine = (oldText.split("\n")[0] ?? oldText).trim().slice(0, 80);

        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < lines.length; i++) {
          const dist = levenshtein(lines[i]!.trim().slice(0, 80), searchLine);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }

        let context = "";
        if (bestIdx >= 0 && bestDist < searchLine.length * 0.6) {
          const start = Math.max(0, bestIdx - 2);
          const end = Math.min(lines.length, bestIdx + 3);
          const snippet = lines
            .slice(start, end)
            .map((l, i) => `  ${start + i + 1}: ${l}`)
            .join("\n");
          context = `\n\nClosest match near line ${bestIdx + 1}:\n${snippet}`;
        }

        throw new Error(
          `Text not found in file: "${oldText.slice(0, 50)}..."${context}\nHint: Use read_file first to verify the exact content.`,
        );
      }

      // Dry run - return preview without writing
      if (dryRun) {
        // Generate a simple diff preview (first 500 chars of change)
        const preview = content.length > 500 ? content.slice(0, 500) + "..." : content;
        return {
          path: absolutePath,
          replacements,
          dryRun: true,
          preview,
        };
      }

      await fs.writeFile(absolutePath, content, "utf-8");

      return {
        path: absolutePath,
        replacements,
        dryRun: false,
      };
    } catch (error) {
      throw new FileSystemError(`Failed to edit file: ${filePath}`, {
        path: filePath,
        operation: "write",
        cause: error instanceof Error ? error : undefined,
      });
    }
  },
});

/**
 * Glob tool (find files by pattern)
 */
export const globTool: ToolDefinition<
  { pattern: string; cwd?: string; ignore?: string[] },
  { files: string[]; count: number }
> = defineTool({
  name: "glob",
  description: `Find files whose paths match a glob pattern and return their relative paths as a list. Use this when you know the file extension or naming convention but not the exact path (e.g. find all TypeScript test files, all JSON configs). Do NOT use this to search inside file contents — use grep or search for that. Returns an empty list when nothing matches; does not throw an error for zero results. node_modules, .git, and dist directories are excluded by default.

Examples:
- All TypeScript: { "pattern": "**/*.ts" }
- In specific dir: { "pattern": "*.json", "cwd": "config" }
- With exclusions: { "pattern": "**/*.ts", "ignore": ["**/*.test.ts", "**/node_modules/**"] }`,
  category: "file",
  parameters: z.object({
    pattern: z.string().describe("Glob pattern (e.g., '**/*.ts')"),
    cwd: z.string().optional().describe("Base directory for search"),
    ignore: z.array(z.string()).optional().describe("Patterns to ignore"),
  }),
  async execute({ pattern, cwd, ignore }) {
    try {
      const files = await glob(pattern, {
        cwd: cwd ?? process.cwd(),
        ignore: ignore ?? ["**/node_modules/**", "**/.git/**"],
        absolute: true,
      });

      return {
        files,
        count: files.length,
      };
    } catch (error) {
      if (isENOENT(error) && cwd) {
        const enriched = await enrichDirENOENT(cwd);
        throw new FileSystemError(`Glob search failed — ${enriched}`, {
          path: cwd,
          operation: "glob",
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new FileSystemError(`Glob search failed: ${pattern}`, {
        path: cwd ?? process.cwd(),
        operation: "glob",
        cause: error instanceof Error ? error : undefined,
      });
    }
  },
});

/**
 * File exists tool
 */
export const fileExistsTool: ToolDefinition<
  { path: string },
  { exists: boolean; isFile: boolean; isDirectory: boolean }
> = defineTool({
  name: "file_exists",
  description: `Check whether a path exists on disk and whether it is a file or directory. Use this before attempting to read or write a path when you are unsure it exists — it never throws, always returning { exists: false } for missing paths. Do NOT use this to read file contents (use read_file) or to list directory contents (use list_directory). Returns isFile and isDirectory flags so you can distinguish files from directories in a single call.

Examples:
- Check file: { "path": "package.json" } → { "exists": true, "isFile": true, "isDirectory": false }
- Check dir: { "path": "src" } → { "exists": true, "isFile": false, "isDirectory": true }
- Missing: { "path": "missing.txt" } → { "exists": false, "isFile": false, "isDirectory": false }`,
  category: "file",
  parameters: z.object({
    path: z.string().describe("Path to check"),
  }),
  async execute({ path: filePath }) {
    try {
      const absolutePath = resolveUserPath(filePath);
      const stats = await fs.stat(absolutePath);

      return {
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
      };
    } catch {
      return {
        exists: false,
        isFile: false,
        isDirectory: false,
      };
    }
  },
});

/**
 * List directory tool
 */
export const listDirTool: ToolDefinition<
  { path: string; recursive?: boolean },
  { entries: Array<{ name: string; type: "file" | "directory"; size?: number }> }
> = defineTool({
  name: "list_dir",
  description: `List the immediate entries (files and subdirectories) inside a directory and return their names, types, and sizes. Use this to understand what's in a folder before deciding which files to read. Do NOT use this to find files matching a pattern across the whole project (use glob) or to read file contents (use read_file). Returns an error if the path does not exist or is not a directory.

Examples:
- List src: { "path": "src" }
- Recursive listing: { "path": ".", "recursive": true }
- Project root: { "path": "." }`,
  category: "file",
  parameters: z.object({
    path: z.string().describe("Directory path"),
    recursive: z.boolean().optional().default(false).describe("List recursively"),
  }),
  async execute({ path: dirPath, recursive }) {
    try {
      const absolutePath = resolveUserPath(dirPath);
      const entries: Array<{ name: string; type: "file" | "directory"; size?: number }> = [];

      async function listDir(dir: string, prefix: string = "") {
        const items = await fs.readdir(dir, { withFileTypes: true });

        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          const relativePath = prefix ? `${prefix}/${item.name}` : item.name;

          if (item.isDirectory()) {
            entries.push({ name: relativePath, type: "directory" });
            if (recursive) {
              await listDir(fullPath, relativePath);
            }
          } else if (item.isFile()) {
            const stats = await fs.stat(fullPath);
            entries.push({ name: relativePath, type: "file", size: stats.size });
          }
        }
      }

      await listDir(absolutePath);

      return { entries };
    } catch (error) {
      if (isENOENT(error)) {
        const enriched = await enrichDirENOENT(dirPath);
        throw new FileSystemError(enriched, {
          path: dirPath,
          operation: "read",
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new FileSystemError(`Failed to list directory: ${dirPath}`, {
        path: dirPath,
        operation: "read",
        cause: error instanceof Error ? error : undefined,
      });
    }
  },
});

/**
 * Delete file tool
 */
export const deleteFileTool: ToolDefinition<
  { path: string; recursive?: boolean; confirm?: boolean },
  { deleted: boolean; path: string }
> = defineTool({
  name: "delete_file",
  description: `Delete a file or directory. Requires explicit confirmation for safety.

Examples:
- Delete file: { "path": "temp.txt", "confirm": true }
- Delete directory: { "path": "dist", "recursive": true, "confirm": true }
- Must confirm: { "path": "file.txt" } → Error: requires confirm: true`,
  category: "file",
  parameters: z.object({
    path: z.string().describe("Path to delete"),
    recursive: z.boolean().optional().default(false).describe("Delete directories recursively"),
    confirm: z.boolean().optional().describe("Must be true to confirm deletion"),
  }),
  async execute({ path: filePath, recursive, confirm }) {
    // Require explicit confirmation
    if (confirm !== true) {
      throw new ToolError(
        "Deletion requires explicit confirmation. Set confirm: true to proceed.",
        { tool: "delete_file" },
      );
    }

    validatePath(filePath, "delete");

    try {
      const absolutePath = resolveUserPath(filePath);
      const stats = await fs.stat(absolutePath);

      if (stats.isDirectory()) {
        if (!recursive) {
          throw new ToolError("Cannot delete directory without recursive: true", {
            tool: "delete_file",
          });
        }
        await fs.rm(absolutePath, { recursive: true });
      } else {
        await fs.unlink(absolutePath);
      }

      return { deleted: true, path: absolutePath };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { deleted: false, path: resolveUserPath(filePath) };
      }
      throw new FileSystemError(`Failed to delete: ${filePath}`, {
        path: filePath,
        operation: "delete",
        cause: error instanceof Error ? error : undefined,
      });
    }
  },
});

/**
 * Copy file tool
 */
export const copyFileTool: ToolDefinition<
  { source: string; destination: string; overwrite?: boolean },
  { source: string; destination: string; size: number }
> = defineTool({
  name: "copy_file",
  description: `Copy a file or directory to a new location.

Examples:
- Copy file: { "source": "config.json", "destination": "config.backup.json" }
- Copy to dir: { "source": "src/utils.ts", "destination": "backup/utils.ts" }
- Overwrite: { "source": "new.txt", "destination": "old.txt", "overwrite": true }`,
  category: "file",
  parameters: z.object({
    source: z.string().describe("Source file path"),
    destination: z.string().describe("Destination file path"),
    overwrite: z.boolean().optional().default(false).describe("Overwrite if destination exists"),
  }),
  async execute({ source, destination, overwrite }) {
    validatePath(source, "read");
    validatePath(destination, "write");
    try {
      const srcPath = resolveUserPath(source);
      const destPath = resolveUserPath(destination);

      // Check if destination exists
      if (!overwrite) {
        try {
          await fs.access(destPath);
          throw new ToolError(
            `Destination already exists: ${destination}. Use overwrite: true to replace.`,
            {
              tool: "copy_file",
            },
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }

      // Create destination directory if needed
      await fs.mkdir(path.dirname(destPath), { recursive: true });

      // Copy file
      await fs.copyFile(srcPath, destPath);
      const stats = await fs.stat(destPath);

      return {
        source: srcPath,
        destination: destPath,
        size: stats.size,
      };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (isENOENT(error)) {
        const enriched = await enrichENOENT(source, "read");
        throw new FileSystemError(`Failed to copy — ${enriched}`, {
          path: source,
          operation: "read",
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new FileSystemError(`Failed to copy file: ${source} -> ${destination}`, {
        path: source,
        operation: "read",
        cause: error instanceof Error ? error : undefined,
      });
    }
  },
});

/**
 * Move/rename file tool
 */
export const moveFileTool: ToolDefinition<
  { source: string; destination: string; overwrite?: boolean },
  { source: string; destination: string }
> = defineTool({
  name: "move_file",
  description: `Move or rename a file or directory.

Examples:
- Rename: { "source": "old.ts", "destination": "new.ts" }
- Move to dir: { "source": "src/utils.ts", "destination": "lib/utils.ts" }
- Overwrite: { "source": "new.txt", "destination": "old.txt", "overwrite": true }`,
  category: "file",
  parameters: z.object({
    source: z.string().describe("Source file path"),
    destination: z.string().describe("Destination file path"),
    overwrite: z.boolean().optional().default(false).describe("Overwrite if destination exists"),
  }),
  async execute({ source, destination, overwrite }) {
    validatePath(source, "delete");
    validatePath(destination, "write");
    try {
      const srcPath = resolveUserPath(source);
      const destPath = resolveUserPath(destination);

      // Check if destination exists
      if (!overwrite) {
        try {
          await fs.access(destPath);
          throw new ToolError(
            `Destination already exists: ${destination}. Use overwrite: true to replace.`,
            {
              tool: "move_file",
            },
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }

      // Create destination directory if needed
      await fs.mkdir(path.dirname(destPath), { recursive: true });

      // Move file
      await fs.rename(srcPath, destPath);

      return {
        source: srcPath,
        destination: destPath,
      };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (isENOENT(error)) {
        const enriched = await enrichENOENT(source, "read");
        throw new FileSystemError(`Failed to move — ${enriched}`, {
          path: source,
          operation: "write",
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new FileSystemError(`Failed to move file: ${source} -> ${destination}`, {
        path: source,
        operation: "write",
        cause: error instanceof Error ? error : undefined,
      });
    }
  },
});

/**
 * Tree tool - visualize directory structure
 */
/**
 * Directories always excluded from tree output.
 * These are large, generated, or irrelevant to code understanding.
 * Matches the same defaults used by Claude Code, Cursor, and aider.
 */
const TREE_IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  ".parcel-cache",
  "coverage",
  ".nyc_output",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "target",
  ".gradle",
  ".mvn",
  "bin",
  "obj",
]);

/**
 * Maximum lines in tree output. Beyond this the tree is truncated with a
 * summary line. Prevents single tool results from consuming tens of thousands
 * of tokens on large repos. Based on aider's default repo-map budget (~1K tokens).
 */
const MAX_TREE_LINES = 500;

export const treeTool: ToolDefinition<
  { path?: string; depth?: number; showHidden?: boolean; dirsOnly?: boolean },
  { tree: string; totalFiles: number; totalDirs: number; truncated: boolean }
> = defineTool({
  name: "tree",
  description: `Display directory structure as a tree.

Large dependency directories (node_modules, dist, .next, etc.) are excluded
automatically. Output is capped at ${MAX_TREE_LINES} lines to keep context lean.

Examples:
- Current dir: { }
- Specific dir: { "path": "src" }
- Limited depth: { "path": ".", "depth": 2 }
- Directories only: { "path": ".", "dirsOnly": true }
- Show hidden: { "path": ".", "showHidden": true }`,
  category: "file",
  parameters: z.object({
    path: z.string().optional().default(".").describe("Directory path (default: current)"),
    depth: z.number().optional().default(4).describe("Maximum depth (default: 4)"),
    showHidden: z.boolean().optional().default(false).describe("Show hidden files"),
    dirsOnly: z.boolean().optional().default(false).describe("Show only directories"),
  }),
  async execute({ path: dirPath, depth, showHidden, dirsOnly }) {
    try {
      const absolutePath = resolveUserPath(dirPath ?? ".");
      let totalFiles = 0;
      let totalDirs = 0;
      const lines: string[] = [path.basename(absolutePath) + "/"];
      let truncated = false;

      async function buildTree(dir: string, prefix: string, currentDepth: number) {
        if (currentDepth > (depth ?? 4)) return;
        if (lines.length >= MAX_TREE_LINES) return;

        let items = await fs.readdir(dir, { withFileTypes: true });

        // Always exclude known large/generated directories regardless of showHidden
        items = items.filter((item) => !TREE_IGNORED_DIRS.has(item.name));

        // Filter hidden files (dotfiles/dotdirs) unless explicitly requested
        if (!showHidden) {
          items = items.filter((item) => !item.name.startsWith("."));
        }

        // Filter to directories only if requested
        if (dirsOnly) {
          items = items.filter((item) => item.isDirectory());
        }

        // Sort: directories first, then alphabetically
        items.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < items.length; i++) {
          if (lines.length >= MAX_TREE_LINES) {
            truncated = true;
            return;
          }
          const item = items[i]!;
          const isLast = i === items.length - 1;
          const connector = isLast ? "└── " : "├── ";
          const childPrefix = isLast ? "    " : "│   ";

          if (item.isDirectory()) {
            totalDirs++;
            lines.push(`${prefix}${connector}${item.name}/`);
            await buildTree(path.join(dir, item.name), prefix + childPrefix, currentDepth + 1);
          } else {
            totalFiles++;
            lines.push(`${prefix}${connector}${item.name}`);
          }
        }
      }

      await buildTree(absolutePath, "", 1);

      if (truncated) {
        lines.push(
          `\n[... output truncated at ${MAX_TREE_LINES} lines. Use a deeper path or lower depth to see more.]`,
        );
      }

      return {
        tree: lines.join("\n"),
        totalFiles,
        totalDirs,
        truncated,
      };
    } catch (error) {
      if (isENOENT(error)) {
        const enriched = await enrichDirENOENT(dirPath ?? ".");
        throw new FileSystemError(enriched, {
          path: dirPath ?? ".",
          operation: "read",
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new FileSystemError(`Failed to generate tree: ${dirPath}`, {
        path: dirPath ?? ".",
        operation: "read",
        cause: error instanceof Error ? error : undefined,
      });
    }
  },
});

/**
 * All file tools
 */
export const fileTools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
  fileExistsTool,
  listDirTool,
  deleteFileTool,
  copyFileTool,
  moveFileTool,
  treeTool,
];

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
