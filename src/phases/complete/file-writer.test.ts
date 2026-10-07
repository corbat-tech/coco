import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAllowedPathToSession, clearSessionAllowedPaths } from "../../tools/allowed-paths.js";
import { saveGeneratedFiles } from "./file-writer.js";
import type { GeneratedFile } from "./types.js";

describe("COMPLETE generated-file batch validation", () => {
  let fixture: string;
  let project: string;
  let outside: string;
  let existing: string;

  beforeEach(async () => {
    fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "coco-generated-")));
    project = path.join(fixture, "project");
    outside = path.join(fixture, "project-sibling");
    await fs.mkdir(project);
    await fs.mkdir(outside);
    existing = path.join(project, "existing.txt");
    await fs.writeFile(existing, "original");
    await fs.writeFile(path.join(outside, "sentinel.txt"), "outside");
    clearSessionAllowedPaths();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    clearSessionAllowedPaths();
    await fs.rm(fixture, { recursive: true, force: true });
  });

  const file = (filePath: string, action: GeneratedFile["action"] = "create"): GeneratedFile => ({
    path: filePath,
    content: "changed",
    action,
  });
  const missing = async (filePath: string) => {
    await expect(fs.lstat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  };
  const unchanged = async () => {
    expect(await fs.readFile(existing, "utf8")).toBe("original");
    expect(await fs.readFile(path.join(outside, "sentinel.txt"), "utf8")).toBe("outside");
    expect(await fs.readdir(outside)).toEqual(["sentinel.txt"]);
  };

  it("creates, modifies, and deletes relative to explicit projectRoot without changing cwd", async () => {
    const cwd = process.cwd();
    await fs.writeFile(path.join(project, "remove.txt"), "remove");
    await saveGeneratedFiles(project, [
      file("nested/created.txt"),
      file("existing.txt", "modify"),
      file("remove.txt", "delete"),
    ]);
    expect(await fs.readFile(path.join(project, "nested", "created.txt"), "utf8")).toBe("changed");
    expect(await fs.readFile(existing, "utf8")).toBe("changed");
    await missing(path.join(project, "remove.txt"));
    expect(process.cwd()).toBe(cwd);
  });

  it.each(["traversal", "external absolute", "sibling prefix", "symlink parent"])(
    "validates a second %s path before modifying the first file",
    async (variant) => {
      let badPath = "../project-sibling/new/deep.txt";
      if (variant === "external absolute") badPath = path.join(outside, "sentinel.txt");
      if (variant === "sibling prefix") badPath = path.join(outside, "new", "deep.txt");
      if (variant === "symlink parent") {
        await fs.symlink(outside, path.join(project, "escape"), "dir");
        badPath = "escape/new/deep.txt";
      }
      await expect(
        saveGeneratedFiles(project, [file("existing.txt", "modify"), file(badPath)]),
      ).rejects.toThrow();
      await unchanged();
      await missing(path.join(outside, "new"));
    },
  );

  it("creates no directories for an earlier valid create when a later path is invalid", async () => {
    await expect(
      saveGeneratedFiles(project, [
        file("new/deep/created.txt"),
        file("../project-sibling/sentinel.txt", "delete"),
      ]),
    ).rejects.toThrow();
    await missing(path.join(project, "new"));
    await unchanged();
  });

  it.each([
    { path: "later.txt", action: "unknown", content: "changed" },
    { path: "", action: "create", content: "changed" },
    { path: "later.txt", action: "create", content: 42 },
  ])("rejects malformed runtime entries before any effects: %j", async (invalid) => {
    const batch = [file("existing.txt", "modify"), invalid] as unknown as GeneratedFile[];
    await expect(saveGeneratedFiles(project, batch)).rejects.toThrow();
    await unchanged();
    expect(await fs.readdir(project)).toEqual(["existing.txt"]);
  });

  it.each(["read", "write"] as const)(
    "a global %s grant cannot expand the COMPLETE project",
    async (level) => {
      addAllowedPathToSession(outside, level);
      await expect(
        saveGeneratedFiles(project, [
          file("existing.txt", "modify"),
          file(path.join(outside, "sentinel.txt"), "modify"),
        ]),
      ).rejects.toThrow();
      await unchanged();
    },
  );

  it("deletes an internal symlink entry without deleting its target", async () => {
    const link = path.join(project, "link.txt");
    await fs.symlink(existing, link);
    await saveGeneratedFiles(project, [file("link.txt", "delete")]);
    await missing(link);
    await unchanged();
  });

  it("ignores an ENOENT deletion without creating its missing parent directories", async () => {
    await saveGeneratedFiles(project, [file("missing/deep/file.txt", "delete")]);
    await missing(path.join(project, "missing"));
    await unchanged();
  });

  it("propagates unlink EACCES instead of treating every deletion failure as missing", async () => {
    const denied = Object.assign(new Error("deletion denied"), { code: "EACCES" });
    const unlink = vi.spyOn(fs, "unlink").mockImplementationOnce(async (input) => {
      expect(input).toBe(existing);
      throw denied;
    });
    await expect(saveGeneratedFiles(project, [file("existing.txt", "delete")])).rejects.toThrow();
    expect(unlink).toHaveBeenCalledWith(existing);
    await unchanged();
  });
});
