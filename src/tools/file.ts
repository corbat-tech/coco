/**
 * File tools for Corbat-Coco
 * Read, write, edit, and search files
 */

import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { defineTool, type ToolDefinition } from "./registry.js";
import { FileSystemError } from "../utils/errors.js";

/**
 * Read file tool
 */
export const readFileTool: ToolDefinition<
  { path: string; encoding?: string },
  { content: string; lines: number; size: number }
> = defineTool({
  name: "read_file",
  description: "Read the contents of a file",
  category: "file",
  parameters: z.object({
    path: z.string().describe("Absolute or relative path to the file"),
    encoding: z.string().optional().default("utf-8").describe("File encoding"),
  }),
  async execute({ path: filePath, encoding }) {
    try {
      const absolutePath = path.resolve(filePath);
      const content = await fs.readFile(absolutePath, encoding as BufferEncoding);
      const stats = await fs.stat(absolutePath);

      return {
        content,
        lines: content.split("\n").length,
        size: stats.size,
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
  { path: string; content: string; createDirs?: boolean },
  { path: string; size: number }
> = defineTool({
  name: "write_file",
  description: "Write content to a file, creating it if it doesn't exist",
  category: "file",
  parameters: z.object({
    path: z.string().describe("Absolute or relative path to the file"),
    content: z.string().describe("Content to write"),
    createDirs: z.boolean().optional().default(true).describe("Create parent directories if needed"),
  }),
  async execute({ path: filePath, content, createDirs }) {
    try {
      const absolutePath = path.resolve(filePath);

      if (createDirs) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      }

      await fs.writeFile(absolutePath, content, "utf-8");
      const stats = await fs.stat(absolutePath);

      return {
        path: absolutePath,
        size: stats.size,
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
  { path: string; oldText: string; newText: string; all?: boolean },
  { path: string; replacements: number }
> = defineTool({
  name: "edit_file",
  description: "Edit a file by replacing text",
  category: "file",
  parameters: z.object({
    path: z.string().describe("Path to the file to edit"),
    oldText: z.string().describe("Text to find"),
    newText: z.string().describe("Text to replace with"),
    all: z.boolean().optional().default(false).describe("Replace all occurrences"),
  }),
  async execute({ path: filePath, oldText, newText, all }) {
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

      await fs.writeFile(absolutePath, content, "utf-8");

      return {
        path: absolutePath,
        replacements,
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
  description: "Find files matching a glob pattern",
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
  description: "Check if a file or directory exists",
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
  description: "List contents of a directory",
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
  { path: string; recursive?: boolean },
  { deleted: boolean }
> = defineTool({
  name: "delete_file",
  description: "Delete a file or directory",
  category: "file",
  parameters: z.object({
    path: z.string().describe("Path to delete"),
    recursive: z.boolean().optional().default(false).describe("Delete directories recursively"),
  }),
  async execute({ path: filePath, recursive }) {
    try {
      const absolutePath = path.resolve(filePath);
      const stats = await fs.stat(absolutePath);

      if (stats.isDirectory()) {
        if (!recursive) {
          throw new Error("Cannot delete directory without recursive flag");
        }
        await fs.rm(absolutePath, { recursive: true });
      } else {
        await fs.unlink(absolutePath);
      }

      return { deleted: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { deleted: false };
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
];

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
