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

/**
 * Sensitive file patterns that should be protected
 */
const SENSITIVE_PATTERNS = [
  /\.env(?:\.\w+)?$/,        // .env, .env.local, etc.
  /credentials\.\w+$/i,      // credentials.json, etc.
  /secrets?\.\w+$/i,         // secret.json, secrets.yaml
  /\.pem$/,                  // Private keys
  /\.key$/,                  // Private keys
  /id_rsa(?:\.pub)?$/,       // SSH keys
  /\.npmrc$/,                // npm auth
  /\.pypirc$/,               // PyPI auth
];

/**
 * System paths that should be blocked
 */
const BLOCKED_PATHS = [
  "/etc",
  "/var",
  "/usr",
  "/root",
  "/sys",
  "/proc",
  "/boot",
];

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
  let normalized = filePath.replace(/\0/g, "");
  // Normalize path separators and resolve .. and .
  normalized = path.normalize(normalized);
  return normalized;
}

/**
 * Check if a path is allowed for file operations
 */
function isPathAllowed(filePath: string, operation: "read" | "write" | "delete"): { allowed: boolean; reason?: string } {
  // Check for null bytes (path injection)
  if (hasNullByte(filePath)) {
    return { allowed: false, reason: "Path contains invalid characters" };
  }

  const normalized = normalizePath(filePath);
  const absolute = path.resolve(normalized);
  const cwd = process.cwd();

  // Check for system paths (use normalized comparison)
  for (const blocked of BLOCKED_PATHS) {
    const normalizedBlocked = path.normalize(blocked);
    // Check both exact match and prefix with separator
    if (absolute === normalizedBlocked || absolute.startsWith(normalizedBlocked + path.sep)) {
      return { allowed: false, reason: `Access to system path '${blocked}' is not allowed` };
    }
  }

  // Check home directory access (only allow within project)
  const home = process.env.HOME;
  if (home) {
    const normalizedHome = path.normalize(home);
    const normalizedCwd = path.normalize(cwd);
    if (absolute.startsWith(normalizedHome) && !absolute.startsWith(normalizedCwd)) {
      // Allow reading common config files in home (but NOT sensitive ones)
      if (operation === "read") {
        const allowedHomeReads = [".gitconfig", ".zshrc", ".bashrc"];
        const basename = path.basename(absolute);
        // Block .npmrc, .pypirc as they may contain auth tokens
        if (!allowedHomeReads.includes(basename)) {
          return { allowed: false, reason: "Reading files outside project directory is not allowed" };
        }
      } else {
        return { allowed: false, reason: `${operation} operations outside project directory are not allowed` };
      }
    }
  }

  // Check for sensitive files on write/delete
  if (operation === "write" || operation === "delete") {
    const basename = path.basename(absolute);
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(basename)) {
        return { allowed: false, reason: `Operation on sensitive file '${basename}' requires explicit confirmation` };
      }
    }
  }

  return { allowed: true };
}

/**
 * Resolve path safely, following symlinks and verifying final destination
 * @internal Reserved for future use with symlink validation
 */
export async function resolvePathSecurely(filePath: string, operation: "read" | "write" | "delete"): Promise<string> {
  const normalized = normalizePath(filePath);
  const absolute = path.resolve(normalized);

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
        throw new ToolError(
          `Symlink target '${realPath}' is not allowed: ${postCheck.reason}`,
          { tool: `file_${operation}` }
        );
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
    throw new ToolError(`Unsupported encoding: ${encoding}. Use one of: ${[...SAFE_ENCODINGS].join(", ")}`, {
      tool: "file_read",
    });
  }
}

/**
 * Default max file size for reading (10MB)
 */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Read file tool
 */
export const readFileTool: ToolDefinition<
  { path: string; encoding?: string; maxSize?: number },
  { content: string; lines: number; size: number; truncated: boolean }
> = defineTool({
  name: "read_file",
  description: `Read the contents of a file.

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
      const absolutePath = path.resolve(filePath);
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
  description: `Write content to a file, creating it if it doesn't exist.

Examples:
- Create file: { "path": "src/utils.ts", "content": "export const foo = 1;" }
- Preview only: { "path": "config.json", "content": "{}", "dryRun": true }
- With nested dirs: { "path": "src/new/module.ts", "content": "...", "createDirs": true }`,
  category: "file",
  parameters: z.object({
    path: z.string().describe("Absolute or relative path to the file"),
    content: z.string().describe("Content to write"),
    createDirs: z.boolean().optional().default(true).describe("Create parent directories if needed"),
    dryRun: z.boolean().optional().default(false).describe("Preview operation without making changes"),
  }),
  async execute({ path: filePath, content, createDirs, dryRun }) {
    validatePath(filePath, "write");
    try {
      const absolutePath = path.resolve(filePath);

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
  description: `Edit a file by replacing text (find and replace).

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
      const absolutePath = path.resolve(filePath);
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
        throw new Error(`Text not found in file: "${oldText.slice(0, 50)}..."`);
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
  description: `Find files matching a glob pattern.

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
  description: `Check if a file or directory exists.

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
      const absolutePath = path.resolve(filePath);
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
  description: `List contents of a directory.

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
      const absolutePath = path.resolve(dirPath);
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
        { tool: "delete_file" }
      );
    }

    validatePath(filePath, "delete");

    try {
      const absolutePath = path.resolve(filePath);
      const stats = await fs.stat(absolutePath);

      if (stats.isDirectory()) {
        if (!recursive) {
          throw new ToolError(
            "Cannot delete directory without recursive: true",
            { tool: "delete_file" }
          );
        }
        await fs.rm(absolutePath, { recursive: true });
      } else {
        await fs.unlink(absolutePath);
      }

      return { deleted: true, path: absolutePath };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { deleted: false, path: path.resolve(filePath) };
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
      const srcPath = path.resolve(source);
      const destPath = path.resolve(destination);

      // Check if destination exists
      if (!overwrite) {
        try {
          await fs.access(destPath);
          throw new ToolError(`Destination already exists: ${destination}. Use overwrite: true to replace.`, {
            tool: "copy_file",
          });
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
      const srcPath = path.resolve(source);
      const destPath = path.resolve(destination);

      // Check if destination exists
      if (!overwrite) {
        try {
          await fs.access(destPath);
          throw new ToolError(`Destination already exists: ${destination}. Use overwrite: true to replace.`, {
            tool: "move_file",
          });
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
export const treeTool: ToolDefinition<
  { path?: string; depth?: number; showHidden?: boolean; dirsOnly?: boolean },
  { tree: string; totalFiles: number; totalDirs: number }
> = defineTool({
  name: "tree",
  description: `Display directory structure as a tree.

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
      const absolutePath = path.resolve(dirPath ?? ".");
      let totalFiles = 0;
      let totalDirs = 0;
      const lines: string[] = [path.basename(absolutePath) + "/"];

      async function buildTree(dir: string, prefix: string, currentDepth: number) {
        if (currentDepth > (depth ?? 4)) return;

        let items = await fs.readdir(dir, { withFileTypes: true });

        // Filter hidden files
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

      return {
        tree: lines.join("\n"),
        totalFiles,
        totalDirs,
      };
    } catch (error) {
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
