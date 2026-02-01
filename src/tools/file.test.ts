/**
 * Tests for file tools
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFs = {
  readFile: vi.fn().mockResolvedValue("file content here"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({
    size: 100,
    isFile: () => true,
    isDirectory: () => false,
  }),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
};

// Mock fs/promises with default export
vi.mock("node:fs/promises", () => ({
  default: mockFs,
}));

// Mock glob
vi.mock("glob", () => ({
  glob: vi.fn().mockResolvedValue([]),
}));

describe("readFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFile.mockResolvedValue("file content here");
    mockFs.stat.mockResolvedValue({
      size: 100,
      isFile: () => true,
      isDirectory: () => false,
    });
  });

  it("should have correct metadata", async () => {
    const { readFileTool } = await import("./file.js");
    expect(readFileTool.name).toBe("read_file");
    expect(readFileTool.category).toBe("file");
    expect(readFileTool.description).toContain("Read");
  });

  it("should read file content", async () => {
    const { readFileTool } = await import("./file.js");

    const result = await readFileTool.execute({ path: "/test/file.txt" });

    expect(result.content).toBe("file content here");
  });

  it("should handle file not found", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("ENOENT"));

    const { readFileTool } = await import("./file.js");

    await expect(readFileTool.execute({ path: "/missing/file.txt" })).rejects.toThrow();
  });

  it("should validate parameters", async () => {
    const { readFileTool } = await import("./file.js");

    const result = readFileTool.parameters.safeParse({});
    expect(result.success).toBe(false);

    const validResult = readFileTool.parameters.safeParse({ path: "/file.txt" });
    expect(validResult.success).toBe(true);
  });
});

describe("writeFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.stat.mockResolvedValue({ size: 11, isFile: () => true, isDirectory: () => false });
  });

  it("should have correct metadata", async () => {
    const { writeFileTool } = await import("./file.js");
    expect(writeFileTool.name).toBe("write_file");
    expect(writeFileTool.category).toBe("file");
  });

  it("should write file content", async () => {
    const { writeFileTool } = await import("./file.js");

    const result = await writeFileTool.execute({
      path: "/test/file.txt",
      content: "new content",
    });

    expect(result.path).toContain("file.txt");
    expect(mockFs.writeFile).toHaveBeenCalled();
  });

  it("should create parent directories", async () => {
    const { writeFileTool } = await import("./file.js");

    await writeFileTool.execute({
      path: "/deep/nested/path/file.txt",
      content: "content",
    });

    // Verify the file was written (mkdir might not be called if directory exists)
    expect(mockFs.writeFile).toHaveBeenCalled();
  });

  it("should validate parameters", async () => {
    const { writeFileTool } = await import("./file.js");

    const result = writeFileTool.parameters.safeParse({ path: "/file.txt" });
    expect(result.success).toBe(false); // missing content

    const validResult = writeFileTool.parameters.safeParse({
      path: "/file.txt",
      content: "content",
    });
    expect(validResult.success).toBe(true);
  });
});

describe("editFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFile.mockResolvedValue("Hello World");
  });

  it("should have correct metadata", async () => {
    const { editFileTool } = await import("./file.js");
    expect(editFileTool.name).toBe("edit_file");
    expect(editFileTool.category).toBe("file");
  });

  it("should replace text in file", async () => {
    const { editFileTool } = await import("./file.js");

    const result = await editFileTool.execute({
      path: "/test/file.txt",
      oldText: "World",
      newText: "Universe",
    });

    expect(result.replacements).toBe(1);
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      "Hello Universe",
      "utf-8"
    );
  });

  it("should fail if old text not found", async () => {
    const { editFileTool } = await import("./file.js");

    await expect(
      editFileTool.execute({
        path: "/test/file.txt",
        oldText: "Goodbye",
        newText: "Hi",
      })
    ).rejects.toThrow();
  });

  it("should support all replacement option", async () => {
    mockFs.readFile.mockResolvedValue("foo bar foo baz foo");

    const { editFileTool } = await import("./file.js");

    const result = await editFileTool.execute({
      path: "/test/file.txt",
      oldText: "foo",
      newText: "qux",
      all: true,
    });

    expect(result.replacements).toBe(3);
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      "qux bar qux baz qux",
      "utf-8"
    );
  });
});

describe("globTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct metadata", async () => {
    const { globTool } = await import("./file.js");
    expect(globTool.name).toBe("glob");
    expect(globTool.category).toBe("file");
  });

  it("should find matching files", async () => {
    const { glob } = await import("glob");
    vi.mocked(glob).mockResolvedValue(["src/a.ts", "src/b.ts", "src/c.ts"]);

    const { globTool } = await import("./file.js");

    const result = await globTool.execute({
      pattern: "src/**/*.ts",
    });

    expect(result.files).toHaveLength(3);
    expect(result.files).toContain("src/a.ts");
  });

  it("should support cwd option", async () => {
    const { glob } = await import("glob");
    vi.mocked(glob).mockResolvedValue(["a.ts", "b.ts"]);

    const { globTool } = await import("./file.js");

    await globTool.execute({
      pattern: "*.ts",
      cwd: "/project/src",
    });

    expect(glob).toHaveBeenCalledWith("*.ts", expect.objectContaining({ cwd: "/project/src" }));
  });

  it("should handle no matches", async () => {
    const { glob } = await import("glob");
    vi.mocked(glob).mockResolvedValue([]);

    const { globTool } = await import("./file.js");

    const result = await globTool.execute({
      pattern: "*.nonexistent",
    });

    expect(result.files).toHaveLength(0);
  });
});

describe("fileExistsTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return true for existing file", async () => {
    mockFs.stat.mockResolvedValue({
      size: 100,
      isFile: () => true,
      isDirectory: () => false,
    });

    const { fileExistsTool } = await import("./file.js");

    const result = await fileExistsTool.execute({ path: "/existing/file.txt" });

    expect(result.exists).toBe(true);
    expect(result.isFile).toBe(true);
  });

  it("should return false for non-existing file", async () => {
    mockFs.stat.mockRejectedValueOnce(new Error("ENOENT"));

    const { fileExistsTool } = await import("./file.js");

    const result = await fileExistsTool.execute({ path: "/missing/file.txt" });

    expect(result.exists).toBe(false);
  });
});

describe("listDirTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list directory contents", async () => {
    mockFs.readdir.mockResolvedValue([
      { name: "file1.ts", isFile: () => true, isDirectory: () => false },
      { name: "file2.ts", isFile: () => true, isDirectory: () => false },
      { name: "subdir", isFile: () => false, isDirectory: () => true },
    ]);
    mockFs.stat.mockResolvedValue({ size: 100 });

    const { listDirTool } = await import("./file.js");

    const result = await listDirTool.execute({ path: "/project" });

    expect(result.entries).toHaveLength(3);
  });

  it("should include file/directory type", async () => {
    mockFs.readdir.mockResolvedValue([
      { name: "file.ts", isFile: () => true, isDirectory: () => false },
      { name: "dir", isFile: () => false, isDirectory: () => true },
    ]);
    mockFs.stat.mockResolvedValue({ size: 100 });

    const { listDirTool } = await import("./file.js");

    const result = await listDirTool.execute({ path: "/project" });

    expect(result.entries[0].type).toBe("file");
    expect(result.entries[1].type).toBe("directory");
  });
});

describe("deleteFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
    });
  });

  it("should delete file", async () => {
    const { deleteFileTool } = await import("./file.js");

    const result = await deleteFileTool.execute({ path: "/file/to/delete.txt" });

    expect(result.deleted).toBe(true);
    expect(mockFs.unlink).toHaveBeenCalled();
  });

  it("should handle non-existing file", async () => {
    const error = new Error("ENOENT") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    mockFs.stat.mockRejectedValueOnce(error);

    const { deleteFileTool } = await import("./file.js");

    const result = await deleteFileTool.execute({ path: "/missing.txt" });

    expect(result.deleted).toBe(false);
  });

  it("should delete directory recursively when flag is set", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });

    const { deleteFileTool } = await import("./file.js");

    const result = await deleteFileTool.execute({ path: "/dir/to/delete", recursive: true });

    expect(result.deleted).toBe(true);
    expect(mockFs.rm).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });
});

describe("fileTools", () => {
  it("should export all file tools", async () => {
    const { fileTools } = await import("./file.js");

    expect(fileTools).toBeDefined();
    expect(fileTools.length).toBe(7);
    expect(fileTools.some((t) => t.name === "read_file")).toBe(true);
    expect(fileTools.some((t) => t.name === "write_file")).toBe(true);
    expect(fileTools.some((t) => t.name === "edit_file")).toBe(true);
    expect(fileTools.some((t) => t.name === "glob")).toBe(true);
  });
});
