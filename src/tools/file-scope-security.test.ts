import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSessionAllowedPaths } from "./allowed-paths.js";
import {
  copyFileTool,
  deleteFileTool,
  editFileTool,
  moveFileTool,
  readFileTool,
  writeFileTool,
} from "./file.js";

describe("basic file tools enforce project scope before disk effects", () => {
  let previousCwd: string;
  let fixture: string;
  let project: string;
  let outside: string;
  let sentinel: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "coco-file-scope-")));
    project = path.join(fixture, "project");
    outside = path.join(fixture, "project-sibling");
    await fs.mkdir(project);
    await fs.mkdir(outside);
    sentinel = path.join(outside, "sentinel.txt");
    await fs.writeFile(sentinel, "outside sentinel");
    await fs.writeFile(path.join(project, "source.txt"), "inside source");
    clearSessionAllowedPaths();
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    clearSessionAllowedPaths();
    await fs.rm(fixture, { recursive: true, force: true });
  });

  const unchangedOutside = async () => {
    expect(await fs.readFile(sentinel, "utf8")).toBe("outside sentinel");
    expect(await fs.readdir(outside)).toEqual(["sentinel.txt"]);
  };
  const missing = async (entry: string) => {
    await expect(fs.lstat(entry)).rejects.toMatchObject({ code: "ENOENT" });
  };

  it("performs ordinary read/write/edit/copy/move/delete operations within the project", async () => {
    await writeFileTool.execute({ path: "nested/new.txt", content: "first", createDirs: true });
    expect((await readFileTool.execute({ path: "nested/new.txt", encoding: "utf8" })).content).toBe(
      "first",
    );
    await editFileTool.execute({ path: "nested/new.txt", oldText: "first", newText: "second" });
    await copyFileTool.execute({ source: "nested/new.txt", destination: "copy.txt" });
    await moveFileTool.execute({ source: "copy.txt", destination: "moved.txt" });
    expect(await fs.readFile("moved.txt", "utf8")).toBe("second");
    expect(await fs.readFile("nested/new.txt", "utf8")).toBe("second");
    await missing("copy.txt");
    await deleteFileTool.execute({ path: "moved.txt", confirm: true });
    await missing("moved.txt");
    await unchangedOutside();
  });

  it("denies absolute external reads and mutations regardless of HOME membership", async () => {
    await expect(readFileTool.execute({ path: sentinel, encoding: "utf8" })).rejects.toThrow();
    await expect(writeFileTool.execute({ path: sentinel, content: "changed" })).rejects.toThrow();
    await expect(
      editFileTool.execute({ path: sentinel, oldText: "outside", newText: "changed" }),
    ).rejects.toThrow();
    await expect(deleteFileTool.execute({ path: sentinel, confirm: true })).rejects.toThrow();
    await unchangedOutside();
  });

  it.each(["relative traversal", "absolute sibling prefix"])(
    "denies %s writes",
    async (variant) => {
      const destination =
        variant === "relative traversal" ? "../project-sibling/sentinel.txt" : sentinel;
      await expect(
        writeFileTool.execute({ path: destination, content: "changed", createDirs: true }),
      ).rejects.toThrow();
      await unchangedOutside();
    },
  );

  it("denies read, write, and edit through an existing external leaf symlink", async () => {
    await fs.symlink(sentinel, "leaf.txt");
    await expect(readFileTool.execute({ path: "leaf.txt", encoding: "utf8" })).rejects.toThrow();
    await expect(writeFileTool.execute({ path: "leaf.txt", content: "changed" })).rejects.toThrow();
    await expect(
      editFileTool.execute({ path: "leaf.txt", oldText: "outside", newText: "changed" }),
    ).rejects.toThrow();
    expect((await fs.lstat("leaf.txt")).isSymbolicLink()).toBe(true);
    await unchangedOutside();
  });

  it("denies new deep writes through an external parent before creating directories", async () => {
    await fs.symlink(outside, "escape", "dir");
    await expect(
      writeFileTool.execute({
        path: "escape/new/deep/file.txt",
        content: "changed",
        createDirs: true,
      }),
    ).rejects.toThrow();
    await missing(path.join(outside, "new"));
    await unchangedOutside();
  });

  it.each([copyFileTool, moveFileTool])(
    "$name rejects an escaped destination before mkdir or source mutation",
    async (tool) => {
      await fs.symlink(outside, "escape", "dir");
      await expect(
        tool.execute({ source: "source.txt", destination: "escape/new/deep/file.txt" }),
      ).rejects.toThrow();
      expect(await fs.readFile("source.txt", "utf8")).toBe("inside source");
      await missing(path.join(outside, "new"));
      await unchangedOutside();
    },
  );

  it("rejects a move with an ungranted external source before creating its destination parent", async () => {
    await expect(
      moveFileTool.execute({ source: sentinel, destination: "new/deep/moved.txt" }),
    ).rejects.toThrow();
    await missing("new");
    await unchangedOutside();
  });

  it("deletes an internal symlink entry while preserving its target", async () => {
    await fs.symlink(path.join(project, "source.txt"), "link.txt");
    await deleteFileTool.execute({ path: "link.txt", confirm: true });
    await missing("link.txt");
    expect(await fs.readFile("source.txt", "utf8")).toBe("inside source");
    await unchangedOutside();
  });

  it("moves the source symlink entry instead of renaming its target", async () => {
    const target = path.join(project, "source.txt");
    await fs.symlink(target, "link.txt");
    await moveFileTool.execute({ source: "link.txt", destination: "moved-link.txt" });
    await missing("link.txt");
    expect((await fs.lstat("moved-link.txt")).isSymbolicLink()).toBe(true);
    expect(await fs.readlink("moved-link.txt")).toBe(target);
    expect(await fs.readFile(target, "utf8")).toBe("inside source");
    await unchangedOutside();
  });

  it("move overwrite replaces a destination symlink entry without overwriting its target", async () => {
    await fs.writeFile("target.txt", "preserved target");
    await fs.symlink(path.join(project, "target.txt"), "destination.txt");
    await moveFileTool.execute({
      source: "source.txt",
      destination: "destination.txt",
      overwrite: true,
    });
    await missing("source.txt");
    expect((await fs.lstat("destination.txt")).isSymbolicLink()).toBe(false);
    expect(await fs.readFile("destination.txt", "utf8")).toBe("inside source");
    expect(await fs.readFile("target.txt", "utf8")).toBe("preserved target");
    await unchangedOutside();
  });

  it("rejects a parent escape whose external leaf link points back into the project", async () => {
    await fs.symlink(outside, "escape", "dir");
    const externalLink = path.join(outside, "back-link.txt");
    await fs.symlink(path.join(project, "source.txt"), externalLink);
    await expect(
      deleteFileTool.execute({ path: "escape/back-link.txt", confirm: true }),
    ).rejects.toThrow();
    await expect(
      moveFileTool.execute({ source: "escape/back-link.txt", destination: "stolen.txt" }),
    ).rejects.toThrow();
    await missing("stolen.txt");
    expect((await fs.lstat(externalLink)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile("source.txt", "utf8")).toBe("inside source");
    expect(await fs.readFile(sentinel, "utf8")).toBe("outside sentinel");
    expect((await fs.readdir(outside)).sort()).toEqual(["back-link.txt", "sentinel.txt"]);
  });
});
