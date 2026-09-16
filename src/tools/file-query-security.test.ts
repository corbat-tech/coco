import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAllowedPathToSession, clearSessionAllowedPaths } from "./allowed-paths.js";
import { fileExistsTool, listDirTool, treeTool } from "./file.js";

describe("file queries enforce project read scope", () => {
  let previousCwd: string;
  let fixture: string;
  let project: string;
  let outside: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "coco-query-scope-")));
    project = path.join(fixture, "project");
    outside = path.join(fixture, "project-sibling");
    await fs.mkdir(path.join(project, "nested"), { recursive: true });
    await fs.mkdir(outside);
    await fs.writeFile(path.join(project, "nested", "inside.txt"), "inside");
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

  it("reports files, directories, and missing paths within the project", async () => {
    await expect(fileExistsTool.execute({ path: "nested/inside.txt" })).resolves.toEqual({
      exists: true,
      isFile: true,
      isDirectory: false,
    });
    await expect(fileExistsTool.execute({ path: "nested" })).resolves.toEqual({
      exists: true,
      isFile: false,
      isDirectory: true,
    });
    await expect(fileExistsTool.execute({ path: "missing/deep.txt" })).resolves.toEqual({
      exists: false,
      isFile: false,
      isDirectory: false,
    });
  });

  it("lists and renders nested in-project files", async () => {
    const listed = await listDirTool.execute({ path: ".", recursive: true });
    expect(listed.entries).toEqual(
      expect.arrayContaining([
        { name: "nested", type: "directory" },
        { name: "nested/inside.txt", type: "file", size: 6 },
      ]),
    );
    const rendered = await treeTool.execute({ path: ".", depth: 5 });
    expect(rendered.tree).toContain("inside.txt");
    expect(rendered.totalFiles).toBe(1);
    expect(rendered.totalDirs).toBe(1);
  });

  it("missing directory roots remain errors for list and tree", async () => {
    await expect(listDirTool.execute({ path: "missing" })).rejects.toThrow();
    await expect(treeTool.execute({ path: "missing" })).rejects.toThrow();
  });

  describe.each(["absolute", "traversal", "symlink"])("external %s roots", (variant) => {
    it.each(["file_exists", "list_dir", "tree"])(
      "denies %s before querying outside",
      async (tool) => {
        let root = outside;
        if (variant === "traversal") root = "../project-sibling";
        if (variant === "symlink") {
          await fs.symlink(outside, "escape", "dir");
          root = "escape";
        }
        const query =
          tool === "file_exists"
            ? fileExistsTool.execute({ path: root })
            : tool === "list_dir"
              ? listDirTool.execute({ path: root, recursive: true })
              : treeTool.execute({ path: root, depth: 5 });
        await expect(query).rejects.toThrow();
        expect(await fs.readFile(path.join(outside, "outside-sentinel.txt"), "utf8")).toBe(
          "outside",
        );
      },
    );
  });

  it("does not traverse nested external directory links in recursive list or tree", async () => {
    await fs.symlink(outside, path.join("nested", "escape"), "dir");
    const listed = await listDirTool.execute({ path: ".", recursive: true });
    expect(listed.entries.some((entry) => entry.name === "nested/inside.txt")).toBe(true);
    expect(listed.entries.some((entry) => entry.name.includes("outside-sentinel.txt"))).toBe(false);
    const rendered = await treeTool.execute({ path: ".", depth: 8 });
    expect(rendered.tree).toContain("inside.txt");
    expect(rendered.tree).not.toContain("outside-sentinel.txt");
    expect(await fs.readFile(path.join(outside, "outside-sentinel.txt"), "utf8")).toBe("outside");
  });

  it("permits an explicit external root after a canonical read grant", async () => {
    addAllowedPathToSession(outside, "read");
    await expect(
      fileExistsTool.execute({ path: path.join(outside, "outside-sentinel.txt") }),
    ).resolves.toEqual({
      exists: true,
      isFile: true,
      isDirectory: false,
    });
    const listed = await listDirTool.execute({ path: outside, recursive: true });
    expect(listed.entries).toEqual([{ name: "outside-sentinel.txt", type: "file", size: 7 }]);
    const rendered = await treeTool.execute({ path: outside });
    expect(rendered.tree).toContain("outside-sentinel.txt");
    expect(rendered.totalFiles).toBe(1);
  });

  it("propagates file_exists permission errors instead of reporting a missing file", async () => {
    const target = path.join(project, "nested", "inside.txt");
    const denied = Object.assign(new Error("query permission denied"), { code: "EACCES" });
    // Canonical validation uses realpath; inject only the subsequent metadata read.
    const stat = vi.spyOn(fs, "stat").mockImplementationOnce(async (input) => {
      expect(input).toBe(target);
      throw denied;
    });
    await expect(fileExistsTool.execute({ path: target })).rejects.toThrow();
    expect(stat).toHaveBeenCalledWith(target);
  });
});
