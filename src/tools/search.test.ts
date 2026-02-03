/**
 * Tests for search tools
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFs = {
  stat: vi.fn(),
  readFile: vi.fn(),
};

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  default: mockFs,
}));

// Mock glob
vi.mock("glob", () => ({
  glob: vi.fn(),
}));

describe("grepTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct metadata", async () => {
    const { grepTool } = await import("./search.js");
    expect(grepTool.name).toBe("grep");
    expect(grepTool.category).toBe("file");
    expect(grepTool.description).toContain("Search");
  });

  it("should validate parameters", async () => {
    const { grepTool } = await import("./search.js");

    const result = grepTool.parameters.safeParse({});
    expect(result.success).toBe(false);

    const validResult = grepTool.parameters.safeParse({ pattern: "test" });
    expect(validResult.success).toBe(true);
  });

  it("should search single file", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
    });
    mockFs.readFile.mockResolvedValue("line one\ntest match here\nline three");

    const { grepTool } = await import("./search.js");

    const result = await grepTool.execute({
      pattern: "test",
      path: "/test/file.ts",
    });

    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.line).toBe(2);
    expect(result.matches[0]?.content).toContain("test match");
    expect(result.filesSearched).toBe(1);
  });

  it("should search directory with glob pattern", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });

    const { glob } = await import("glob");
    vi.mocked(glob).mockResolvedValue(["/project/src/a.ts", "/project/src/b.ts"]);

    mockFs.readFile.mockImplementation(async (path: unknown) => {
      if (String(path).includes("a.ts")) {
        return "function foo() {}\nconst bar = 1;";
      }
      return "const foo = 2;\nfunction bar() {}";
    });

    const { grepTool } = await import("./search.js");

    const result = await grepTool.execute({
      pattern: "foo",
      path: "/project",
      include: "**/*.ts",
    });

    expect(result.matches.length).toBe(2);
    expect(result.filesSearched).toBe(2);
    expect(result.filesWithMatches).toBe(2);
  });

  it("should include context lines", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
    });
    mockFs.readFile.mockResolvedValue(
      "line 1\nline 2\nmatch here\nline 4\nline 5"
    );

    const { grepTool } = await import("./search.js");

    const result = await grepTool.execute({
      pattern: "match",
      path: "/test/file.ts",
      contextLines: 1,
    });

    expect(result.matches[0]?.contextBefore).toEqual(["line 2"]);
    expect(result.matches[0]?.contextAfter).toEqual(["line 4"]);
  });

  it("should respect maxResults", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
    });
    mockFs.readFile.mockResolvedValue(
      "test 1\ntest 2\ntest 3\ntest 4\ntest 5\ntest 6"
    );

    const { grepTool } = await import("./search.js");

    const result = await grepTool.execute({
      pattern: "test",
      path: "/test/file.ts",
      maxResults: 3,
    });

    expect(result.matches.length).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("should support case insensitive search", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
    });
    mockFs.readFile.mockResolvedValue("TEST match\ntest match\nTest match");

    const { grepTool } = await import("./search.js");

    const result = await grepTool.execute({
      pattern: "test",
      path: "/test/file.ts",
      caseSensitive: false,
    });

    expect(result.matches.length).toBe(3);
  });

  it("should support whole word matching", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
    });
    mockFs.readFile.mockResolvedValue("test line\ntesting line\ntest again");

    const { grepTool } = await import("./search.js");

    const result = await grepTool.execute({
      pattern: "test",
      path: "/test/file.ts",
      wholeWord: true,
    });

    expect(result.matches.length).toBe(2); // "testing" should not match
  });

  it("should handle invalid regex pattern", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
    });

    const { grepTool } = await import("./search.js");

    await expect(
      grepTool.execute({
        pattern: "[invalid",
        path: "/test/file.ts",
      })
    ).rejects.toThrow(/Invalid regex/);
  });

  it("should skip unreadable files", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });

    const { glob } = await import("glob");
    vi.mocked(glob).mockResolvedValue(["/project/good.ts", "/project/bad.ts"]);

    mockFs.readFile.mockImplementation(async (path: unknown) => {
      if (String(path).includes("bad.ts")) {
        throw new Error("EACCES");
      }
      return "test match";
    });

    const { grepTool } = await import("./search.js");

    const result = await grepTool.execute({
      pattern: "test",
      path: "/project",
    });

    expect(result.matches.length).toBe(1);
    expect(result.filesSearched).toBe(2);
  });
});

describe("findInFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct metadata", async () => {
    const { findInFileTool } = await import("./search.js");
    expect(findInFileTool.name).toBe("find_in_file");
    expect(findInFileTool.category).toBe("file");
  });

  it("should validate parameters", async () => {
    const { findInFileTool } = await import("./search.js");

    const result = findInFileTool.parameters.safeParse({});
    expect(result.success).toBe(false);

    const missingPattern = findInFileTool.parameters.safeParse({ file: "/file.ts" });
    expect(missingPattern.success).toBe(false);

    const validResult = findInFileTool.parameters.safeParse({
      file: "/file.ts",
      pattern: "test",
    });
    expect(validResult.success).toBe(true);
  });

  it("should find matches in file", async () => {
    mockFs.readFile.mockResolvedValue(
      "line 1\ntest match\nline 3\ntest again\nline 5"
    );

    const { findInFileTool } = await import("./search.js");

    const result = await findInFileTool.execute({
      file: "/test/file.ts",
      pattern: "test",
    });

    expect(result.count).toBe(2);
    expect(result.matches[0]?.line).toBe(2);
    expect(result.matches[1]?.line).toBe(4);
  });

  it("should support case insensitive search", async () => {
    mockFs.readFile.mockResolvedValue("TEST line\ntest line\nTest line");

    const { findInFileTool } = await import("./search.js");

    const result = await findInFileTool.execute({
      file: "/test/file.ts",
      pattern: "test",
      caseSensitive: false,
    });

    expect(result.count).toBe(3);
  });

  it("should handle file read error", async () => {
    mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

    const { findInFileTool } = await import("./search.js");

    await expect(
      findInFileTool.execute({
        file: "/missing/file.ts",
        pattern: "test",
      })
    ).rejects.toThrow(/Find in file failed/);
  });

  it("should return empty results when no matches", async () => {
    mockFs.readFile.mockResolvedValue("line 1\nline 2\nline 3");

    const { findInFileTool } = await import("./search.js");

    const result = await findInFileTool.execute({
      file: "/test/file.ts",
      pattern: "notfound",
    });

    expect(result.count).toBe(0);
    expect(result.matches).toEqual([]);
  });

  it("should support regex patterns", async () => {
    mockFs.readFile.mockResolvedValue(
      "function foo() {}\nconst bar = 123;\nfunction baz() {}"
    );

    const { findInFileTool } = await import("./search.js");

    const result = await findInFileTool.execute({
      file: "/test/file.ts",
      pattern: "function \\w+",
    });

    expect(result.count).toBe(2);
  });
});

describe("searchTools", () => {
  it("should export all search tools", async () => {
    const { searchTools } = await import("./search.js");

    expect(searchTools).toBeDefined();
    expect(searchTools.length).toBe(2);
    expect(searchTools.some((t) => t.name === "grep")).toBe(true);
    expect(searchTools.some((t) => t.name === "find_in_file")).toBe(true);
  });
});
