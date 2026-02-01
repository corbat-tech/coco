/**
 * File utilities for Corbat-Coco
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { FileSystemError } from "./errors.js";

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    throw new FileSystemError(`Failed to create directory: ${dirPath}`, {
      path: dirPath,
      operation: "write",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a JSON file with type safety
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (error) {
    throw new FileSystemError(`Failed to read JSON file: ${filePath}`, {
      path: filePath,
      operation: "read",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Write a JSON file with pretty formatting
 */
export async function writeJsonFile(
  filePath: string,
  data: unknown,
  options: { indent?: number; ensureDir?: boolean } = {}
): Promise<void> {
  const { indent = 2, ensureDir: shouldEnsureDir = true } = options;

  try {
    if (shouldEnsureDir) {
      await ensureDir(path.dirname(filePath));
    }

    const content = JSON.stringify(data, null, indent);
    await fs.writeFile(filePath, content + "\n", "utf-8");
  } catch (error) {
    throw new FileSystemError(`Failed to write JSON file: ${filePath}`, {
      path: filePath,
      operation: "write",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Copy a file
 */
export async function copyFile(
  source: string,
  destination: string,
  options: { ensureDir?: boolean } = {}
): Promise<void> {
  const { ensureDir: shouldEnsureDir = true } = options;

  try {
    if (shouldEnsureDir) {
      await ensureDir(path.dirname(destination));
    }

    await fs.copyFile(source, destination);
  } catch (error) {
    throw new FileSystemError(`Failed to copy file from ${source} to ${destination}`, {
      path: source,
      operation: "read",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Remove a file or directory
 */
export async function removeFile(filePath: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      await fs.rm(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return; // File doesn't exist, nothing to remove
    }
    throw new FileSystemError(`Failed to remove: ${filePath}`, {
      path: filePath,
      operation: "delete",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Get file hash (SHA-256)
 */
export async function getFileHash(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch (error) {
    throw new FileSystemError(`Failed to hash file: ${filePath}`, {
      path: filePath,
      operation: "read",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Get string hash (SHA-256)
 */
export function getStringHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Read a file as text, with optional fallback
 */
export async function readTextFile(
  filePath: string,
  fallback?: string
): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (fallback !== undefined && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw new FileSystemError(`Failed to read file: ${filePath}`, {
      path: filePath,
      operation: "read",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Write text to a file
 */
export async function writeTextFile(
  filePath: string,
  content: string,
  options: { ensureDir?: boolean; mode?: number } = {}
): Promise<void> {
  const { ensureDir: shouldEnsureDir = true, mode } = options;

  try {
    if (shouldEnsureDir) {
      await ensureDir(path.dirname(filePath));
    }

    await fs.writeFile(filePath, content, { encoding: "utf-8", mode });
  } catch (error) {
    throw new FileSystemError(`Failed to write file: ${filePath}`, {
      path: filePath,
      operation: "write",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Append text to a file
 */
export async function appendTextFile(
  filePath: string,
  content: string,
  options: { ensureDir?: boolean } = {}
): Promise<void> {
  const { ensureDir: shouldEnsureDir = true } = options;

  try {
    if (shouldEnsureDir) {
      await ensureDir(path.dirname(filePath));
    }

    await fs.appendFile(filePath, content, "utf-8");
  } catch (error) {
    throw new FileSystemError(`Failed to append to file: ${filePath}`, {
      path: filePath,
      operation: "write",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * List files in a directory
 */
export async function listFiles(
  dirPath: string,
  options: { recursive?: boolean; pattern?: RegExp } = {}
): Promise<string[]> {
  const { recursive = false, pattern } = options;
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory() && recursive) {
        const subFiles = await listFiles(fullPath, options);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        if (!pattern || pattern.test(entry.name)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  } catch (error) {
    throw new FileSystemError(`Failed to list files in: ${dirPath}`, {
      path: dirPath,
      operation: "read",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Get file stats
 */
export async function getFileStats(filePath: string): Promise<{
  size: number;
  mtime: Date;
  isFile: boolean;
  isDirectory: boolean;
}> {
  try {
    const stat = await fs.stat(filePath);
    return {
      size: stat.size,
      mtime: stat.mtime,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
    };
  } catch (error) {
    throw new FileSystemError(`Failed to get stats for: ${filePath}`, {
      path: filePath,
      operation: "read",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Create a temporary file
 */
export async function createTempFile(
  content: string,
  options: { prefix?: string; suffix?: string; dir?: string } = {}
): Promise<string> {
  const { prefix = "coco-", suffix = ".tmp", dir } = options;
  const tempDir = dir ?? (await fs.mkdtemp(path.join(process.cwd(), ".coco-temp-")));
  const fileName = `${prefix}${Date.now()}${suffix}`;
  const filePath = path.join(tempDir, fileName);

  await writeTextFile(filePath, content);
  return filePath;
}

/**
 * Atomic write (write to temp then rename)
 */
export async function atomicWriteFile(
  filePath: string,
  content: string
): Promise<void> {
  const tempPath = `${filePath}.${Date.now()}.tmp`;

  try {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(tempPath, content, "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    throw new FileSystemError(`Failed to write file atomically: ${filePath}`, {
      path: filePath,
      operation: "write",
      cause: error instanceof Error ? error : undefined,
    });
  }
}
