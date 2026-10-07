/** Exercise the gate as a real process, with local executable fixtures. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/release-gate.mjs", import.meta.url));
const entries = [
  "typescript/bin/tsc",
  "oxlint/bin/oxlint",
  "oxfmt/bin/oxfmt",
  "vitest/vitest.mjs",
  "tsup/dist/cli-default.js",
];
const stages = ["tsc", "oxlint", "oxfmt", "main", "repl", "build"];

describe("release gate process", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "coco-release-gate-"));
    await writeFile(path.join(dir, "package.json"), '{"type":"module"}');
    for (const entry of entries) {
      const name = entry.startsWith("typescript")
        ? "tsc"
        : entry.startsWith("tsup")
          ? "build"
          : entry.split("/")[0];
      const target = path.join(dir, "node_modules", entry);
      await mkdir(path.dirname(target), { recursive: true });
      // .mjs is ESM; use CommonJS-compatible dynamic import for extensionless bins.
      await writeFile(
        target,
        `import('node:fs').then(({appendFileSync}) => {
          const stage = ${JSON.stringify(name)} === 'vitest'
            ? (process.argv.includes('--config') ? 'repl' : 'main') : ${JSON.stringify(name)};
          appendFileSync('calls.jsonl', JSON.stringify({stage,args:process.argv.slice(2)})+'\\n');
          if (process.env.GATE_FIXTURE_FAIL === stage) process.exit(23);
          if (process.env.GATE_FIXTURE_SIGNAL === stage) process.kill(process.pid, 'SIGTERM');
        });`,
      );
    }
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function run(extra: Record<string, string> = {}) {
    return spawnSync(process.execPath, [script], {
      cwd: dir,
      env: { ...process.env, GATE_FIXTURE_FAIL: "", GATE_FIXTURE_SIGNAL: "", ...extra },
      encoding: "utf8",
      timeout: 10000,
    });
  }

  async function calls(): Promise<Array<{ stage: string; args: string[] }>> {
    return (await readFile(path.join(dir, "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("runs all checks, including full suite, separate REPL and build", async () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("All checks passed");
    const executed = await calls();
    expect(executed.map((call) => call.stage)).toEqual(stages);
    expect(executed[3]?.args).toEqual(["run", "--coverage", "--maxWorkers=4"]);
    expect(executed[4]?.args).toEqual(["run", "--config", "vitest.repl.config.ts"]);
  });

  it.each(stages)("fails immediately when %s fails", async (stage) => {
    const result = run({ GATE_FIXTURE_FAIL: stage });
    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain("All checks passed");
    expect(result.stderr).toContain("FAILED");
    expect((await calls()).map((call) => call.stage)).toEqual(
      stages.slice(0, stages.indexOf(stage) + 1),
    );
  });

  it("does not use a global binary if a local dependency is missing", async () => {
    await rm(path.join(dir, "node_modules", entries[0]!));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing local dependency");
    expect(result.stdout).not.toContain("All checks passed");
  });

  it("fails when a check terminates by signal", async () => {
    const result = run({ GATE_FIXTURE_SIGNAL: "tsc" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("All checks passed");
    expect((await calls()).map((call) => call.stage)).toEqual(["tsc"]);
  });
});
