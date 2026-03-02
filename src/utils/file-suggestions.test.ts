/**
 * Tests for file suggestion utilities
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { suggestSimilarFiles, suggestSimilarPaths, formatSuggestions } from "./file-suggestions.js";

describe("file-suggestions", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "coco-suggest-"));
    // Create test files
    await fs.writeFile(path.join(tmpDir, "config.ts"), "");
    await fs.writeFile(path.join(tmpDir, "config.json"), "");
    await fs.writeFile(path.join(tmpDir, "conifg.ts"), ""); // typo variant
    await fs.writeFile(path.join(tmpDir, "utils.ts"), "");
    await fs.writeFile(path.join(tmpDir, "README.md"), "");
    await fs.mkdir(path.join(tmpDir, "src"));
    await fs.writeFile(path.join(tmpDir, "src", "index.ts"), "");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("suggestSimilarFiles", () => {
    it("should suggest similar files when path has a typo", async () => {
      const missing = path.join(tmpDir, "cofnig.ts");
      const suggestions = await suggestSimilarFiles(missing);

      expect(suggestions.length).toBeGreaterThan(0);
      const names = suggestions.map((s) => path.basename(s.path));
      expect(names).toContain("config.ts");
    });

    it("should suggest files with similar basename", async () => {
      const missing = path.join(tmpDir, "config.yaml");
      const suggestions = await suggestSimilarFiles(missing);

      expect(suggestions.length).toBeGreaterThan(0);
      const names = suggestions.map((s) => path.basename(s.path));
      expect(names).toContain("config.ts");
      expect(names).toContain("config.json");
    });

    it("should return empty array when parent directory does not exist", async () => {
      const missing = path.join(tmpDir, "nonexistent", "file.ts");
      const suggestions = await suggestSimilarFiles(missing);

      expect(suggestions).toEqual([]);
    });

    it("should return empty array when no files are similar", async () => {
      const missing = path.join(tmpDir, "zzzzzzzzzzzzz.xyz");
      const suggestions = await suggestSimilarFiles(missing);

      expect(suggestions).toEqual([]);
    });

    it("should respect maxResults", async () => {
      const missing = path.join(tmpDir, "config.yaml");
      const suggestions = await suggestSimilarFiles(missing, { maxResults: 1 });

      expect(suggestions.length).toBeLessThanOrEqual(1);
    });

    it("should sort by distance (closest first)", async () => {
      const missing = path.join(tmpDir, "conifg.ts"); // exists as exact match
      const suggestions = await suggestSimilarFiles(missing);

      if (suggestions.length >= 2) {
        expect(suggestions[0]!.distance).toBeLessThanOrEqual(suggestions[1]!.distance);
      }
    });
  });

  describe("suggestSimilarPaths", () => {
    it("should fall back to grandparent when parent does not exist", async () => {
      // Create a sibling dir
      await fs.mkdir(path.join(tmpDir, "srcc"), { recursive: true }); // typo
      const missing = path.join(tmpDir, "srx", "index.ts"); // srx doesn't exist
      const suggestions = await suggestSimilarPaths(missing);

      // Should suggest directories similar to "srx" from tmpDir
      expect(suggestions.length).toBeGreaterThan(0);
      const names = suggestions.map((s) => path.basename(s.path));
      expect(names).toContain("src");
    });

    it("should prefer direct parent suggestions when parent exists", async () => {
      const missing = path.join(tmpDir, "config.yaml");
      const suggestions = await suggestSimilarPaths(missing);

      expect(suggestions.length).toBeGreaterThan(0);
      const names = suggestions.map((s) => path.basename(s.path));
      expect(names).toContain("config.ts");
    });
  });

  describe("formatSuggestions", () => {
    it("should return empty string for no suggestions", () => {
      expect(formatSuggestions([])).toBe("");
    });

    it("should format suggestions with relative paths", () => {
      const suggestions = [
        { path: path.join(tmpDir, "config.ts"), distance: 1 },
        { path: path.join(tmpDir, "config.json"), distance: 2 },
      ];

      const result = formatSuggestions(suggestions, tmpDir);

      expect(result).toContain("Did you mean?");
      expect(result).toContain("config.ts");
      expect(result).toContain("config.json");
    });

    it("should use cwd as base when no baseDir provided", () => {
      const suggestions = [{ path: "/some/path/file.ts", distance: 1 }];
      const result = formatSuggestions(suggestions);

      expect(result).toContain("Did you mean?");
    });
  });
});
