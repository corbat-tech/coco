/**
 * Tests for file-suggestions.ts deep search functionality
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  findFileRecursive,
  suggestSimilarFilesDeep,
  suggestSimilarDirsDeep,
  formatSuggestions,
} from "./file-suggestions.js";

// Helper to create temp directories
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "file-suggestions-test-"));
}

// Helper to create nested structure
async function createNestedStructure(baseDir: string): Promise<void> {
  // Create: a/b/c/target.txt
  await fs.mkdir(path.join(baseDir, "a", "b", "c"), { recursive: true });
  await fs.writeFile(path.join(baseDir, "a", "b", "c", "target.txt"), "content");

  // Create: .tmp/archivo.txt (hidden dir)
  await fs.mkdir(path.join(baseDir, ".tmp"), { recursive: true });
  await fs.writeFile(path.join(baseDir, ".tmp", "archivo.txt"), "content");

  // Create: case variations
  await fs.writeFile(path.join(baseDir, "Archivo.TXT"), "content");
  await fs.writeFile(path.join(baseDir, "archivo.txt"), "content");

  // Create: fuzzy match candidate
  await fs.mkdir(path.join(baseDir, "src", "components"), { recursive: true });
  await fs.writeFile(path.join(baseDir, "src", "components", "button.tsx"), "content");

  // Create excluded dir content (should be skipped)
  await fs.mkdir(path.join(baseDir, "node_modules", "some-package"), { recursive: true });
  await fs.writeFile(path.join(baseDir, "node_modules", "some-package", "index.js"), "content");
}

describe("findFileRecursive", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await createNestedStructure(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should find file in hidden directory (.tmp/archivo.txt)", async () => {
    const results = await findFileRecursive(tempDir, "archivo.txt");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.path.includes(".tmp"))).toBe(true);
  });

  it("should find file in nested subdirectory (a/b/c/target.txt)", async () => {
    const results = await findFileRecursive(tempDir, "target.txt");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("a" + path.sep + "b" + path.sep + "c");
  });

  it("should find case-insensitive exact match (Archivo.TXT vs archivo.txt)", async () => {
    const results = await findFileRecursive(tempDir, "archivo.txt");
    // Should find both archivo.txt and Archivo.TXT with distance 0
    const exactMatches = results.filter((r) => r.distance === 0);
    expect(exactMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("should find fuzzy match with typo (archvo.txt → archivo.txt)", async () => {
    const results = await findFileRecursive(tempDir, "archvo.txt");
    expect(results.length).toBeGreaterThan(0);
    // Should find archivo.txt with small distance
    expect(results[0].distance).toBeLessThanOrEqual(2);
  });

  it("should respect maxDepth option", async () => {
    // Create a unique filename to avoid conflicts with other test files
    const uniqueName = `depth-test-${Date.now()}.txt`;

    // Create: a/b/c/uniqueName
    await fs.mkdir(path.join(tempDir, "a", "b", "c"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "a", "b", "c", uniqueName), "content");

    // With maxDepth 1, should not find a/b/c/uniqueName (it's at depth 3)
    const results = await findFileRecursive(tempDir, uniqueName, { maxDepth: 1 });
    expect(results.length).toBe(0);

    // With maxDepth 3, should find it
    const resultsDeep = await findFileRecursive(tempDir, uniqueName, { maxDepth: 3 });
    expect(resultsDeep.length).toBeGreaterThan(0);
  });

  it("should respect timeoutMs option", async () => {
    // Create many directories to slow down search
    for (let i = 0; i < 100; i++) {
      await fs.mkdir(path.join(tempDir, `dir${i}`), { recursive: true });
    }

    // With very short timeout, should return quickly
    const start = Date.now();
    await findFileRecursive(tempDir, "nonexistent.txt", {
      timeoutMs: 1,
      maxResults: 10,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100); // Should abort quickly
  });

  it("should skip excluded directories (node_modules)", async () => {
    const results = await findFileRecursive(tempDir, "index.js");
    // Should not find index.js in node_modules
    expect(results.some((r) => r.path.includes("node_modules"))).toBe(false);
  });

  it("should return empty array when file truly absent", async () => {
    const results = await findFileRecursive(tempDir, "definitely-not-here.xyz");
    expect(results).toEqual([]);
  });

  it("should respect maxResults option", async () => {
    // Create multiple files with similar names
    for (let i = 0; i < 10; i++) {
      await fs.writeFile(path.join(tempDir, `file${i}.txt`), "content");
    }

    const results = await findFileRecursive(tempDir, "file", { maxResults: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("should work in directory mode", async () => {
    const results = await findFileRecursive(tempDir, "components", { type: "directory" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("src");
  });

  it("should handle permission errors gracefully", async () => {
    // Create a directory with no read permissions (Unix only)
    if (process.platform !== "win32") {
      const restrictedDir = path.join(tempDir, "restricted");
      await fs.mkdir(restrictedDir, { recursive: true });
      await fs.chmod(restrictedDir, 0o000);

      try {
        // Should not throw, just skip the restricted directory
        const results = await findFileRecursive(tempDir, "anything.txt");
        expect(Array.isArray(results)).toBe(true);
      } finally {
        await fs.chmod(restrictedDir, 0o755);
      }
    }
  });
});

describe("suggestSimilarFilesDeep", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await fs.writeFile(path.join(tempDir, "sibling.txt"), "content");
    await fs.mkdir(path.join(tempDir, "subdir"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "subdir", "nested.txt"), "content");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return parent-dir results when available (fast path)", async () => {
    // Looking for "sibling.txt" when it exists in same dir
    const results = await suggestSimilarFilesDeep(
      path.join(tempDir, "sbling.txt"), // typo
      tempDir,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("sibling.txt");
  });

  it("should fall back to deep search when parent-dir empty", async () => {
    // Looking for file in non-existent subdir
    const results = await suggestSimilarFilesDeep(
      path.join(tempDir, "nonexistent", "nested.txt"),
      tempDir,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("nested.txt");
  });

  it("should prioritize exact basename over fuzzy", async () => {
    await fs.writeFile(path.join(tempDir, "exact.txt"), "content");
    await fs.writeFile(path.join(tempDir, "exactly.txt"), "content");

    const results = await suggestSimilarFilesDeep(path.join(tempDir, "exact.txt"), tempDir);

    // exact.txt should have distance 0
    const exactMatch = results.find((r) => r.path.endsWith("exact.txt"));
    expect(exactMatch?.distance).toBe(0);
  });

  it("should work when parent dir does not exist", async () => {
    const results = await suggestSimilarFilesDeep(
      path.join(tempDir, "deeply", "nested", "path", "nested.txt"),
      tempDir,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("nested.txt");
  });
});

describe("suggestSimilarDirsDeep", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await fs.mkdir(path.join(tempDir, "src", "components"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "lib", "utils"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should find similar directories", async () => {
    const results = await suggestSimilarDirsDeep(
      path.join(tempDir, "component"), // typo: missing 's'
      tempDir,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("components");
  });

  it("should fall back to deep search when parent not found", async () => {
    const results = await suggestSimilarDirsDeep(
      path.join(tempDir, "nonexistent", "utils"),
      tempDir,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("utils");
  });
});

describe("formatSuggestions", () => {
  it("should format empty suggestions as empty string", () => {
    expect(formatSuggestions([])).toBe("");
  });

  it("should format suggestions with relative paths", () => {
    const baseDir = "/project";
    const suggestions = [
      { path: "/project/src/file.ts", distance: 0 },
      { path: "/project/lib/file.js", distance: 1 },
    ];

    const formatted = formatSuggestions(suggestions, baseDir);
    expect(formatted).toContain("Did you mean?");
    expect(formatted).toContain("src/file.ts");
    expect(formatted).toContain("lib/file.js");
  });

  it("should use process.cwd() as default base", () => {
    const suggestions = [{ path: process.cwd() + "/file.txt", distance: 0 }];
    const formatted = formatSuggestions(suggestions);
    expect(formatted).toContain("file.txt");
  });
});
