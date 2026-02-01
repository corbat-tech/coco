/**
 * Mock implementations for filesystem operations
 */

import { vi } from "vitest";

/**
 * In-memory filesystem for testing
 */
export class MockFileSystem {
  private files: Map<string, string> = new Map();
  private directories: Set<string> = new Set();

  constructor() {
    this.directories.add("/");
  }

  /**
   * Read a file
   */
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
    return content;
  }

  /**
   * Write a file
   */
  async writeFile(path: string, content: string): Promise<void> {
    // Ensure parent directory exists
    const dir = path.substring(0, path.lastIndexOf("/"));
    if (dir && !this.directories.has(dir)) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
    this.files.set(path, content);
  }

  /**
   * Check if file exists
   */
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  /**
   * Create directory
   */
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      const parts = path.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current += "/" + part;
        this.directories.add(current);
      }
    } else {
      const parent = path.substring(0, path.lastIndexOf("/"));
      if (parent && !this.directories.has(parent)) {
        const error = new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      this.directories.add(path);
    }
  }

  /**
   * Read directory
   */
  async readdir(path: string): Promise<string[]> {
    if (!this.directories.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }

    const entries: string[] = [];
    const prefix = path.endsWith("/") ? path : path + "/";

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relativePath = filePath.substring(prefix.length);
        const firstPart = relativePath.split("/")[0];
        if (firstPart && !entries.includes(firstPart)) {
          entries.push(firstPart);
        }
      }
    }

    for (const dirPath of this.directories) {
      if (dirPath.startsWith(prefix) && dirPath !== path) {
        const relativePath = dirPath.substring(prefix.length);
        const firstPart = relativePath.split("/")[0];
        if (firstPart && !entries.includes(firstPart)) {
          entries.push(firstPart);
        }
      }
    }

    return entries;
  }

  /**
   * Delete file
   */
  async unlink(path: string): Promise<void> {
    if (!this.files.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
    this.files.delete(path);
  }

  /**
   * Get file stats (basic implementation)
   */
  async stat(path: string): Promise<{ isFile: () => boolean; isDirectory: () => boolean }> {
    if (this.files.has(path)) {
      return {
        isFile: () => true,
        isDirectory: () => false,
      };
    }
    if (this.directories.has(path)) {
      return {
        isFile: () => false,
        isDirectory: () => true,
      };
    }
    const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
    (error as NodeJS.ErrnoException).code = "ENOENT";
    throw error;
  }

  /**
   * Setup initial files
   */
  setup(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      // Create parent directories
      const dir = path.substring(0, path.lastIndexOf("/"));
      if (dir) {
        const parts = dir.split("/").filter(Boolean);
        let current = "";
        for (const part of parts) {
          current += "/" + part;
          this.directories.add(current);
        }
      }
      this.files.set(path, content);
    }
  }

  /**
   * Reset filesystem
   */
  reset(): void {
    this.files.clear();
    this.directories.clear();
    this.directories.add("/");
  }

  /**
   * Get all files (for assertions)
   */
  getFiles(): Map<string, string> {
    return new Map(this.files);
  }

  /**
   * Get all directories (for assertions)
   */
  getDirectories(): Set<string> {
    return new Set(this.directories);
  }
}

/**
 * Create mock for node:fs/promises
 */
export function setupFileSystemMock() {
  const mockFs = new MockFileSystem();

  vi.mock("node:fs/promises", () => ({
    readFile: (path: string) => mockFs.readFile(path),
    writeFile: (path: string, content: string) => mockFs.writeFile(path, content),
    mkdir: (path: string, options?: { recursive?: boolean }) => mockFs.mkdir(path, options),
    readdir: (path: string) => mockFs.readdir(path),
    unlink: (path: string) => mockFs.unlink(path),
    stat: (path: string) => mockFs.stat(path),
    access: async (path: string) => {
      const exists = await mockFs.exists(path);
      if (!exists) {
        const error = new Error(`ENOENT: no such file or directory, access '${path}'`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
    },
  }));

  return mockFs;
}
