/**
 * Integration tests for file suggestions with deep search
 *
 * These tests verify that the file tools properly suggest similar files
 * when a path doesn't exist (ENOENT errors).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileTools } from "./file.js";
import { addAllowedPathToSession, clearSessionAllowedPaths } from "./allowed-paths.js";

// Helper to find a tool by name
function findTool(name: string) {
  const tool = fileTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("File suggestions integration", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coco-suggestions-test-"));
    // Add temp directory to allowed paths for the test
    addAllowedPathToSession(tempDir, "write");
    // Change to temp directory so relative paths work
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    clearSessionAllowedPaths();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("read_file tool", () => {
    it("should suggest similar files when file not found", async () => {
      // Create a file with similar name
      await fs.writeFile("config.json", '{"key": "value"}');

      const readFile = findTool("read_file");

      // Should throw but include suggestions in the error
      await expect(
        readFile.execute({
          path: "confg.json", // typo: missing 'i'
        }),
      ).rejects.toThrow(/config\.json/);
    });

    it("should find files in subdirectories with deep search", async () => {
      // Create nested structure
      await fs.mkdir(path.join("src", "components"), { recursive: true });
      await fs.writeFile(
        path.join("src", "components", "Button.tsx"),
        "export const Button = () => {}",
      );

      const readFile = findTool("read_file");

      // Should throw with suggestion of the deep file
      await expect(
        readFile.execute({
          path: "Button.tsx", // File is in src/components/
        }),
      ).rejects.toThrow(/src\/components\/Button\.tsx/);
    });
  });

  describe("write_file tool", () => {
    it("should suggest similar directories when path doesn't exist", async () => {
      // Create a similar directory name
      await fs.mkdir("src", { recursive: true });

      const writeFile = findTool("write_file");

      // Should throw suggesting src/
      await expect(
        writeFile.execute({
          path: path.join("srcc", "file.txt"), // typo: srcc instead of src
          content: "test content",
        }),
      ).rejects.toThrow(/src/);
    });
  });

  describe("tree tool", () => {
    it("should suggest similar directories when directory not found", async () => {
      // Create similar directory
      await fs.mkdir("components", { recursive: true });
      await fs.writeFile(path.join("components", "Button.tsx"), "");

      const tree = findTool("tree");

      // Should throw suggesting components/
      await expect(
        tree.execute({
          path: "componets", // typo
        }),
      ).rejects.toThrow(/components/);
    });
  });
});
