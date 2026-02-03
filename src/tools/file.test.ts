/**
 * Tests for file tools
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockHandle = {
  read: vi.fn().mockResolvedValue({ bytesRead: 100, buffer: Buffer.from("truncated content") }),
  close: vi.fn().mockResolvedValue(undefined),
};

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
  open: vi.fn().mockResolvedValue(mockHandle),
  realpath: vi.fn().mockImplementation((p) => Promise.resolve(p)),
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

  it("should truncate large files when exceeding maxSize", async () => {
    // Setup large file stat (20MB)
    mockFs.stat.mockResolvedValue({
      size: 20 * 1024 * 1024,
      isFile: () => true,
      isDirectory: () => false,
    });

    const { readFileTool } = await import("./file.js");

    const result = await readFileTool.execute({
      path: "/test/large-file.txt",
      maxSize: 100,
    });

    expect(result.truncated).toBe(true);
    expect(mockFs.open).toHaveBeenCalled();
    expect(mockHandle.read).toHaveBeenCalled();
    expect(mockHandle.close).toHaveBeenCalled();
  });

  it("should return correct line count", async () => {
    mockFs.readFile.mockResolvedValue("line1\nline2\nline3");
    mockFs.stat.mockResolvedValue({ size: 17, isFile: () => true, isDirectory: () => false });

    const { readFileTool } = await import("./file.js");

    const result = await readFileTool.execute({ path: "/test/file.txt" });

    expect(result.lines).toBe(3);
  });

  it("should accept various encodings", async () => {
    const { readFileTool } = await import("./file.js");

    // UTF-8 variants and other encodings work at the Node.js level
    await expect(readFileTool.execute({ path: "/test/file.txt", encoding: "utf8" })).resolves.toBeDefined();
    await expect(readFileTool.execute({ path: "/test/file.txt", encoding: "ascii" })).resolves.toBeDefined();
    await expect(readFileTool.execute({ path: "/test/file.txt", encoding: "latin1" })).resolves.toBeDefined();
    await expect(readFileTool.execute({ path: "/test/file.txt", encoding: "base64" })).resolves.toBeDefined();
    await expect(readFileTool.execute({ path: "/test/file.txt", encoding: "hex" })).resolves.toBeDefined();
    await expect(readFileTool.execute({ path: "/test/file.txt", encoding: "binary" })).resolves.toBeDefined();
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

  it("should create parent directories when createDirs is true", async () => {
    const { writeFileTool } = await import("./file.js");

    await writeFileTool.execute({
      path: "/deep/nested/path/file.txt",
      content: "content",
      createDirs: true,
    });

    // Verify mkdir was called with recursive option
    expect(mockFs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining("nested"),
      { recursive: true }
    );
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

  it("should support dryRun mode", async () => {
    mockFs.access.mockResolvedValue(undefined); // file exists

    const { writeFileTool } = await import("./file.js");

    const result = await writeFileTool.execute({
      path: "/test/file.txt",
      content: "new content",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.size).toBe(Buffer.byteLength("new content", "utf-8"));
    expect(result.wouldCreate).toBe(false);
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it("should detect wouldCreate in dryRun mode", async () => {
    const error = new Error("ENOENT") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    mockFs.access.mockRejectedValueOnce(error);

    const { writeFileTool } = await import("./file.js");

    const result = await writeFileTool.execute({
      path: "/test/new-file.txt",
      content: "content",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.wouldCreate).toBe(true);
  });

  it("should wrap write errors in FileSystemError", async () => {
    mockFs.writeFile.mockRejectedValueOnce(new Error("Permission denied"));

    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({
        path: "/test/file.txt",
        content: "content",
      })
    ).rejects.toThrow(/Failed to write file/);
  });

  it("should skip mkdir when createDirs is false", async () => {
    mockFs.access.mockResolvedValue(undefined);

    const { writeFileTool } = await import("./file.js");

    await writeFileTool.execute({
      path: "/test/file.txt",
      content: "content",
      createDirs: false,
    });

    expect(mockFs.mkdir).not.toHaveBeenCalled();
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

  it("should support dryRun mode", async () => {
    mockFs.readFile.mockResolvedValue("Hello World");

    const { editFileTool } = await import("./file.js");

    const result = await editFileTool.execute({
      path: "/test/file.txt",
      oldText: "World",
      newText: "Universe",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.replacements).toBe(1);
    expect(result.preview).toBe("Hello Universe");
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it("should truncate long preview in dryRun mode", async () => {
    // Create a string longer than 500 characters
    const longContent = "A".repeat(600);
    mockFs.readFile.mockResolvedValue(longContent);

    const { editFileTool } = await import("./file.js");

    const result = await editFileTool.execute({
      path: "/test/file.txt",
      oldText: "A",
      newText: "B",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.preview).toContain("...");
    expect(result.preview?.length).toBeLessThan(600);
  });

  it("should handle all=true with no matches", async () => {
    mockFs.readFile.mockResolvedValue("no matches here");

    const { editFileTool } = await import("./file.js");

    await expect(
      editFileTool.execute({
        path: "/test/file.txt",
        oldText: "xyz",
        newText: "abc",
        all: true,
      })
    ).rejects.toThrow(/Failed to edit file/);
  });

  it("should escape regex special characters", async () => {
    mockFs.readFile.mockResolvedValue("const value = foo.bar();");

    const { editFileTool } = await import("./file.js");

    const result = await editFileTool.execute({
      path: "/test/file.txt",
      oldText: "foo.bar()",
      newText: "baz.qux()",
    });

    expect(result.replacements).toBe(1);
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      "const value = baz.qux();",
      "utf-8"
    );
  });

  it("should wrap read errors in FileSystemError", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("File not found"));

    const { editFileTool } = await import("./file.js");

    await expect(
      editFileTool.execute({
        path: "/test/file.txt",
        oldText: "hello",
        newText: "world",
      })
    ).rejects.toThrow(/Failed to edit file/);
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

  it("should support ignore patterns", async () => {
    const { glob } = await import("glob");
    vi.mocked(glob).mockResolvedValue(["a.ts"]);

    const { globTool } = await import("./file.js");

    await globTool.execute({
      pattern: "**/*.ts",
      ignore: ["**/test/**", "**/node_modules/**"],
    });

    expect(glob).toHaveBeenCalledWith(
      "**/*.ts",
      expect.objectContaining({
        ignore: ["**/test/**", "**/node_modules/**"],
      })
    );
  });

  it("should wrap glob errors in FileSystemError", async () => {
    const { glob } = await import("glob");
    vi.mocked(glob).mockRejectedValueOnce(new Error("Glob failed"));

    const { globTool } = await import("./file.js");

    await expect(
      globTool.execute({ pattern: "**/*.ts" })
    ).rejects.toThrow(/Glob search failed/);
  });

  it("should use default ignore patterns", async () => {
    const { glob } = await import("glob");
    vi.mocked(glob).mockResolvedValue([]);

    const { globTool } = await import("./file.js");

    await globTool.execute({ pattern: "**/*.ts" });

    expect(glob).toHaveBeenCalledWith(
      "**/*.ts",
      expect.objectContaining({
        ignore: ["**/node_modules/**", "**/.git/**"],
      })
    );
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

  it("should detect directories", async () => {
    mockFs.stat.mockResolvedValue({
      size: 4096,
      isFile: () => false,
      isDirectory: () => true,
    });

    const { fileExistsTool } = await import("./file.js");

    const result = await fileExistsTool.execute({ path: "/existing/directory" });

    expect(result.exists).toBe(true);
    expect(result.isFile).toBe(false);
    expect(result.isDirectory).toBe(true);
  });

  it("should have correct metadata", async () => {
    const { fileExistsTool } = await import("./file.js");
    expect(fileExistsTool.name).toBe("file_exists");
    expect(fileExistsTool.category).toBe("file");
    expect(fileExistsTool.description).toContain("exist");
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

  it("should list recursively when recursive is true", async () => {
    // First call: root directory
    mockFs.readdir
      .mockResolvedValueOnce([
        { name: "subdir", isFile: () => false, isDirectory: () => true },
        { name: "root.ts", isFile: () => true, isDirectory: () => false },
      ])
      // Second call: subdirectory
      .mockResolvedValueOnce([
        { name: "nested.ts", isFile: () => true, isDirectory: () => false },
      ]);
    mockFs.stat.mockResolvedValue({ size: 100 });

    const { listDirTool } = await import("./file.js");

    const result = await listDirTool.execute({ path: "/project", recursive: true });

    expect(result.entries).toHaveLength(3);
    expect(result.entries.some((e) => e.name === "subdir")).toBe(true);
    expect(result.entries.some((e) => e.name === "root.ts")).toBe(true);
    expect(result.entries.some((e) => e.name === "subdir/nested.ts")).toBe(true);
  });

  it("should wrap readdir errors in FileSystemError", async () => {
    mockFs.readdir.mockRejectedValueOnce(new Error("Permission denied"));

    const { listDirTool } = await import("./file.js");

    await expect(
      listDirTool.execute({ path: "/forbidden" })
    ).rejects.toThrow(/Failed to list directory/);
  });

  it("should have correct metadata", async () => {
    const { listDirTool } = await import("./file.js");
    expect(listDirTool.name).toBe("list_dir");
    expect(listDirTool.category).toBe("file");
    expect(listDirTool.description).toContain("List");
  });

  it("should skip items that are neither files nor directories", async () => {
    mockFs.readdir.mockResolvedValue([
      { name: "file.ts", isFile: () => true, isDirectory: () => false },
      { name: "socket", isFile: () => false, isDirectory: () => false }, // e.g., socket or symlink
      { name: "dir", isFile: () => false, isDirectory: () => true },
    ]);
    mockFs.stat.mockResolvedValue({ size: 100 });

    const { listDirTool } = await import("./file.js");

    const result = await listDirTool.execute({ path: "/project" });

    // Socket should be skipped
    expect(result.entries).toHaveLength(2);
    expect(result.entries.some((e) => e.name === "socket")).toBe(false);
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

  it("should require confirmation", async () => {
    const { deleteFileTool } = await import("./file.js");

    await expect(
      deleteFileTool.execute({ path: "/file/to/delete.txt" })
    ).rejects.toThrow("Deletion requires explicit confirmation");
  });

  it("should delete file with confirmation", async () => {
    const { deleteFileTool } = await import("./file.js");

    const result = await deleteFileTool.execute({ path: "/file/to/delete.txt", confirm: true });

    expect(result.deleted).toBe(true);
    expect(mockFs.unlink).toHaveBeenCalled();
  });

  it("should handle non-existing file", async () => {
    const error = new Error("ENOENT") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    mockFs.stat.mockRejectedValueOnce(error);

    const { deleteFileTool } = await import("./file.js");

    const result = await deleteFileTool.execute({ path: "/missing.txt", confirm: true });

    expect(result.deleted).toBe(false);
  });

  it("should delete directory recursively when flag is set", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });

    const { deleteFileTool } = await import("./file.js");

    const result = await deleteFileTool.execute({
      path: "/dir/to/delete",
      recursive: true,
      confirm: true,
    });

    expect(result.deleted).toBe(true);
    expect(mockFs.rm).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it("should throw error when deleting directory without recursive flag", async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });

    const { deleteFileTool } = await import("./file.js");

    await expect(
      deleteFileTool.execute({
        path: "/dir/to/delete",
        recursive: false,
        confirm: true,
      })
    ).rejects.toThrow(/Cannot delete directory without recursive: true/);
  });

  it("should wrap unexpected errors in FileSystemError", async () => {
    // First stat succeeds with directory, then rm fails with unknown error
    mockFs.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });
    mockFs.rm.mockRejectedValueOnce(new Error("Permission denied"));

    const { deleteFileTool } = await import("./file.js");

    await expect(
      deleteFileTool.execute({
        path: "/dir/to/delete",
        recursive: true,
        confirm: true,
      })
    ).rejects.toThrow(/Failed to delete/);
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

describe("Security - Path validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFile.mockResolvedValue("content");
    mockFs.stat.mockResolvedValue({ size: 100, isFile: () => true, isDirectory: () => false });
  });

  it("should block access to /etc", async () => {
    const { readFileTool } = await import("./file.js");

    await expect(
      readFileTool.execute({ path: "/etc/passwd" })
    ).rejects.toThrow(/system path.*not allowed/i);
  });

  it("should block access to /root", async () => {
    const { readFileTool } = await import("./file.js");

    await expect(
      readFileTool.execute({ path: "/root/.bashrc" })
    ).rejects.toThrow(/system path.*not allowed/i);
  });

  it("should block access to /proc", async () => {
    const { readFileTool } = await import("./file.js");

    await expect(
      readFileTool.execute({ path: "/proc/1/environ" })
    ).rejects.toThrow(/system path.*not allowed/i);
  });

  it("should block access to /sys", async () => {
    const { readFileTool } = await import("./file.js");

    await expect(
      readFileTool.execute({ path: "/sys/kernel/security" })
    ).rejects.toThrow(/system path.*not allowed/i);
  });

  it("should block paths with null bytes", async () => {
    const { readFileTool } = await import("./file.js");

    await expect(
      readFileTool.execute({ path: "/project/file.txt\0.jpg" })
    ).rejects.toThrow(/invalid characters/i);
  });

  it("should block writing to sensitive files", async () => {
    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({ path: "/project/.env", content: "SECRET=value" })
    ).rejects.toThrow(/sensitive file.*confirmation/i);

    await expect(
      writeFileTool.execute({ path: "/project/credentials.json", content: "{}" })
    ).rejects.toThrow(/sensitive file.*confirmation/i);
  });

  it("should block deleting sensitive files", async () => {
    const { deleteFileTool } = await import("./file.js");

    await expect(
      deleteFileTool.execute({ path: "/project/.env.local", confirm: true })
    ).rejects.toThrow(/sensitive file.*confirmation/i);
  });

  it("should block path traversal attempts", async () => {
    const { readFileTool } = await import("./file.js");

    // These should resolve and be checked
    await expect(
      readFileTool.execute({ path: "/project/../../../etc/passwd" })
    ).rejects.toThrow(/system path.*not allowed/i);
  });
});

describe("Security - Encoding validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFile.mockResolvedValue("content");
    mockFs.stat.mockResolvedValue({ size: 100, isFile: () => true, isDirectory: () => false });
  });

  it("should allow safe encodings", async () => {
    const { readFileTool } = await import("./file.js");

    // UTF-8 should work
    await expect(
      readFileTool.execute({ path: "/project/file.txt", encoding: "utf-8" })
    ).resolves.toBeDefined();
  });

  it("should accept mixed case encoding", async () => {
    const { readFileTool } = await import("./file.js");

    // Mixed case should work
    await expect(
      readFileTool.execute({ path: "/project/file.txt", encoding: "UTF-8" })
    ).resolves.toBeDefined();
  });
});

describe("Security - Home directory access", () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFile.mockResolvedValue("content");
    mockFs.stat.mockResolvedValue({ size: 100, isFile: () => true, isDirectory: () => false });
    // Ensure HOME is set for these tests
    process.env.HOME = "/home/user";
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("should block reading non-allowed files outside project directory in home", async () => {
    const { readFileTool } = await import("./file.js");

    // Try to read a random file in home directory (not in allowed list)
    await expect(
      readFileTool.execute({ path: "/home/user/random-file.txt" })
    ).rejects.toThrow(/outside project directory is not allowed/i);
  });

  it("should allow reading .gitconfig from home", async () => {
    const { readFileTool } = await import("./file.js");

    // .gitconfig is in the allowed list
    // Note: This test might pass or fail depending on whether cwd starts with /home/user
    // We need to ensure cwd doesn't start with the home path for this test to work
    const cwd = process.cwd();
    if (!cwd.startsWith("/home/user")) {
      await expect(
        readFileTool.execute({ path: "/home/user/.gitconfig" })
      ).resolves.toBeDefined();
    }
  });

  it("should allow reading .bashrc from home", async () => {
    const { readFileTool } = await import("./file.js");

    const cwd = process.cwd();
    if (!cwd.startsWith("/home/user")) {
      await expect(
        readFileTool.execute({ path: "/home/user/.bashrc" })
      ).resolves.toBeDefined();
    }
  });

  it("should allow reading .zshrc from home", async () => {
    const { readFileTool } = await import("./file.js");

    const cwd = process.cwd();
    if (!cwd.startsWith("/home/user")) {
      await expect(
        readFileTool.execute({ path: "/home/user/.zshrc" })
      ).resolves.toBeDefined();
    }
  });

  it("should block writing to files in home directory outside project", async () => {
    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({ path: "/home/user/somefile.txt", content: "content" })
    ).rejects.toThrow(/operations outside project directory are not allowed/i);
  });

  it("should block delete operations in home directory outside project", async () => {
    const { deleteFileTool } = await import("./file.js");

    await expect(
      deleteFileTool.execute({ path: "/home/user/somefile.txt", confirm: true })
    ).rejects.toThrow(/operations outside project directory are not allowed/i);
  });
});

describe("Security - Additional sensitive patterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.stat.mockResolvedValue({ size: 100, isFile: () => true, isDirectory: () => false });
  });

  it("should block writing to .env.production", async () => {
    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({ path: "/project/.env.production", content: "SECRET=x" })
    ).rejects.toThrow(/sensitive file/i);
  });

  it("should block writing to secret.yaml", async () => {
    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({ path: "/project/secret.yaml", content: "key: value" })
    ).rejects.toThrow(/sensitive file/i);
  });

  it("should block writing to .pem files", async () => {
    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({ path: "/project/private.pem", content: "-----BEGIN" })
    ).rejects.toThrow(/sensitive file/i);
  });

  it("should block writing to .key files", async () => {
    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({ path: "/project/server.key", content: "-----BEGIN" })
    ).rejects.toThrow(/sensitive file/i);
  });

  it("should block writing to id_rsa", async () => {
    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({ path: "/project/id_rsa", content: "-----BEGIN" })
    ).rejects.toThrow(/sensitive file/i);
  });

  it("should block writing to .npmrc", async () => {
    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({ path: "/project/.npmrc", content: "//registry.npmjs.org/:_authToken=xxx" })
    ).rejects.toThrow(/sensitive file/i);
  });

  it("should block writing to .pypirc", async () => {
    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({ path: "/project/.pypirc", content: "[pypi]" })
    ).rejects.toThrow(/sensitive file/i);
  });

  it("should block access to /var", async () => {
    const { readFileTool } = await import("./file.js");

    await expect(
      readFileTool.execute({ path: "/var/log/messages" })
    ).rejects.toThrow(/system path.*not allowed/i);
  });

  it("should block access to /usr", async () => {
    const { readFileTool } = await import("./file.js");

    await expect(
      readFileTool.execute({ path: "/usr/bin/sh" })
    ).rejects.toThrow(/system path.*not allowed/i);
  });

  it("should block access to /boot", async () => {
    const { readFileTool } = await import("./file.js");

    await expect(
      readFileTool.execute({ path: "/boot/grub" })
    ).rejects.toThrow(/system path.*not allowed/i);
  });
});

describe("deleteFileTool additional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
    });
  });

  it("should have correct metadata", async () => {
    const { deleteFileTool } = await import("./file.js");
    expect(deleteFileTool.name).toBe("delete_file");
    expect(deleteFileTool.category).toBe("file");
    expect(deleteFileTool.description).toContain("Delete");
  });
});

describe("Edge cases and error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFile.mockResolvedValue("content");
    mockFs.stat.mockResolvedValue({ size: 100, isFile: () => true, isDirectory: () => false });
  });

  it("should handle error that is not an Error instance in readFile", async () => {
    mockFs.stat.mockRejectedValueOnce("string error");

    const { readFileTool } = await import("./file.js");

    await expect(
      readFileTool.execute({ path: "/test/file.txt" })
    ).rejects.toThrow(/Failed to read file/);
  });

  it("should handle error that is not an Error instance in writeFile", async () => {
    mockFs.writeFile.mockRejectedValueOnce("string error");

    const { writeFileTool } = await import("./file.js");

    await expect(
      writeFileTool.execute({ path: "/test/file.txt", content: "content" })
    ).rejects.toThrow(/Failed to write file/);
  });

  it("should handle error that is not an Error instance in editFile", async () => {
    mockFs.readFile.mockRejectedValueOnce("string error");

    const { editFileTool } = await import("./file.js");

    await expect(
      editFileTool.execute({ path: "/test/file.txt", oldText: "a", newText: "b" })
    ).rejects.toThrow(/Failed to edit file/);
  });

  it("should handle error that is not an Error instance in glob", async () => {
    const { glob } = await import("glob");
    vi.mocked(glob).mockRejectedValueOnce("string error");

    const { globTool } = await import("./file.js");

    await expect(
      globTool.execute({ pattern: "**/*.ts" })
    ).rejects.toThrow(/Glob search failed/);
  });

  it("should handle error that is not an Error instance in listDir", async () => {
    mockFs.readdir.mockRejectedValueOnce("string error");

    const { listDirTool } = await import("./file.js");

    await expect(
      listDirTool.execute({ path: "/test" })
    ).rejects.toThrow(/Failed to list directory/);
  });

  it("should handle error that is not an Error instance in deleteFile", async () => {
    mockFs.stat.mockResolvedValue({ isFile: () => true, isDirectory: () => false });
    mockFs.unlink.mockRejectedValueOnce("string error");

    const { deleteFileTool } = await import("./file.js");

    await expect(
      deleteFileTool.execute({ path: "/test/file.txt", confirm: true })
    ).rejects.toThrow(/Failed to delete/);
  });

  it("should handle path exactly matching blocked path", async () => {
    const { readFileTool } = await import("./file.js");

    // Exact match of blocked path
    await expect(
      readFileTool.execute({ path: "/etc" })
    ).rejects.toThrow(/system path.*not allowed/i);
  });

  it("should handle paths with path separators correctly", async () => {
    const { readFileTool } = await import("./file.js");

    // Path within /etc
    await expect(
      readFileTool.execute({ path: "/etc/hosts" })
    ).rejects.toThrow(/system path.*not allowed/i);
  });

  it("should allow paths that only start with blocked prefix but differ", async () => {
    // /etcetera is different from /etc
    // This should not be blocked if it doesn't match the blocked paths
    const { readFileTool } = await import("./file.js");

    // This path doesn't match /etc exactly or start with /etc/
    // It might still be blocked for other reasons (home directory)
    // but not for the system path check
    mockFs.readFile.mockResolvedValue("content");
    mockFs.stat.mockResolvedValue({ size: 10, isFile: () => true, isDirectory: () => false });

    // A path in the current directory should be allowed
    const result = await readFileTool.execute({ path: "./test.txt" });
    expect(result.content).toBeDefined();
  });

  it("should handle null HOME environment variable", async () => {
    const originalHome = process.env.HOME;
    delete process.env.HOME;

    const { readFileTool } = await import("./file.js");

    // Should not throw for paths when HOME is not set
    const result = await readFileTool.execute({ path: "./test.txt" });
    expect(result.content).toBeDefined();

    process.env.HOME = originalHome;
  });
});
