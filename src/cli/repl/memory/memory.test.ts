/**
 * Tests for Memory System
 *
 * Comprehensive tests for the memory/context file loading system,
 * including types, loader, and integration tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// types.ts Tests
// ============================================================================

describe("types.ts", () => {
  describe("MEMORY_LEVELS", () => {
    it("should contain user, project, and local levels", async () => {
      const { MEMORY_LEVELS } = await import("./types.js");

      expect(MEMORY_LEVELS).toContain("user");
      expect(MEMORY_LEVELS).toContain("project");
      expect(MEMORY_LEVELS).toContain("local");
    });

    it("should be in correct precedence order (lowest to highest)", async () => {
      const { MEMORY_LEVELS } = await import("./types.js");

      expect(MEMORY_LEVELS[0]).toBe("user");
      expect(MEMORY_LEVELS[1]).toBe("project");
      expect(MEMORY_LEVELS[2]).toBe("local");
    });

    it("should have exactly 3 levels", async () => {
      const { MEMORY_LEVELS } = await import("./types.js");

      expect(MEMORY_LEVELS).toHaveLength(3);
    });

    it("should be a readonly tuple defined with as const", async () => {
      const { MEMORY_LEVELS } = await import("./types.js");

      // TypeScript readonly arrays (as const) are not runtime-frozen but are typed readonly
      // We just verify the array exists and has the right structure
      expect(Array.isArray(MEMORY_LEVELS)).toBe(true);
      expect(MEMORY_LEVELS).toEqual(["user", "project", "local"]);
    });
  });

  describe("DEFAULT_FILE_PATTERNS", () => {
    it("should include COCO.md as first pattern", async () => {
      const { DEFAULT_FILE_PATTERNS } = await import("./types.js");

      expect(DEFAULT_FILE_PATTERNS[0]).toBe("COCO.md");
    });

    it("should include CLAUDE.md as fallback pattern", async () => {
      const { DEFAULT_FILE_PATTERNS } = await import("./types.js");

      expect(DEFAULT_FILE_PATTERNS).toContain("CLAUDE.md");
    });

    it("should have exactly 2 patterns", async () => {
      const { DEFAULT_FILE_PATTERNS } = await import("./types.js");

      expect(DEFAULT_FILE_PATTERNS).toHaveLength(2);
    });
  });

  describe("createDefaultMemoryConfig()", () => {
    it("should return valid config with default values", async () => {
      const { createDefaultMemoryConfig, MEMORY_DEFAULTS, DEFAULT_FILE_PATTERNS } =
        await import("./types.js");

      const config = createDefaultMemoryConfig();

      expect(config.maxImportDepth).toBe(MEMORY_DEFAULTS.maxImportDepth);
      expect(config.maxTotalSize).toBe(MEMORY_DEFAULTS.maxTotalSize);
      expect(config.includeUserLevel).toBe(MEMORY_DEFAULTS.includeUserLevel);
      expect(config.filePatterns).toEqual([...DEFAULT_FILE_PATTERNS]);
    });

    it("should allow partial overrides", async () => {
      const { createDefaultMemoryConfig } = await import("./types.js");

      const config = createDefaultMemoryConfig({ maxImportDepth: 3 });

      expect(config.maxImportDepth).toBe(3);
      expect(config.maxTotalSize).toBe(100_000); // default preserved
    });

    it("should allow overriding all properties", async () => {
      const { createDefaultMemoryConfig } = await import("./types.js");

      const config = createDefaultMemoryConfig({
        maxImportDepth: 2,
        maxTotalSize: 50_000,
        filePatterns: ["CUSTOM.md"],
        includeUserLevel: false,
      });

      expect(config.maxImportDepth).toBe(2);
      expect(config.maxTotalSize).toBe(50_000);
      expect(config.filePatterns).toEqual(["CUSTOM.md"]);
      expect(config.includeUserLevel).toBe(false);
    });

    it("should not share filePatterns array with constants", async () => {
      const { createDefaultMemoryConfig, DEFAULT_FILE_PATTERNS } = await import("./types.js");

      const config = createDefaultMemoryConfig();
      config.filePatterns.push("NEW.md");

      // Original constant should not be modified
      expect(DEFAULT_FILE_PATTERNS).toHaveLength(2);
    });
  });

  describe("createEmptyMemoryContext()", () => {
    it("should return empty context", async () => {
      const { createEmptyMemoryContext } = await import("./types.js");

      const context = createEmptyMemoryContext();

      expect(context.files).toEqual([]);
      expect(context.combinedContent).toBe("");
      expect(context.totalSize).toBe(0);
      expect(context.errors).toEqual([]);
    });

    it("should return new instances each call", async () => {
      const { createEmptyMemoryContext } = await import("./types.js");

      const context1 = createEmptyMemoryContext();
      const context2 = createEmptyMemoryContext();

      expect(context1).not.toBe(context2);
      expect(context1.files).not.toBe(context2.files);
      expect(context1.errors).not.toBe(context2.errors);
    });
  });

  describe("createMissingMemoryFile()", () => {
    it("should create placeholder with correct path and level", async () => {
      const { createMissingMemoryFile } = await import("./types.js");

      const file = createMissingMemoryFile("/project/COCO.md", "project");

      expect(file.path).toBe("/project/COCO.md");
      expect(file.level).toBe("project");
    });

    it("should set exists to false", async () => {
      const { createMissingMemoryFile } = await import("./types.js");

      const file = createMissingMemoryFile("/path/to/file.md", "user");

      expect(file.exists).toBe(false);
    });

    it("should have empty content and arrays", async () => {
      const { createMissingMemoryFile } = await import("./types.js");

      const file = createMissingMemoryFile("/path/to/file.md", "local");

      expect(file.content).toBe("");
      expect(file.sections).toEqual([]);
      expect(file.imports).toEqual([]);
    });

    it("should set modifiedAt to epoch (Date(0))", async () => {
      const { createMissingMemoryFile } = await import("./types.js");

      const file = createMissingMemoryFile("/path/to/file.md", "project");

      expect(file.modifiedAt.getTime()).toBe(0);
    });
  });

  describe("createMemorySection()", () => {
    it("should create section with all properties", async () => {
      const { createMemorySection } = await import("./types.js");

      const section = createMemorySection("Code Style", "- Use 2-space indent", 10, 15);

      expect(section.title).toBe("Code Style");
      expect(section.content).toBe("- Use 2-space indent");
      expect(section.startLine).toBe(10);
      expect(section.endLine).toBe(15);
    });
  });
});

// ============================================================================
// loader.ts Tests
// ============================================================================

describe("loader.ts", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("createMemoryLoader()", () => {
    it("should create a MemoryLoader instance", async () => {
      const { createMemoryLoader, MemoryLoader } = await import("./loader.js");

      const loader = createMemoryLoader();

      expect(loader).toBeInstanceOf(MemoryLoader);
    });

    it("should accept partial configuration", async () => {
      const { createMemoryLoader } = await import("./loader.js");

      const loader = createMemoryLoader({ maxImportDepth: 2 });

      // Configuration is internal but we can test it affects behavior
      expect(loader).toBeDefined();
    });
  });

  describe("loadFile()", () => {
    it("should load existing file", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const filePath = path.join(tempDir, "COCO.md");
      await fs.writeFile(filePath, "# Test Memory\n\n## Section\nContent here", "utf-8");

      const file = await loader.loadFile(filePath, "project");

      expect(file.exists).toBe(true);
      expect(file.path).toBe(filePath);
      expect(file.level).toBe("project");
      expect(file.content).toContain("Content here");
    });

    it("should handle non-existent file gracefully", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const nonExistentPath = path.join(tempDir, "nonexistent.md");

      const file = await loader.loadFile(nonExistentPath, "project");

      expect(file.exists).toBe(false);
      expect(file.content).toBe("");
      expect(file.sections).toEqual([]);
    });

    it("should parse modification time", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const filePath = path.join(tempDir, "COCO.md");
      await fs.writeFile(filePath, "Content", "utf-8");

      const file = await loader.loadFile(filePath, "project");

      expect(file.modifiedAt).toBeInstanceOf(Date);
      expect(file.modifiedAt.getTime()).toBeGreaterThan(0);
    });
  });

  describe("findMemoryFiles()", () => {
    it("should find project-level file (COCO.md)", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ includeUserLevel: false });

      const cocoPath = path.join(tempDir, "COCO.md");
      await fs.writeFile(cocoPath, "# Project Memory", "utf-8");

      const paths = await loader.findMemoryFiles(tempDir);

      expect(paths.project).toBe(cocoPath);
    });

    it("should find project-level file (CLAUDE.md fallback)", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ includeUserLevel: false });

      const claudePath = path.join(tempDir, "CLAUDE.md");
      await fs.writeFile(claudePath, "# Claude Memory", "utf-8");

      const paths = await loader.findMemoryFiles(tempDir);

      expect(paths.project).toBe(claudePath);
    });

    it("should prefer COCO.md over CLAUDE.md", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ includeUserLevel: false });

      const cocoPath = path.join(tempDir, "COCO.md");
      const claudePath = path.join(tempDir, "CLAUDE.md");
      await fs.writeFile(cocoPath, "# COCO Memory", "utf-8");
      await fs.writeFile(claudePath, "# CLAUDE Memory", "utf-8");

      const paths = await loader.findMemoryFiles(tempDir);

      expect(paths.project).toBe(cocoPath);
    });

    it("should find local-level file (COCO.local.md)", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ includeUserLevel: false });

      const localPath = path.join(tempDir, "COCO.local.md");
      await fs.writeFile(localPath, "# Local Memory", "utf-8");

      const paths = await loader.findMemoryFiles(tempDir);

      expect(paths.local).toBe(localPath);
    });

    it("should find local-level file (CLAUDE.local.md)", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ includeUserLevel: false });

      const localPath = path.join(tempDir, "CLAUDE.local.md");
      await fs.writeFile(localPath, "# Local Memory", "utf-8");

      const paths = await loader.findMemoryFiles(tempDir);

      expect(paths.local).toBe(localPath);
    });

    it("should return empty paths when no files exist", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ includeUserLevel: false });

      const paths = await loader.findMemoryFiles(tempDir);

      expect(paths.project).toBeUndefined();
      expect(paths.local).toBeUndefined();
    });
  });

  describe("parseSections()", () => {
    it("should parse markdown sections", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      // Note: Content before first ## heading creates an implicit section
      const content = `## Code Style
- Use 2-space indent
- Prefer const

## Testing
Write tests first`;

      const sections = loader.parseSections(content);

      expect(sections).toHaveLength(2);
      expect(sections[0]?.title).toBe("Code Style");
      expect(sections[0]?.content).toContain("Use 2-space indent");
      expect(sections[1]?.title).toBe("Testing");
      expect(sections[1]?.content).toContain("Write tests first");
    });

    it("should create implicit section for content before first heading", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const content = `# Main Title
Some intro content

## Section
Section content`;

      const sections = loader.parseSections(content);

      // Content before ## creates implicit section with empty title
      expect(sections).toHaveLength(2);
      expect(sections[0]?.title).toBe("");
      expect(sections[0]?.content).toContain("Main Title");
      expect(sections[1]?.title).toBe("Section");
    });

    it("should handle content with no sections", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const content = `Just some plain content
without any headings`;

      const sections = loader.parseSections(content);

      expect(sections).toHaveLength(1);
      expect(sections[0]?.title).toBe("");
      expect(sections[0]?.content).toContain("Just some plain content");
    });

    it("should track line numbers correctly", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const content = `## First
Content

## Second
More content`;

      const sections = loader.parseSections(content);

      expect(sections[0]?.startLine).toBe(1);
      // endLine is set to lineNumber - 1 when next section starts (line 4 - 1 = 3)
      expect(sections[0]?.endLine).toBe(3);
      expect(sections[1]?.startLine).toBe(4);
      // Last section's endLine is set to total lines
      expect(sections[1]?.endLine).toBe(5);
    });

    it("should handle empty content", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const sections = loader.parseSections("");

      expect(sections).toEqual([]);
    });

    it("should handle content with only whitespace", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const sections = loader.parseSections("   \n\n   ");

      expect(sections).toEqual([]);
    });
  });

  describe("resolveImports()", () => {
    it("should resolve valid imports", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      // Create an import target file
      const importFile = path.join(tempDir, "imported.md");
      await fs.writeFile(importFile, "Imported content here", "utf-8");

      const content = `Main content

@${importFile}

More content`;

      const result = await loader.resolveImports(content, tempDir, 0);

      expect(result.content).toContain("Imported content here");
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]?.resolved).toBe(true);
    });

    it("should handle missing imports gracefully", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const content = `Main content

@./nonexistent.md

More content`;

      const result = await loader.resolveImports(content, tempDir, 0);

      expect(result.content).toContain("Import not found");
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]?.resolved).toBe(false);
      expect(result.imports[0]?.error).toContain("File not found");
    });

    it("should respect max depth", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ maxImportDepth: 2 });

      // Create nested import files
      const file1 = path.join(tempDir, "level1.md");
      const file2 = path.join(tempDir, "level2.md");
      const file3 = path.join(tempDir, "level3.md");

      await fs.writeFile(file3, "Level 3 content", "utf-8");
      await fs.writeFile(file2, `Level 2\n@${file3}`, "utf-8");
      await fs.writeFile(file1, `Level 1\n@${file2}`, "utf-8");

      const content = `Root\n@${file1}`;
      const result = await loader.resolveImports(content, tempDir, 0);

      // At depth 0, it should import level1
      // At depth 1, it should import level2
      // At depth 2, it should NOT process level3 import (max depth reached)
      expect(result.content).toContain("Level 1");
      expect(result.content).toContain("Level 2");
      // level3.md import should be in result.content as raw @path because we hit max depth
      expect(result.imports.length).toBeGreaterThan(0);
    });

    it("should add comment markers around imported content", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const importFile = path.join(tempDir, "styles.md");
      await fs.writeFile(importFile, "Style rules", "utf-8");

      const content = `@${importFile}`;
      const result = await loader.resolveImports(content, tempDir, 0);

      expect(result.content).toContain("<!-- Imported from:");
      expect(result.content).toContain("<!-- End import:");
    });

    it("should track line numbers for imports", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const importFile = path.join(tempDir, "test.md");
      await fs.writeFile(importFile, "Test", "utf-8");

      const content = `Line 1
Line 2
@${importFile}
Line 4`;

      const result = await loader.resolveImports(content, tempDir, 0);

      expect(result.imports[0]?.line).toBe(3);
    });

    it("should handle relative path imports", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const subDir = path.join(tempDir, "docs");
      await fs.mkdir(subDir, { recursive: true });
      const importFile = path.join(subDir, "guide.md");
      await fs.writeFile(importFile, "Guide content", "utf-8");

      const content = `@./docs/guide.md`;
      const result = await loader.resolveImports(content, tempDir, 0);

      expect(result.content).toContain("Guide content");
      expect(result.imports[0]?.resolved).toBe(true);
    });
  });

  describe("combineMemory()", () => {
    it("should merge files in correct order", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const files = [
        {
          path: "/home/user/.coco/COCO.md",
          level: "user" as const,
          content: "User level content",
          sections: [],
          imports: [],
          modifiedAt: new Date(),
          exists: true,
        },
        {
          path: "/project/COCO.md",
          level: "project" as const,
          content: "Project level content",
          sections: [],
          imports: [],
          modifiedAt: new Date(),
          exists: true,
        },
      ];

      const combined = loader.combineMemory(files);

      // User level should appear before project level
      const userIndex = combined.indexOf("User level content");
      const projectIndex = combined.indexOf("Project level content");
      expect(userIndex).toBeLessThan(projectIndex);
    });

    it("should add level markers", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const files = [
        {
          path: "/project/COCO.md",
          level: "project" as const,
          content: "Content",
          sections: [],
          imports: [],
          modifiedAt: new Date(),
          exists: true,
        },
      ];

      const combined = loader.combineMemory(files);

      expect(combined).toContain("<!-- Memory: project level");
      expect(combined).toContain("COCO.md");
    });

    it("should skip non-existent files", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const files = [
        {
          path: "/project/missing.md",
          level: "project" as const,
          content: "",
          sections: [],
          imports: [],
          modifiedAt: new Date(0),
          exists: false,
        },
      ];

      const combined = loader.combineMemory(files);

      expect(combined).toBe("");
    });

    it("should skip files with empty content", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const files = [
        {
          path: "/project/empty.md",
          level: "project" as const,
          content: "   \n\n   ",
          sections: [],
          imports: [],
          modifiedAt: new Date(),
          exists: true,
        },
      ];

      const combined = loader.combineMemory(files);

      expect(combined).toBe("");
    });

    it("should return empty string for empty array", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader();

      const combined = loader.combineMemory([]);

      expect(combined).toBe("");
    });
  });

  describe("loadMemory() - Full Integration", () => {
    it("should load complete memory context", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ includeUserLevel: false });

      // Create project-level memory file
      const cocoPath = path.join(tempDir, "COCO.md");
      await fs.writeFile(
        cocoPath,
        `# Project Memory

## Code Style
Use TypeScript with strict mode

## Testing
Run tests with vitest`,
        "utf-8",
      );

      const context = await loader.loadMemory(tempDir);

      expect(context.files).toHaveLength(1);
      expect(context.files[0]?.exists).toBe(true);
      expect(context.combinedContent).toContain("Code Style");
      expect(context.totalSize).toBeGreaterThan(0);
      expect(context.errors).toHaveLength(0);
    });

    it("should collect errors for failed imports", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ includeUserLevel: false });

      // Create memory file with invalid import
      const cocoPath = path.join(tempDir, "COCO.md");
      await fs.writeFile(
        cocoPath,
        `# Memory

@./nonexistent-file.md`,
        "utf-8",
      );

      const context = await loader.loadMemory(tempDir);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]?.error).toContain("Import failed");
      expect(context.errors[0]?.recoverable).toBe(true);
    });

    it("should warn when total size exceeds limit", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({
        includeUserLevel: false,
        maxTotalSize: 10, // Very small limit
      });

      const cocoPath = path.join(tempDir, "COCO.md");
      await fs.writeFile(cocoPath, "This content is longer than 10 characters", "utf-8");

      const context = await loader.loadMemory(tempDir);

      expect(context.errors.some((e) => e.error.includes("exceeds limit"))).toBe(true);
    });

    it("should skip user level when disabled", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ includeUserLevel: false });

      const context = await loader.loadMemory(tempDir);

      // User level file should not be searched for
      expect(context.files.every((f) => f.level !== "user")).toBe(true);
    });

    it("should handle project with no memory files", async () => {
      const { createMemoryLoader } = await import("./loader.js");
      const loader = createMemoryLoader({ includeUserLevel: false });

      const context = await loader.loadMemory(tempDir);

      expect(context.files).toHaveLength(0);
      expect(context.combinedContent).toBe("");
      expect(context.totalSize).toBe(0);
    });
  });
});

// ============================================================================
// Integration Tests with Real Project
// ============================================================================

describe("Integration tests", () => {
  it("should load actual CLAUDE.md from project root", async () => {
    const { createMemoryLoader } = await import("./loader.js");
    const loader = createMemoryLoader({ includeUserLevel: false });

    // Load from the actual project root (src/cli/repl/memory -> project root)
    // __dirname equivalent in ESM: use import.meta.url
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const projectRoot = path.resolve(currentDir, "../../../..");
    const context = await loader.loadMemory(projectRoot);

    // CLAUDE.md exists in the project root
    expect(context.files.length).toBeGreaterThanOrEqual(1);
    const projectFile = context.files.find((f) => f.level === "project");

    if (projectFile && projectFile.exists) {
      expect(projectFile.path).toContain("CLAUDE.md");
      expect(projectFile.content).toContain("Corbat-Coco");
    }
  });

  it("should have correct memory context structure", async () => {
    const { createEmptyMemoryContext } = await import("./types.js");

    const emptyContext = createEmptyMemoryContext();

    // Verify the structure matches the interface
    expect(emptyContext).toHaveProperty("files");
    expect(emptyContext).toHaveProperty("combinedContent");
    expect(emptyContext).toHaveProperty("totalSize");
    expect(emptyContext).toHaveProperty("errors");
    expect(Array.isArray(emptyContext.files)).toBe(true);
    expect(Array.isArray(emptyContext.errors)).toBe(true);
    expect(typeof emptyContext.combinedContent).toBe("string");
    expect(typeof emptyContext.totalSize).toBe("number");
  });

  it("should parse sections correctly from real file", async () => {
    const { createMemoryLoader } = await import("./loader.js");
    const loader = createMemoryLoader({ includeUserLevel: false });

    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const projectRoot = path.resolve(currentDir, "../../../..");
    const context = await loader.loadMemory(projectRoot);

    const projectFile = context.files.find((f) => f.level === "project" && f.exists);

    if (projectFile) {
      // CLAUDE.md has sections like "Build & Development", "Coding Style", etc.
      expect(projectFile.sections.length).toBeGreaterThan(0);

      // At least one section should have a title
      const sectionsWithTitles = projectFile.sections.filter((s) => s.title.length > 0);
      expect(sectionsWithTitles.length).toBeGreaterThan(0);
    }
  });

  it("should calculate total size correctly", async () => {
    const { createMemoryLoader } = await import("./loader.js");
    const loader = createMemoryLoader({ includeUserLevel: false });

    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const projectRoot = path.resolve(currentDir, "../../../..");
    const context = await loader.loadMemory(projectRoot);

    expect(context.totalSize).toBe(context.combinedContent.length);
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe("Edge cases", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-edge-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should handle circular import references gracefully via max depth", async () => {
    const { createMemoryLoader } = await import("./loader.js");
    const loader = createMemoryLoader({ maxImportDepth: 3 });

    // Create files that reference each other
    const fileA = path.join(tempDir, "a.md");
    const fileB = path.join(tempDir, "b.md");

    await fs.writeFile(fileA, `File A\n@${fileB}`, "utf-8");
    await fs.writeFile(fileB, `File B\n@${fileA}`, "utf-8");

    const content = `Main\n@${fileA}`;
    const result = await loader.resolveImports(content, tempDir, 0);

    // Should not hang or crash - max depth prevents infinite loop
    expect(result.content).toContain("File A");
    expect(result.content).toContain("File B");
  });

  it("should handle special characters in file paths", async () => {
    const { createMemoryLoader } = await import("./loader.js");
    const loader = createMemoryLoader({ includeUserLevel: false });

    const specialDir = path.join(tempDir, "special-dir_123");
    await fs.mkdir(specialDir, { recursive: true });
    const filePath = path.join(specialDir, "COCO.md");
    await fs.writeFile(filePath, "Content with special-path", "utf-8");

    const context = await loader.loadMemory(specialDir);

    expect(context.files[0]?.exists).toBe(true);
    expect(context.combinedContent).toContain("Content with special-path");
  });

  it("should handle Unicode content", async () => {
    const { createMemoryLoader } = await import("./loader.js");
    const loader = createMemoryLoader({ includeUserLevel: false });

    const filePath = path.join(tempDir, "COCO.md");
    const unicodeContent = "# Unicode Test\n\n## Japanese\n日本語テスト\n\n## Emoji\n";
    await fs.writeFile(filePath, unicodeContent, "utf-8");

    const context = await loader.loadMemory(tempDir);

    expect(context.combinedContent).toContain("日本語テスト");
  });

  it("should handle files with only headings", async () => {
    const { createMemoryLoader } = await import("./loader.js");
    const loader = createMemoryLoader();

    const content = `## Section 1

## Section 2

## Section 3`;

    const sections = loader.parseSections(content);

    expect(sections).toHaveLength(3);
    sections.forEach((section) => {
      expect(section.content.trim()).toBe("");
    });
  });

  it("should handle deeply nested import paths", async () => {
    const { createMemoryLoader } = await import("./loader.js");
    const loader = createMemoryLoader();

    // Create deep directory structure
    const deepPath = path.join(tempDir, "a", "b", "c", "d");
    await fs.mkdir(deepPath, { recursive: true });
    const deepFile = path.join(deepPath, "deep.md");
    await fs.writeFile(deepFile, "Deep content", "utf-8");

    const content = `@./a/b/c/d/deep.md`;
    const result = await loader.resolveImports(content, tempDir, 0);

    expect(result.content).toContain("Deep content");
  });

  it("should handle import at start of file", async () => {
    const { createMemoryLoader } = await import("./loader.js");
    const loader = createMemoryLoader();

    const importFile = path.join(tempDir, "header.md");
    await fs.writeFile(importFile, "Header content", "utf-8");

    const content = `@${importFile}
Rest of content`;

    const result = await loader.resolveImports(content, tempDir, 0);

    expect(result.content).toContain("Header content");
    expect(result.content).toContain("Rest of content");
  });

  it("should handle import at end of file", async () => {
    const { createMemoryLoader } = await import("./loader.js");
    const loader = createMemoryLoader();

    const importFile = path.join(tempDir, "footer.md");
    await fs.writeFile(importFile, "Footer content", "utf-8");

    const content = `Start of content
@${importFile}`;

    const result = await loader.resolveImports(content, tempDir, 0);

    expect(result.content).toContain("Start of content");
    expect(result.content).toContain("Footer content");
  });
});
