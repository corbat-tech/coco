import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { undoCommand } from "./undo.js";
import type { ReplSession } from "../types.js";

describe("undo preserves user changes without a verified agent snapshot", () => {
  let project: string;
  let session: ReplSession;
  let gitEnv: NodeJS.ProcessEnv;
  let output: ReturnType<typeof vi.spyOn>;
  const injectionName = "$(touch marker).txt";
  const quotedName = "a file with 'single' and \"double\" quotes.txt";
  const files = ["tracked.txt", "staged.txt", injectionName, quotedName, "untracked.txt"];

  function git(...args: string[]): string {
    return execFileSync("git", args, {
      cwd: project,
      env: gitEnv,
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  }

  async function state() {
    return {
      head: git("rev-parse", "HEAD"),
      index: await fs.readFile(path.join(project, ".git", "index")),
      contents: await Promise.all(
        files.map((name) => fs.readFile(path.join(project, name), "utf8")),
      ),
      names: (await fs.readdir(project)).sort(),
    };
  }

  beforeEach(async () => {
    project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "coco-undo-")));
    gitEnv = {
      PATH: process.env.PATH,
      HOME: project,
      TMPDIR: project,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    git("init", "--quiet");
    git("config", "user.name", "Undo Fixture");
    git("config", "user.email", "undo-fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "core.hooksPath", path.join(project, "no-hooks"));
    for (const name of files.slice(0, -1))
      await fs.writeFile(path.join(project, name), "committed original");
    git("add", "--", ...files.slice(0, -1));
    git("commit", "--quiet", "-m", "fixture first");
    await fs.writeFile(path.join(project, "tracked.txt"), "committed second");
    git("add", "--", "tracked.txt");
    git("commit", "--quiet", "-m", "fixture second");
    await fs.writeFile(path.join(project, "staged.txt"), "user staged change");
    git("add", "--", "staged.txt");
    await fs.writeFile(path.join(project, "staged.txt"), "user staged plus unstaged change");
    await fs.writeFile(path.join(project, "tracked.txt"), "user unstaged change");
    await fs.writeFile(path.join(project, injectionName), "user injection-named change");
    await fs.writeFile(path.join(project, quotedName), "user quoted-name change");
    await fs.writeFile(path.join(project, "untracked.txt"), "user untracked change");
    session = { projectPath: project } as ReplSession;
    output = vi.spyOn(console, "log").mockImplementation(() => {});
    // The actual command also inherits these protections when it invokes Git.
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(project, { recursive: true, force: true });
  });

  it.each(["tracked.txt", "staged.txt", "untracked.txt", quotedName])(
    "file undo leaves HEAD, index, and all user files unchanged for %s",
    async (name) => {
      const before = await state();
      await expect(undoCommand.execute([name], session)).resolves.toBe(false);
      expect(await state()).toEqual(before);
      expect(output.mock.calls.flat().join(" ")).toMatch(
        /unavailable|disabled|no verified snapshot/i,
      );
      expect(output.mock.calls.flat().join(" ")).not.toMatch(/✓.*Restored/i);
    },
  );

  it("does not interpret shell substitution in a filename or alter its contents", async () => {
    const before = await state();
    await undoCommand.execute([injectionName], session);
    await expect(fs.lstat(path.join(project, "marker"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await state()).toEqual(before);
  });

  it("no arguments show truthful unavailable guidance without changing files", async () => {
    const before = await state();
    await undoCommand.execute([], session);
    expect(await state()).toEqual(before);
    expect(output.mock.calls.flat().join(" ")).toMatch(
      /unavailable|disabled|no verified snapshot/i,
    );
  });

  it.each([
    ["--last-commit", "tracked.txt"],
    ["tracked.txt", "--last-commit"],
    ["--last-commit", "--last-commit"],
    ["--unknown"],
  ])("mixed or unsupported arguments remain a no-op: %j", async (...args) => {
    const before = await state();
    await undoCommand.execute(args, session);
    expect(await state()).toEqual(before);
  });

  it("the exact --last-commit command moves only HEAD while preserving index and worktree", async () => {
    const previousHead = git("rev-parse", "HEAD~1");
    const before = await state();
    await expect(undoCommand.execute(["--last-commit"], session)).resolves.toBe(false);
    const after = await state();
    expect(after.head).toBe(previousHead);
    expect(after.head).not.toBe(before.head);
    expect(after.index).toEqual(before.index);
    expect(after.contents).toEqual(before.contents);
    expect(after.names).toEqual(before.names);
  });
});
