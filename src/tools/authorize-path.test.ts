/**
 * Tests for authorize_path tool
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { authorizePathTool } from "./authorize-path.js";

// Mock allowed-paths module
vi.mock("./allowed-paths.js", () => ({
  getAllowedPaths: vi.fn(() => []),
}));

// Mock the allow-path-prompt (dynamic import)
vi.mock("../cli/repl/allow-path-prompt.js", () => ({
  promptAllowPath: vi.fn(async () => true),
}));

// Mock fs
vi.mock("node:fs/promises", () => ({
  default: {
    stat: vi.fn(async () => ({ isDirectory: () => true })),
    realpath: vi.fn(async (entry: string) => entry),
  },
}));

import { getAllowedPaths } from "./allowed-paths.js";

describe("authorize_path tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllowedPaths).mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have correct name and category", () => {
    expect(authorizePathTool.name).toBe("authorize_path");
    expect(authorizePathTool.category).toBe("config");
  });

  it("should return already authorized if path is in allowed paths", async () => {
    vi.mocked(getAllowedPaths).mockReturnValue([
      { path: "/tmp/test-dir", level: "read", authorizedAt: "fixture" },
    ]);

    const result = await authorizePathTool.execute({ path: "/tmp/test-dir" });

    expect(result.authorized).toBe(true);
    expect(result.message).toContain("already accessible");
  });

  it("should block system paths", async () => {
    const result = await authorizePathTool.execute({ path: "/etc/nginx" });

    expect(result.authorized).toBe(false);
    expect(result.message).toContain("System path");
    expect(result.message).toContain("security");
  });

  it("should return already accessible if within project directory", async () => {
    const cwd = process.cwd();
    const result = await authorizePathTool.execute({ path: `${cwd}/src` });

    expect(result.authorized).toBe(true);
    expect(result.message).toContain("already accessible");
  });

  it("should detect duplicate in allowed paths list", async () => {
    const testPath = "/home/test/external";
    vi.mocked(getAllowedPaths).mockReturnValueOnce([
      { path: testPath, authorizedAt: new Date().toISOString(), level: "write" },
    ]);

    const result = await authorizePathTool.execute({ path: testPath });

    expect(result.authorized).toBe(true);
    expect(result.message).toContain("already accessible");
  });

  it("reports missing authority with reason and canonical grant request without prompting", async () => {
    const { promptAllowPath } = await import("../cli/repl/allow-path-prompt.js");
    await expect(
      authorizePathTool.execute({ path: "/home/test/other-project", reason: "Need shared types" }),
    ).rejects.toThrow(
      "Reason: Need shared types. Use /allow-path /home/test/other-project to grant access",
    );
    expect(promptAllowPath).not.toHaveBeenCalled();
  });

  it("should handle non-existent directories", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.stat).mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const result = await authorizePathTool.execute({ path: "/nonexistent/path" });

    expect(result.authorized).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("should reject non-directory paths", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.default.stat).mockResolvedValueOnce({ isDirectory: () => false } as any);

    const result = await authorizePathTool.execute({ path: "/tmp/some-file.txt" });

    expect(result.authorized).toBe(false);
    expect(result.message).toContain("Not a directory");
  });
});
