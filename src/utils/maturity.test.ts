import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("glob", () => ({
  glob: vi.fn(),
}));

import { access, readdir, readFile } from "node:fs/promises";
import { glob } from "glob";
import { detectMaturity, type MaturityLevel } from "./maturity.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockAccess(existingFiles: string[]) {
  vi.mocked(access).mockImplementation(async (p) => {
    const pathStr = String(p);
    if (existingFiles.some((f) => pathStr.endsWith(f))) return;
    throw new Error("ENOENT");
  });
}

function mockReaddir(files: string[]) {
  vi.mocked(readdir).mockResolvedValue(files as any);
}

describe("detectMaturity", () => {
  it("returns 'empty' when no manifest files exist", async () => {
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));

    const result = await detectMaturity("/fake/project");

    expect(result.level).toBe("empty");
    expect(result.sourceFiles).toBe(0);
    expect(result.testFiles).toBe(0);
    expect(result.hasPackageJson).toBe(false);
    expect(result.hasCI).toBe(false);
    expect(result.hasLintConfig).toBe(false);
  });

  it("returns 'empty' when has package.json but < 5 source files", async () => {
    mockAccess(["package.json"]);
    vi.mocked(glob).mockResolvedValueOnce(["a.ts", "b.ts"]); // source files

    const result = await detectMaturity("/fake/project");

    expect(result.level).toBe("empty");
    expect(result.sourceFiles).toBe(2);
    expect(result.hasPackageJson).toBe(true);
  });

  it("returns 'new' when has package.json, some source files, but not established", async () => {
    mockAccess(["package.json"]);
    vi.mocked(glob)
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => `file${i}.ts`)) // source files
      .mockResolvedValueOnce(["test1.test.ts"]); // test files
    mockReaddir([]); // no workflow files in .github/workflows

    const result = await detectMaturity("/fake/project");

    expect(result.level).toBe("new");
    expect(result.sourceFiles).toBe(10);
    expect(result.testFiles).toBe(1);
  });

  it("returns 'established' when has many source files, tests, and CI", async () => {
    mockAccess(["package.json", ".github/workflows"]);
    vi.mocked(glob)
      .mockResolvedValueOnce(Array.from({ length: 60 }, (_, i) => `file${i}.ts`)) // source files
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => `test${i}.test.ts`)); // test files
    mockReaddir(["ci.yml"]); // workflow files

    const result = await detectMaturity("/fake/project");

    expect(result.level).toBe("established");
    expect(result.sourceFiles).toBe(60);
    expect(result.testFiles).toBe(10);
    expect(result.hasPackageJson).toBe(true);
    expect(result.hasCI).toBe(true);
  });

  it("returns 'established' with lint config instead of CI", async () => {
    mockAccess(["package.json", ".eslintrc.json"]);
    vi.mocked(glob)
      .mockResolvedValueOnce(Array.from({ length: 55 }, (_, i) => `file${i}.ts`))
      .mockResolvedValueOnce(Array.from({ length: 8 }, (_, i) => `test${i}.test.ts`));
    // access for .github/workflows will fail (not in existingFiles)
    vi.mocked(readdir).mockRejectedValue(new Error("ENOENT")); // no workflow dir

    const result = await detectMaturity("/fake/project");

    expect(result.level).toBe("established");
    expect(result.hasLintConfig).toBe(true);
    expect(result.hasCI).toBe(false);
  });

  it("detects lint config from package.json scripts", async () => {
    // Only package.json exists, no lint config files
    vi.mocked(access).mockImplementation(async (p) => {
      const pathStr = String(p);
      if (pathStr.endsWith("package.json")) return;
      throw new Error("ENOENT");
    });
    vi.mocked(glob)
      .mockResolvedValueOnce(Array.from({ length: 55 }, (_, i) => `file${i}.ts`))
      .mockResolvedValueOnce(Array.from({ length: 8 }, (_, i) => `test${i}.test.ts`));
    vi.mocked(readdir).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ scripts: { lint: "eslint ." } }));

    const result = await detectMaturity("/fake/project");

    expect(result.hasLintConfig).toBe(true);
  });

  it("detects non-JS manifests like go.mod", async () => {
    vi.mocked(access).mockImplementation(async (p) => {
      const pathStr = String(p);
      if (pathStr.endsWith("go.mod")) return;
      throw new Error("ENOENT");
    });
    vi.mocked(glob)
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => `file${i}.go`))
      .mockResolvedValueOnce([]);
    vi.mocked(readdir).mockRejectedValue(new Error("ENOENT"));

    const result = await detectMaturity("/fake/project");

    expect(result.level).toBe("new");
    expect(result.sourceFiles).toBe(10);
    expect(result.hasPackageJson).toBe(false);
  });

  it("returns 'empty' when non-JS manifest exists but < 5 source files", async () => {
    vi.mocked(access).mockImplementation(async (p) => {
      const pathStr = String(p);
      if (pathStr.endsWith("Cargo.toml")) return;
      throw new Error("ENOENT");
    });
    vi.mocked(glob).mockResolvedValueOnce(["main.rs", "lib.rs"]);

    const result = await detectMaturity("/fake/project");

    expect(result.level).toBe("empty");
    expect(result.sourceFiles).toBe(2);
  });

  it("handles readFile error for package.json lint detection gracefully", async () => {
    vi.mocked(access).mockImplementation(async (p) => {
      const pathStr = String(p);
      if (pathStr.endsWith("package.json")) return;
      throw new Error("ENOENT");
    });
    vi.mocked(glob)
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => `file${i}.ts`))
      .mockResolvedValueOnce([]);
    vi.mocked(readdir).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(readFile).mockRejectedValue(new Error("read error"));

    const result = await detectMaturity("/fake/project");

    expect(result.hasLintConfig).toBe(false);
    expect(result.level).toBe("new");
  });

  it("handles readdir returning empty array for workflows", async () => {
    mockAccess(["package.json", ".github/workflows"]);
    vi.mocked(glob)
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => `file${i}.ts`))
      .mockResolvedValueOnce([]);
    mockReaddir([]);

    const result = await detectMaturity("/fake/project");

    expect(result.hasCI).toBe(false);
  });
});
