import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAllowedPathToSession, clearSessionAllowedPaths } from "./allowed-paths.js";
import { globTool } from "./file.js";

describe("glob guards filesystem enumeration and returned matches", () => {
  let previousCwd: string;
  let fixture: string;
  let project: string;
  let outside: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "coco-glob-scope-")));
    project = path.join(fixture, "project");
    outside = path.join(fixture, "project-sibling");
    await fs.mkdir(path.join(project, "nested", "deep"), { recursive: true });
    await fs.mkdir(outside);
    await fs.writeFile(path.join(project, "nested", "a.ts"), "a");
    await fs.writeFile(path.join(project, "nested", "deep", "b.js"), "b");
    await fs.writeFile(path.join(project, "nested", "deep", "skip.ts"), "skip");
    await fs.writeFile(path.join(outside, "outside-sentinel.txt"), "outside");
    clearSessionAllowedPaths();
    process.chdir(project);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(previousCwd);
    clearSessionAllowedPaths();
    await fs.rm(fixture, { recursive: true, force: true });
  });

  it("preserves nested brace matching, explicit cwd, and ignore patterns", async () => {
    const result = await globTool.execute({
      pattern: "**/*.{ts,js}",
      cwd: "nested",
      ignore: ["**/skip.ts"],
    });
    expect(result.files.sort()).toEqual(
      [path.join(project, "nested", "a.ts"), path.join(project, "nested", "deep", "b.js")].sort(),
    );
    expect(result.count).toBe(2);
  });

  it("returns an empty successful result when no in-scope files match", async () => {
    await expect(globTool.execute({ pattern: "nested/**/*.missing" })).resolves.toEqual({
      files: [],
      count: 0,
    });
  });

  it("permits absolute patterns whose enumeration remains inside the project", async () => {
    const result = await globTool.execute({ pattern: path.join(project, "nested", "*.ts") });
    expect(result.files).toEqual([path.join(project, "nested", "a.ts")]);
    expect(result.count).toBe(1);
  });

  it.each([
    "external cwd",
    "traversal",
    "absolute pattern",
    "external brace branch",
    "named directory symlink",
    "leaf symlink",
    "globstar symlink",
  ])("fails the entire query for %s before external enumeration", async (variant) => {
    let pattern = "*.txt";
    let cwd: string | undefined;
    if (variant === "external cwd") cwd = outside;
    if (variant === "traversal") pattern = "../project-sibling/*.txt";
    if (variant === "absolute pattern") pattern = path.join(outside, "*.txt");
    if (variant === "external brace branch") pattern = "{nested/**/*.ts,../project-sibling/*.txt}";
    if (variant === "named directory symlink" || variant === "globstar symlink") {
      await fs.symlink(outside, "escape", "dir");
      pattern = variant === "named directory symlink" ? "escape/*.txt" : "**/*";
    }
    if (variant === "leaf symlink") {
      await fs.symlink(path.join(outside, "outside-sentinel.txt"), "leaf.txt");
    }
    const readdir = vi.spyOn(fs, "readdir");
    await expect(globTool.execute({ pattern, ...(cwd ? { cwd } : {}) })).rejects.toThrow();
    // Check real destinations as well as lexical paths: an in-project alias
    // must not disguise an outside directory enumeration.
    for (const [directory] of readdir.mock.calls) {
      const canonical = await fs.realpath(directory);
      expect(canonical === outside || canonical.startsWith(outside + path.sep)).toBe(false);
    }
    expect(await fs.readFile(path.join(outside, "outside-sentinel.txt"), "utf8")).toBe("outside");
  });

  it("allows explicit external enumeration when its canonical root has a read grant", async () => {
    addAllowedPathToSession(outside, "read");
    const readdir = vi.spyOn(fs, "readdir");
    const result = await globTool.execute({ pattern: "*.txt", cwd: outside });
    expect(result).toEqual({ files: [path.join(outside, "outside-sentinel.txt")], count: 1 });
    expect(readdir.mock.calls.some(([directory]) => directory === outside)).toBe(true);
  });

  it("preserves direct matching through a symlink to an internal directory", async () => {
    await fs.symlink(path.join(project, "nested"), "internal", "dir");
    const result = await globTool.execute({ pattern: "internal/*.ts" });
    expect(result.files).toHaveLength(1);
    expect(await fs.realpath(result.files[0]!)).toBe(path.join(project, "nested", "a.ts"));
    expect(result.count).toBe(1);
  });
});
