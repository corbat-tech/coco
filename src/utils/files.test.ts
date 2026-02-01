/**
 * Tests for file utilities
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFs = {
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{"test": true}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({
    size: 1024,
    mtime: new Date(),
    isFile: () => true,
    isDirectory: () => false,
  }),
  unlink: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([
    { name: "file1.ts", isFile: () => true, isDirectory: () => false },
    { name: "file2.ts", isFile: () => true, isDirectory: () => false },
    { name: "subdir", isFile: () => false, isDirectory: () => true },
  ]),
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue("/tmp/coco-test"),
  rename: vi.fn().mockResolvedValue(undefined),
};

vi.mock("node:fs/promises", () => ({
  default: mockFs,
}));

describe("ensureDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create directory with recursive flag", async () => {
    const { ensureDir } = await import("./files.js");

    await ensureDir("/test/nested/dir");

    expect(mockFs.mkdir).toHaveBeenCalledWith("/test/nested/dir", { recursive: true });
  });

  it("should throw FileSystemError on failure", async () => {
    mockFs.mkdir.mockRejectedValueOnce(new Error("Permission denied"));

    const { ensureDir } = await import("./files.js");

    await expect(ensureDir("/test")).rejects.toThrow(/Failed to create directory/);
  });
});

describe("fileExists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return true if file exists", async () => {
    const { fileExists } = await import("./files.js");

    const result = await fileExists("/test/file.txt");

    expect(result).toBe(true);
  });

  it("should return false if file does not exist", async () => {
    mockFs.access.mockRejectedValueOnce(new Error("Not found"));

    const { fileExists } = await import("./files.js");

    const result = await fileExists("/test/nonexistent.txt");

    expect(result).toBe(false);
  });
});

describe("readJsonFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should read and parse JSON file", async () => {
    const { readJsonFile } = await import("./files.js");

    const result = await readJsonFile<{ test: boolean }>("/test/file.json");

    expect(result).toEqual({ test: true });
  });

  it("should throw FileSystemError on failure", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("Not found"));

    const { readJsonFile } = await import("./files.js");

    await expect(readJsonFile("/test/file.json")).rejects.toThrow(
      /Failed to read JSON file/
    );
  });
});

describe("writeJsonFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should write JSON file with pretty formatting", async () => {
    const { writeJsonFile } = await import("./files.js");

    await writeJsonFile("/test/file.json", { name: "test" });

    expect(mockFs.mkdir).toHaveBeenCalled();
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      "/test/file.json",
      expect.stringContaining('"name": "test"'),
      "utf-8"
    );
  });

  it("should use custom indent", async () => {
    const { writeJsonFile } = await import("./files.js");

    await writeJsonFile("/test/file.json", { name: "test" }, { indent: 4 });

    const call = mockFs.writeFile.mock.calls[0];
    expect(call?.[1]).toContain("    "); // 4-space indent
  });

  it("should skip ensuring directory when option is false", async () => {
    const { writeJsonFile } = await import("./files.js");

    await writeJsonFile("/test/file.json", { name: "test" }, { ensureDir: false });

    expect(mockFs.mkdir).not.toHaveBeenCalled();
  });

  it("should throw FileSystemError on failure", async () => {
    mockFs.writeFile.mockRejectedValueOnce(new Error("Write failed"));

    const { writeJsonFile } = await import("./files.js");

    await expect(writeJsonFile("/test/file.json", { name: "test" })).rejects.toThrow(
      /Failed to write JSON file/
    );
  });
});

describe("copyFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should copy file", async () => {
    const { copyFile } = await import("./files.js");

    await copyFile("/source/file.txt", "/dest/file.txt");

    expect(mockFs.mkdir).toHaveBeenCalled();
    expect(mockFs.copyFile).toHaveBeenCalledWith("/source/file.txt", "/dest/file.txt");
  });

  it("should copy file without ensuring directory", async () => {
    const { copyFile } = await import("./files.js");

    await copyFile("/source/file.txt", "/dest/file.txt", { ensureDir: false });

    expect(mockFs.mkdir).not.toHaveBeenCalled();
    expect(mockFs.copyFile).toHaveBeenCalledWith("/source/file.txt", "/dest/file.txt");
  });

  it("should throw FileSystemError on failure", async () => {
    mockFs.copyFile.mockRejectedValueOnce(new Error("Copy failed"));

    const { copyFile } = await import("./files.js");

    await expect(copyFile("/source.txt", "/dest.txt")).rejects.toThrow(/Failed to copy file/);
  });
});

describe("removeFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should remove file", async () => {
    const { removeFile } = await import("./files.js");

    await removeFile("/test/file.txt");

    expect(mockFs.unlink).toHaveBeenCalledWith("/test/file.txt");
  });

  it("should remove directory recursively", async () => {
    mockFs.stat.mockResolvedValueOnce({
      size: 0,
      mtime: new Date(),
      isFile: () => false,
      isDirectory: () => true,
    });

    const { removeFile } = await import("./files.js");

    await removeFile("/test/dir");

    expect(mockFs.rm).toHaveBeenCalledWith("/test/dir", { recursive: true });
  });

  it("should not throw for non-existent file", async () => {
    const err = new Error("Not found") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockFs.stat.mockRejectedValueOnce(err);

    const { removeFile } = await import("./files.js");

    await expect(removeFile("/nonexistent")).resolves.toBeUndefined();
  });

  it("should throw FileSystemError for other errors", async () => {
    const err = new Error("Permission denied") as NodeJS.ErrnoException;
    err.code = "EACCES";
    mockFs.stat.mockRejectedValueOnce(err);

    const { removeFile } = await import("./files.js");

    await expect(removeFile("/protected")).rejects.toThrow(/Failed to remove/);
  });
});

describe("getFileHash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return SHA-256 hash of file", async () => {
    mockFs.readFile.mockResolvedValueOnce(Buffer.from("test content"));

    const { getFileHash } = await import("./files.js");

    const hash = await getFileHash("/test/file.txt");

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should throw FileSystemError on failure", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("File not found"));

    const { getFileHash } = await import("./files.js");

    await expect(getFileHash("/nonexistent")).rejects.toThrow(/Failed to hash file/);
  });
});

describe("getStringHash", () => {
  it("should return SHA-256 hash of string", async () => {
    const { getStringHash } = await import("./files.js");

    const hash = getStringHash("test content");

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should return consistent hash for same input", async () => {
    const { getStringHash } = await import("./files.js");

    const hash1 = getStringHash("test");
    const hash2 = getStringHash("test");

    expect(hash1).toBe(hash2);
  });
});

describe("readTextFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should read text file", async () => {
    mockFs.readFile.mockResolvedValueOnce("file content");

    const { readTextFile } = await import("./files.js");

    const content = await readTextFile("/test/file.txt");

    expect(content).toBe("file content");
  });

  it("should return fallback if file not found", async () => {
    const err = new Error("Not found") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockFs.readFile.mockRejectedValueOnce(err);

    const { readTextFile } = await import("./files.js");

    const content = await readTextFile("/nonexistent.txt", "default");

    expect(content).toBe("default");
  });

  it("should throw error if no fallback and file not found", async () => {
    const err = new Error("Not found") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockFs.readFile.mockRejectedValueOnce(err);

    const { readTextFile } = await import("./files.js");

    await expect(readTextFile("/nonexistent.txt")).rejects.toThrow(/Failed to read file/);
  });

  it("should throw error for non-ENOENT errors even with fallback", async () => {
    const err = new Error("Permission denied") as NodeJS.ErrnoException;
    err.code = "EACCES";
    mockFs.readFile.mockRejectedValueOnce(err);

    const { readTextFile } = await import("./files.js");

    await expect(readTextFile("/protected.txt", "default")).rejects.toThrow(/Failed to read file/);
  });
});

describe("writeTextFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should write text file", async () => {
    const { writeTextFile } = await import("./files.js");

    await writeTextFile("/test/file.txt", "content");

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      "/test/file.txt",
      "content",
      expect.objectContaining({ encoding: "utf-8" })
    );
  });

  it("should skip ensuring directory when option is false", async () => {
    const { writeTextFile } = await import("./files.js");

    await writeTextFile("/test/file.txt", "content", { ensureDir: false });

    expect(mockFs.mkdir).not.toHaveBeenCalled();
  });

  it("should pass mode option when provided", async () => {
    const { writeTextFile } = await import("./files.js");

    await writeTextFile("/test/script.sh", "#!/bin/bash", { mode: 0o755 });

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      "/test/script.sh",
      "#!/bin/bash",
      expect.objectContaining({ mode: 0o755 })
    );
  });

  it("should throw FileSystemError on failure", async () => {
    mockFs.writeFile.mockRejectedValueOnce(new Error("Write failed"));

    const { writeTextFile } = await import("./files.js");

    await expect(writeTextFile("/test/file.txt", "content")).rejects.toThrow(/Failed to write file/);
  });
});

describe("appendTextFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should append to text file", async () => {
    const { appendTextFile } = await import("./files.js");

    await appendTextFile("/test/file.txt", "appended content");

    expect(mockFs.appendFile).toHaveBeenCalledWith(
      "/test/file.txt",
      "appended content",
      "utf-8"
    );
  });

  it("should skip ensuring directory when option is false", async () => {
    const { appendTextFile } = await import("./files.js");

    await appendTextFile("/test/file.txt", "content", { ensureDir: false });

    expect(mockFs.mkdir).not.toHaveBeenCalled();
  });

  it("should throw FileSystemError on failure", async () => {
    mockFs.appendFile.mockRejectedValueOnce(new Error("Append failed"));

    const { appendTextFile } = await import("./files.js");

    await expect(appendTextFile("/test/file.txt", "content")).rejects.toThrow(/Failed to append/);
  });
});

describe("listFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list files in directory", async () => {
    const { listFiles } = await import("./files.js");

    const files = await listFiles("/test");

    expect(files).toContain("/test/file1.ts");
    expect(files).toContain("/test/file2.ts");
  });

  it("should filter by pattern", async () => {
    const { listFiles } = await import("./files.js");

    const files = await listFiles("/test", { pattern: /1\.ts$/ });

    expect(files).toContain("/test/file1.ts");
    expect(files).not.toContain("/test/file2.ts");
  });

  it("should throw FileSystemError on failure", async () => {
    mockFs.readdir.mockRejectedValueOnce(new Error("Permission denied"));

    const { listFiles } = await import("./files.js");

    await expect(listFiles("/protected")).rejects.toThrow(/Failed to list files/);
  });

  it("should list files recursively", async () => {
    // First call returns parent dir contents
    mockFs.readdir.mockResolvedValueOnce([
      { name: "file1.ts", isFile: () => true, isDirectory: () => false },
      { name: "subdir", isFile: () => false, isDirectory: () => true },
    ]);
    // Second call returns subdir contents
    mockFs.readdir.mockResolvedValueOnce([
      { name: "nested.ts", isFile: () => true, isDirectory: () => false },
    ]);

    const { listFiles } = await import("./files.js");

    const files = await listFiles("/test", { recursive: true });

    expect(files).toContain("/test/file1.ts");
    expect(files).toContain("/test/subdir/nested.ts");
  });
});

describe("getFileStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return file stats", async () => {
    const { getFileStats } = await import("./files.js");

    const stats = await getFileStats("/test/file.txt");

    expect(stats.size).toBe(1024);
    expect(stats.mtime).toBeInstanceOf(Date);
    expect(stats.isFile).toBe(true);
    expect(stats.isDirectory).toBe(false);
  });

  it("should throw FileSystemError on failure", async () => {
    mockFs.stat.mockRejectedValueOnce(new Error("File not found"));

    const { getFileStats } = await import("./files.js");

    await expect(getFileStats("/nonexistent")).rejects.toThrow(/Failed to get stats/);
  });
});

describe("createTempFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create temporary file", async () => {
    const { createTempFile } = await import("./files.js");

    const path = await createTempFile("temp content");

    expect(path).toContain("/tmp/coco-test");
    expect(mockFs.writeFile).toHaveBeenCalled();
  });

  it("should use custom prefix and suffix", async () => {
    const { createTempFile } = await import("./files.js");

    const path = await createTempFile("content", { prefix: "test-", suffix: ".json" });

    expect(path).toContain("test-");
    expect(path).toContain(".json");
  });

  it("should use custom directory when provided", async () => {
    const { createTempFile } = await import("./files.js");

    const result = await createTempFile("content", { dir: "/custom/temp" });

    expect(result).toContain("/custom/temp");
    expect(mockFs.mkdtemp).not.toHaveBeenCalled();
  });
});

describe("atomicWriteFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should write file atomically", async () => {
    const { atomicWriteFile } = await import("./files.js");

    await atomicWriteFile("/test/file.txt", "content");

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".tmp"),
      "content",
      "utf-8"
    );
    expect(mockFs.rename).toHaveBeenCalled();
  });

  it("should clean up temp file on error", async () => {
    mockFs.rename.mockRejectedValueOnce(new Error("Rename failed"));

    const { atomicWriteFile } = await import("./files.js");

    await expect(atomicWriteFile("/test/file.txt", "content")).rejects.toThrow();
    expect(mockFs.unlink).toHaveBeenCalled();
  });
});
