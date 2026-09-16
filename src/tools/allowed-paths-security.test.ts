import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("canonical allowed-path grants (real filesystem)", () => {
  let fixture: string;
  let project: string;
  let targetA: string;
  let targetB: string;
  let alias: string;
  let storeFile: string;
  let grants: typeof import("./allowed-paths.js");
  let policy: typeof import("./file-path-policy.js");

  beforeEach(async () => {
    fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "coco-grants-")));
    project = path.join(fixture, "project");
    targetA = path.join(fixture, "target-a");
    targetB = path.join(fixture, "target-b");
    alias = path.join(fixture, "alias");
    const configHome = path.join(fixture, "config");
    storeFile = path.join(configHome, "allowed-paths.json");
    await Promise.all([project, targetA, targetB].map((dir) => fs.mkdir(dir)));
    await fs.writeFile(path.join(targetA, "sentinel.txt"), "A");
    await fs.writeFile(path.join(targetB, "sentinel.txt"), "B");
    await fs.symlink(targetA, alias, "dir");
    vi.resetModules();
    vi.doMock("../config/paths.js", () => ({ CONFIG_PATHS: { home: configHome } }));
    grants = await import("./allowed-paths.js");
    policy = await import("./file-path-policy.js");
  });

  afterEach(async () => {
    grants?.clearSessionAllowedPaths();
    vi.doUnmock("../config/paths.js");
    vi.resetModules();
    await fs.rm(fixture, { recursive: true, force: true });
  });

  const resolve = (dir: string, operation: "read" | "write" = "read") =>
    policy.resolvePathSecurely(path.join(dir, "sentinel.txt"), operation, {
      projectRoot: project,
      allowHomeConfigReads: false,
    });

  async function retargetAlias(): Promise<void> {
    await fs.unlink(alias);
    await fs.symlink(targetB, alias, "dir");
  }

  it("pins an alias grant to its original destination after alias retargeting", async () => {
    grants.addAllowedPathToSession(alias, "write");
    expect(grants.getAllowedPaths()[0]?.path).toBe(targetA);
    await expect(resolve(alias, "write")).resolves.toBe(path.join(targetA, "sentinel.txt"));
    await retargetAlias();
    await expect(resolve(targetA, "write")).resolves.toBe(path.join(targetA, "sentinel.txt"));
    await expect(resolve(alias, "write")).rejects.toThrow(/outside project/);
    await expect(resolve(targetB, "write")).rejects.toThrow(/outside project/);
    // Validation only: these helpers do not perform file-tool effects.
    expect(await fs.readFile(path.join(targetB, "sentinel.txt"), "utf8")).toBe("B");
  });

  it("rejects a destination changed while the user was considering the prompt", async () => {
    await grants.loadAllowedPaths(project);
    const displayed = grants.canonicalizeAllowedDirectory(alias);
    await fs.rename(targetA, path.join(fixture, "saved-a"));
    await fs.symlink(targetB, targetA, "dir");
    expect(() => grants.addAllowedPathToSession(displayed, "write", displayed)).toThrow(
      /changed after confirmation/,
    );
    await expect(grants.persistAllowedPath(displayed, "write", displayed)).rejects.toThrow(
      /changed after confirmation/,
    );
    expect(grants.getAllowedPaths()).toEqual([]);
    await expect(fs.stat(storeFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("denies a pinned directory subsequently replaced by an external symlink", async () => {
    grants.addAllowedPathToSession(targetA, "write");
    await fs.rename(targetA, path.join(fixture, "saved-a"));
    await fs.symlink(targetB, targetA, "dir");
    await expect(resolve(targetA, "write")).rejects.toThrow(/outside project/);
    await expect(resolve(targetB)).rejects.toThrow(/outside project/);
    expect(await fs.readFile(path.join(targetB, "sentinel.txt"), "utf8")).toBe("B");
  });

  it("persists the canonical destination and reloads it after its alias changes", async () => {
    await grants.loadAllowedPaths(project);
    await grants.persistAllowedPath(alias, "read");
    const stored = JSON.parse(await fs.readFile(storeFile, "utf8"));
    expect(stored.projects[project]).toEqual([
      { path: targetA, level: "read", authorizedAt: expect.any(String) },
    ]);
    grants.clearSessionAllowedPaths();
    await retargetAlias();
    await grants.loadAllowedPaths(project);
    await expect(resolve(targetA)).resolves.toBe(path.join(targetA, "sentinel.txt"));
    await expect(resolve(targetB)).rejects.toThrow(/outside project/);
  });

  it("ignores legacy alias and missing-directory records instead of granting new targets", async () => {
    await retargetAlias();
    await fs.mkdir(path.dirname(storeFile));
    await fs.writeFile(
      storeFile,
      JSON.stringify({
        version: 1,
        projects: {
          [project]: [alias, path.join(fixture, "missing")].map((dir) => ({
            path: dir,
            level: "write",
            authorizedAt: "2026-01-01T00:00:00Z",
          })),
        },
      }),
    );
    await grants.loadAllowedPaths(project);
    expect(grants.getAllowedPaths()).toEqual([]);
    await expect(resolve(targetB, "write")).rejects.toThrow(/outside project/);
  });

  it("does not inherit session grants when switching projects", async () => {
    await grants.loadAllowedPaths(project);
    grants.addAllowedPathToSession(targetA, "write");
    const otherProject = path.join(fixture, "other-project");
    await fs.mkdir(otherProject);
    await grants.loadAllowedPaths(otherProject);
    expect(grants.getAllowedPaths()).toEqual([]);
    await expect(resolve(targetA, "write")).rejects.toThrow(/outside project/);
  });

  it("returned entries cannot escalate a read grant or change its destination", async () => {
    grants.addAllowedPathToSession(targetA, "read");
    const returned = grants.getAllowedPaths();
    returned[0]!.path = targetB;
    returned[0]!.level = "write";
    expect(grants.getAllowedPaths()[0]).toMatchObject({ path: targetA, level: "read" });
    await expect(resolve(targetA)).resolves.toBe(path.join(targetA, "sentinel.txt"));
    await expect(resolve(targetA, "write")).rejects.toThrow(/outside project/);
    await expect(resolve(targetB)).rejects.toThrow(/outside project/);
  });

  it("supports an explicit read-to-write upgrade without duplicate grants, including reload", async () => {
    await grants.loadAllowedPaths(project);
    grants.addAllowedPathToSession(targetA, "read");
    await grants.persistAllowedPath(targetA, "read");
    await expect(resolve(targetA, "write")).rejects.toThrow(/outside project/);
    grants.addAllowedPathToSession(alias, "write");
    await grants.persistAllowedPath(alias, "write");
    expect(grants.getAllowedPaths()).toHaveLength(1);
    await expect(resolve(targetA, "write")).resolves.toBe(path.join(targetA, "sentinel.txt"));
    grants.clearSessionAllowedPaths();
    await grants.loadAllowedPaths(project);
    expect(grants.getAllowedPaths()).toEqual([
      { path: targetA, level: "write", authorizedAt: expect.any(String) },
    ]);
  });

  it("clearing the session also clears the project selected for persistence", async () => {
    await grants.loadAllowedPaths(project);
    await grants.persistAllowedPath(targetA, "read");
    const before = await fs.readFile(storeFile, "utf8");
    grants.clearSessionAllowedPaths();
    await grants.persistAllowedPath(targetB, "write");
    expect(grants.getAllowedPaths()).toEqual([]);
    expect(await fs.readFile(storeFile, "utf8")).toBe(before);
  });

  it("does not create a store without a selected project", async () => {
    await grants.persistAllowedPath(targetA, "write");
    await expect(fs.stat(storeFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
