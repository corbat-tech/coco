import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const buildUrl = new URL("./build.ts", import.meta.url).href;
const resumeUrl = new URL("./resume.ts", import.meta.url).href;
const commanderUrl = import.meta.resolve("commander");
const tsxUrl = import.meta.resolve("tsx");

describe("unavailable legacy commands", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "coco-legacy-"));
    await mkdir(path.join(dir, ".coco/planning"), { recursive: true });
    await writeFile(path.join(dir, ".coco/planning/backlog.json"), '{"tasks":[]}');
    await writeFile(path.join(dir, "user.txt"), "existing work");
    await writeFile(
      path.join(dir, "cli.mjs"),
      `
      import {Command} from ${JSON.stringify(commanderUrl)};
      import {registerBuildCommand} from ${JSON.stringify(buildUrl)};
      import {registerResumeCommand} from ${JSON.stringify(resumeUrl)};
      const program=new Command();
      registerBuildCommand(program); registerResumeCommand(program);
      await program.parseAsync(process.argv);
    `,
    );
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it.each([
    { name: "build", args: ["build"] },
    { name: "build filtered", args: ["build", "--task", "task-1", "--no-review"] },
    { name: "resume", args: ["resume"] },
    { name: "resume --list", args: ["resume", "--list"] },
    { name: "resume forced", args: ["resume", "--checkpoint", "missing", "--force"] },
  ])("rejects $name without simulated results or writes", async ({ args }) => {
    const before = await readdir(dir, { recursive: true });
    const result = spawnSync(
      process.execPath,
      ["--import", tsxUrl, path.join(dir, "cli.mjs"), ...args],
      {
        cwd: dir,
        encoding: "utf8",
        timeout: 4000,
        env: { ...process.env, NO_COLOR: "1" },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not implemented");
    expect(result.stdout).not.toMatch(/Tests passed|Build complete|State restored|cp-2024/);
    expect(await readdir(dir, { recursive: true })).toEqual(before);
    expect(await readFile(path.join(dir, "user.txt"), "utf8")).toBe("existing work");
    expect(await readFile(path.join(dir, ".coco/planning/backlog.json"), "utf8")).toBe(
      '{"tasks":[]}',
    );
  });
  it.each(["build", "resume"])("describes %s as unavailable in help", (command) => {
    const result = spawnSync(
      process.execPath,
      ["--import", tsxUrl, path.join(dir, "cli.mjs"), command, "--help"],
      {
        cwd: dir,
        encoding: "utf8",
        timeout: 4000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("not implemented");
  });
});
