import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { createCheckpointTool, restoreCheckpointTool, listCheckpointsTool } from "./checkpoint.js";

describe("checkpoint tools preserve repository and user state", () => {
  let temporary: string, root: string;
  const git = async (...args: string[]) => (await execa("git", args, { cwd: root })).stdout;
  const create = () => createCheckpointTool.execute({ description: "before refactor" });
  const restore = (id: string) => restoreCheckpointTool.execute({ id });
  const metadata = () => path.join(root, ".coco/checkpoints.json");
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "coco-checkpoint-tools-"));
    root = path.join(temporary, "project");
    await fs.mkdir(root);
    await git("init", "-q");
    await git("config", "user.email", "fixture@example.invalid");
    await git("config", "user.name", "Fixture");
    await fs.writeFile(path.join(root, "alpha.txt"), "original\n");
    await fs.writeFile(path.join(root, "beta.txt"), "untouched\n");
    await fs.writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
    await git("add", "alpha.txt", "beta.txt", ".gitignore");
    await git("commit", "-qm", "Fixture");
    vi.spyOn(process, "cwd").mockImplementation(() => root);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(temporary, { recursive: true, force: true });
  });
  async function changed() {
    await fs.writeFile(path.join(root, "alpha.txt"), "staged\n");
    await git("add", "alpha.txt");
    await fs.writeFile(path.join(root, "alpha.txt"), "unstaged\n");
  }
  it("creation preserves distinct staged and unstaged bytes, HEAD and stash stack", async () => {
    await changed();
    const index = await git("ls-files", "--stage"),
      head = await git("rev-parse", "HEAD"),
      stashes = await git("stash", "list");
    const cp = await create();
    expect(cp).toMatchObject({ method: "stash", fileCount: 1, files: ["alpha.txt"] });
    expect(await git("ls-files", "--stage")).toBe(index);
    expect(await git("show", ":alpha.txt")).toBe("staged");
    expect(await fs.readFile(path.join(root, "alpha.txt"), "utf8")).toBe("unstaged\n");
    expect(await git("rev-parse", "HEAD")).toBe(head);
    expect(await git("stash", "list")).toBe(stashes);
    const entry = JSON.parse(await fs.readFile(metadata(), "utf8"))[0];
    expect(await git("rev-parse", `refs/coco/checkpoints/${cp.id}`)).toBe(entry.stashOid);
    expect((await fs.stat(metadata())).mode & 0o777).toBe(0o600);
  });
  it("restores exact immutable snapshot including staging after caller independently cleans tracked work", async () => {
    await changed();
    const cp = await create();
    await git("restore", "--staged", "--worktree", ".");
    await fs.writeFile(path.join(root, "beta.txt"), "unrelated saved work");
    await git("stash", "push", "-m", "user-owned stash");
    const userStashes = await git("stash", "list");
    expect((await restore(cp.id)).restored).toBe(true);
    expect(await git("stash", "list")).toBe(userStashes);
    expect(await git("show", ":alpha.txt")).toBe("staged");
    expect(await fs.readFile(path.join(root, "alpha.txt"), "utf8")).toBe("unstaged\n");
    expect(await fs.readFile(path.join(root, "beta.txt"), "utf8")).toBe("untouched\n");
  });
  it("rejects untracked capture without staging or losing user files", async () => {
    await fs.writeFile(path.join(root, "draft.txt"), "precious");
    const index = await git("ls-files", "--stage");
    await expect(create()).rejects.toThrow(/Untracked/);
    expect(await fs.readFile(path.join(root, "draft.txt"), "utf8")).toBe("precious");
    expect(await git("ls-files", "--stage")).toBe(index);
    await expect(fs.access(metadata())).rejects.toThrow();
  });
  it.each(["tracked", "untracked", "staged"])(
    "refuses %s work on restore and preserves its bytes",
    async (kind) => {
      await changed();
      const cp = await create();
      await git("restore", "--staged", "--worktree", ".");
      const file = kind === "untracked" ? "draft.txt" : "beta.txt";
      await fs.writeFile(path.join(root, file), "user work");
      if (kind === "staged") await git("add", file);
      const index = await git("ls-files", "--stage");
      await expect(restore(cp.id)).rejects.toThrow(/not clean/);
      expect(await fs.readFile(path.join(root, file), "utf8")).toBe("user work");
      expect(await git("ls-files", "--stage")).toBe(index);
      expect(await fs.readFile(path.join(root, "alpha.txt"), "utf8")).toBe("original\n");
    },
  );
  it("refuses changed HEAD even with clean files", async () => {
    await changed();
    const cp = await create();
    await git("restore", "--staged", "--worktree", ".");
    await git("commit", "--allow-empty", "-qm", "later work");
    await expect(restore(cp.id)).rejects.toThrow(/HEAD changed/);
    expect(await fs.readFile(path.join(root, "alpha.txt"), "utf8")).toBe("original\n");
  });
  it("requires canonical Git root and rejects foreign metadata binding", async () => {
    const cp = await create();
    const actual = root;
    await fs.mkdir(path.join(root, "nested"));
    root = path.join(root, "nested");
    await expect(create()).rejects.toThrow(/repository root/);
    root = actual;
    const entries = JSON.parse(await fs.readFile(metadata(), "utf8"));
    entries[0].projectRoot = temporary;
    await fs.writeFile(metadata(), JSON.stringify(entries));
    await expect(restore(cp.id)).rejects.toThrow(/foreign/);
  });
  it("keeps legacy checkpoints readable but refuses restoring their ambiguous stash references", async () => {
    await fs.mkdir(path.dirname(metadata()));
    await fs.writeFile(
      metadata(),
      JSON.stringify([
        {
          id: "legacy",
          description: "old",
          timestamp: "old",
          fileCount: 1,
          files: ["alpha.txt"],
          stashRef: "coco-cp-old",
        },
      ]),
    );
    expect((await listCheckpointsTool.execute({})).total).toBe(1);
    await expect(restore("legacy")).rejects.toThrow(/read-only/);
  });
  it("never overwrites invalid metadata", async () => {
    await fs.mkdir(path.dirname(metadata()));
    await fs.writeFile(metadata(), "{invalid");
    await expect(create()).rejects.toThrow();
    expect(await fs.readFile(metadata(), "utf8")).toBe("{invalid");
  });
  it.each(["directory-link", "file-link", "hardlink"])(
    "protects external metadata sentinel against %s",
    async (kind) => {
      const outside = path.join(temporary, "outside");
      await fs.mkdir(outside);
      const sentinel = path.join(outside, "checkpoints.json");
      await fs.writeFile(sentinel, "sentinel");
      if (kind === "directory-link") await fs.symlink(outside, path.dirname(metadata()));
      else {
        await fs.mkdir(path.dirname(metadata()));
        if (kind === "file-link") await fs.symlink(sentinel, metadata());
        else await fs.link(sentinel, metadata());
      }
      await expect(create()).rejects.toThrow();
      expect(await fs.readFile(sentinel, "utf8")).toBe("sentinel");
    },
  );
  it("refuses concurrent metadata ownership without deleting another lock", async () => {
    await fs.mkdir(path.dirname(metadata()));
    const lock = path.join(root, ".coco/checkpoints.lock");
    await fs.writeFile(lock, "other owner");
    await expect(create()).rejects.toThrow(/locked/);
    expect(await fs.readFile(lock, "utf8")).toBe("other owner");
  });
  it("clean checkpoints are bound reference points, not permission to discard later work", async () => {
    const cp = await create();
    expect(cp.method).toBe("clean");
    expect((await restore(cp.id)).restored).toBe(false);
    await fs.writeFile(path.join(root, "alpha.txt"), "new work");
    await expect(restore(cp.id)).rejects.toThrow(/not clean/);
    expect(await fs.readFile(path.join(root, "alpha.txt"), "utf8")).toBe("new work");
  });
  it("protects ignored rename destinations independently of Git rename detection", async () => {
    await git("mv", "alpha.txt", "ignored.txt");
    await git("config", "diff.renames", "true");
    const cp = await create();
    await git("restore", "--staged", "--worktree", ".");
    await fs.writeFile(path.join(root, "ignored.txt"), "user-owned ignored destination");
    await expect(restore(cp.id)).rejects.toThrow(/existing untracked or ignored/);
    expect(await fs.readFile(path.join(root, "ignored.txt"), "utf8")).toBe(
      "user-owned ignored destination",
    );
    expect(await fs.readFile(path.join(root, "alpha.txt"), "utf8")).toBe("original\n");
  });
  it("protects ignored user files at paths added by a checkpoint", async () => {
    await fs.writeFile(path.join(root, "ignored.txt"), "snapshot");
    await git("add", "-f", "ignored.txt");
    const cp = await create();
    await git("restore", "--staged", "--worktree", ".");
    await fs.writeFile(path.join(root, "ignored.txt"), "precious ignored file");
    await expect(restore(cp.id)).rejects.toThrow(/existing untracked or ignored/);
    expect(await fs.readFile(path.join(root, "ignored.txt"), "utf8")).toBe("precious ignored file");
  });
});
