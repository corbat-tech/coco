/** Real filesystem policy tests; the helper itself never performs file-tool mutations. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePathSecurely, type PathPolicyOptions } from "./file-path-policy.js";

let fixture: string;
let project: string;
let outside: string;
let sentinel: string;
let options: PathPolicyOptions;

beforeEach(async () => {
  fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "coco-path-policy-")));
  project = path.join(fixture, "project");
  outside = path.join(fixture, "outside");
  await fs.mkdir(project);
  await fs.mkdir(outside);
  await fs.mkdir(`${project}-sibling`);
  sentinel = path.join(outside, "sentinel.txt");
  await fs.writeFile(sentinel, "unchanged");
  options = { projectRoot: project, allowedPaths: [], allowHomeConfigReads: false };
});

afterEach(async () => {
  await fs.rm(fixture, { recursive: true, force: true });
});

describe("canonical file path policy", () => {
  it("rejects traversal, sibling prefixes and absolute external paths independently of HOME", async () => {
    for (const input of ["../outside/sentinel.txt", `${project}-sibling/new.txt`, sentinel]) {
      for (const operation of ["read", "write", "delete"] as const) {
        await expect(resolvePathSecurely(input, operation, options)).rejects.toThrow(
          /outside project/,
        );
      }
    }
    expect(await fs.readFile(sentinel, "utf8")).toBe("unchanged");
    await expect(fs.lstat(`${project}-sibling/new.txt`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects NUL before normalization could turn it into a valid in-project file", async () => {
    const ordinary = path.join(project, "ordinary.txt");
    await fs.writeFile(ordinary, "preserve");
    await expect(resolvePathSecurely("ordinary.txt\0", "write", options)).rejects.toThrow(
      /invalid characters/,
    );
    expect(await fs.readFile(ordinary, "utf8")).toBe("preserve");
  });

  it("resolves new nested destinations without creating parents or files", async () => {
    const expected = path.join(project, "new", "deep", "file.txt");
    expect(await resolvePathSecurely("new/deep/file.txt", "write", options)).toBe(expected);
    await expect(fs.lstat(path.join(project, "new"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an existing leaf symlink to an ungranted external file", async () => {
    const link = path.join(project, "external-link.txt");
    await fs.symlink(sentinel, link);
    for (const operation of ["read", "write", "delete"] as const) {
      await expect(resolvePathSecurely(link, operation, options)).rejects.toThrow(
        /outside project/,
      );
    }
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(sentinel, "utf8")).toBe("unchanged");
  });

  it("rejects parent symlink escape for an existing file and a missing deep destination", async () => {
    await fs.symlink(outside, path.join(project, "escape"), "dir");
    await expect(resolvePathSecurely("escape/sentinel.txt", "read", options)).rejects.toThrow(
      /outside project/,
    );
    await expect(resolvePathSecurely("escape/new/deep/file.txt", "write", options)).rejects.toThrow(
      /outside project/,
    );
    await expect(fs.lstat(path.join(outside, "new"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(sentinel, "utf8")).toBe("unchanged");
  });

  it("rejects dangling leaf and parent links instead of treating them as safe missing paths", async () => {
    const missing = path.join(outside, "missing");
    await fs.symlink(missing, path.join(project, "dangling"));
    await expect(resolvePathSecurely("dangling", "write", options)).rejects.toThrow(
      /Dangling symlink/,
    );
    await expect(resolvePathSecurely("dangling/deep/file.txt", "write", options)).rejects.toThrow(
      /Dangling symlink/,
    );
    await expect(fs.lstat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows internal links and canonicalizes a new destination through an internal parent", async () => {
    const target = path.join(project, "target");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "file.txt"), "inside");
    await fs.symlink(target, path.join(project, "alias"), "dir");
    expect(await resolvePathSecurely("alias/file.txt", "read", options)).toBe(
      path.join(target, "file.txt"),
    );
    expect(await resolvePathSecurely("alias/new/deep.txt", "write", options)).toBe(
      path.join(target, "new/deep.txt"),
    );
    await expect(fs.lstat(path.join(target, "new"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the leaf link entry for delete and explicit no-follow after authorizing its target", async () => {
    const target = path.join(project, "target.txt");
    const link = path.join(project, "link.txt");
    await fs.writeFile(target, "inside");
    await fs.symlink(target, link);
    expect(await resolvePathSecurely(link, "write", options)).toBe(target);
    expect(await resolvePathSecurely(link, "delete", options)).toBe(link);
    expect(await resolvePathSecurely(link, "write", { ...options, followLeaf: false })).toBe(link);
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe("inside");
  });

  it("supports a symlink project root using both alias-relative and canonical absolute paths", async () => {
    const alias = path.join(fixture, "project-alias");
    await fs.symlink(project, alias, "dir");
    const aliasOptions = { ...options, projectRoot: alias };
    const expected = path.join(project, "new.txt");
    expect(await resolvePathSecurely("new.txt", "write", aliasOptions)).toBe(expected);
    expect(await resolvePathSecurely(expected, "write", aliasOptions)).toBe(expected);
  });

  it("respects explicit read grants without permitting writes or deletes, including via project links", async () => {
    await fs.symlink(outside, path.join(project, "granted"), "dir");
    const grantedOptions: PathPolicyOptions = {
      ...options,
      allowedPaths: [{ path: outside, level: "read", authorizedAt: new Date(0).toISOString() }],
    };
    for (const input of [sentinel, "granted/sentinel.txt"]) {
      expect(await resolvePathSecurely(input, "read", grantedOptions)).toBe(sentinel);
      await expect(resolvePathSecurely(input, "write", grantedOptions)).rejects.toThrow(
        /outside project/,
      );
      await expect(resolvePathSecurely(input, "delete", grantedOptions)).rejects.toThrow(
        /outside project/,
      );
    }
    expect(await fs.readFile(sentinel, "utf8")).toBe("unchanged");
  });
});
