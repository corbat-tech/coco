import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAllowedPathToSession,
  clearSessionAllowedPaths,
  getAllowedPaths,
} from "./allowed-paths.js";
import { authorizePathTool } from "./authorize-path.js";
import { ToolError } from "../utils/errors.js";

const cli = vi.hoisted(() => ({ imported: vi.fn(), prompt: vi.fn(async () => true) }));
vi.mock("../cli/repl/allow-path-prompt.js", () => {
  cli.imported();
  return { promptAllowPath: cli.prompt };
});

describe("authorize_path reports authority without granting it or prompting", () => {
  let previousCwd: string;
  let fixture: string;
  let project: string;
  let outside: string;
  let ttyDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    previousCwd = process.cwd();
    fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "coco-authorize-")));
    project = path.join(fixture, "project");
    outside = path.join(fixture, "outside");
    await fs.mkdir(project);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(project, "file.txt"), "inside");
    clearSessionAllowedPaths();
    ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    if (ttyDescriptor) Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    clearSessionAllowedPaths();
    await fs.rm(fixture, { recursive: true, force: true });
    expect(cli.prompt).not.toHaveBeenCalled();
    expect(cli.imported).not.toHaveBeenCalled();
  });

  it("reports an existing project directory as accessible without creating a grant", async () => {
    const result = await authorizePathTool.execute({ path: "." });
    expect(result).toMatchObject({ authorized: true, path: project });
    expect(getAllowedPaths()).toEqual([]);
  });

  it("returns the canonical path for a project directory alias", async () => {
    await fs.mkdir("nested");
    await fs.symlink(path.join(project, "nested"), "alias", "dir");
    await expect(authorizePathTool.execute({ path: "alias" })).resolves.toMatchObject({
      authorized: true,
      path: path.join(project, "nested"),
    });
    expect(getAllowedPaths()).toEqual([]);
  });

  it("an ungranted external directory requests explicit authorization without a headless prompt", async () => {
    const request = authorizePathTool.execute({ path: outside, reason: "read external project" });
    await expect(request).rejects.toBeInstanceOf(ToolError);
    await expect(request).rejects.toThrow(`Use /allow-path ${outside} to grant access`);
    expect(getAllowedPaths()).toEqual([]);
  });

  it("does not mistake an in-project symlink to an external directory for existing authority", async () => {
    await fs.symlink(outside, "escape", "dir");
    await expect(authorizePathTool.execute({ path: "escape" })).rejects.toThrow(
      `Use /allow-path ${outside} to grant access`,
    );
    expect(getAllowedPaths()).toEqual([]);
  });

  it("recognizes an explicit canonical read grant directly and through an alias without upgrading it", async () => {
    addAllowedPathToSession(outside, "read");
    const before = getAllowedPaths();
    await fs.symlink(outside, "external-alias", "dir");
    for (const input of [outside, "external-alias"]) {
      await expect(authorizePathTool.execute({ path: input })).resolves.toMatchObject({
        authorized: true,
        path: outside,
      });
    }
    expect(getAllowedPaths()).toEqual(before);
  });

  it("does not extend a pinned grant when its directory is replaced by a symlink", async () => {
    addAllowedPathToSession(outside, "read");
    const before = getAllowedPaths();
    const replacement = path.join(fixture, "replacement");
    await fs.mkdir(replacement);
    await fs.rename(outside, path.join(fixture, "original-outside"));
    await fs.symlink(replacement, outside, "dir");
    await expect(authorizePathTool.execute({ path: outside })).rejects.toThrow(
      `Use /allow-path ${replacement} to grant access`,
    );
    expect(getAllowedPaths()).toEqual(before);
  });

  it.each(["missing", "file.txt"])(
    "returns a structured denial for invalid directory %s",
    async (input) => {
      const result = await authorizePathTool.execute({ path: input });
      expect(result.authorized).toBe(false);
      expect(result.message).toEqual(expect.any(String));
      expect(result.message.length).toBeGreaterThan(0);
      expect(getAllowedPaths()).toEqual([]);
    },
  );

  it("never authorizes an embedded NUL path", async () => {
    const outcome = await authorizePathTool.execute({ path: "file.txt\0/.." }).then(
      (value) => ({ authorized: value.authorized }),
      () => ({ authorized: false }),
    );
    expect(outcome.authorized).toBe(false);
    expect(getAllowedPaths()).toEqual([]);
  });

  it("blocks both a literal system directory and a project alias to it", async () => {
    await fs.symlink("/usr", "system-alias", "dir");
    for (const input of ["/usr", "system-alias"]) {
      const result = await authorizePathTool.execute({ path: input });
      expect(result.authorized).toBe(false);
    }
    expect(getAllowedPaths()).toEqual([]);
  });
});
