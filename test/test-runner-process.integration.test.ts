import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as execaModule from "execa";
import { expect, it, vi } from "vitest";
import { runTestsTool } from "../src/tools/test.js";
import { _activeSubprocessCount } from "../src/utils/subprocess-registry.js";

vi.mock("execa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("execa")>();
  return { ...actual, execa: vi.fn(actual.execa) };
});

it.each(["cancel", "shell exit"] as const)(
  "cleans owned TERM-resistant descendants after %s without killing another invocation",
  async (mode) => {
    if (process.platform === "win32") return;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "coco-test-group-"));
    const marker = path.join(directory, "escaped-marker");
    const survivor = path.join(directory, "unrelated-marker");
    const descendant = path.join(directory, "descendant.cjs");
    const parent = path.join(directory, "parent.cjs");
    await fs.writeFile(
      descendant,
      `process.on('SIGTERM', () => {}); process.stdout.write('READY\\n'); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'escaped'), 4500); setInterval(() => {}, 1000);`,
    );
    await fs.writeFile(
      parent,
      `const child = require('node:child_process').spawn(process.execPath, [${JSON.stringify(descendant)}], {stdio:['ignore','pipe','inherit']}); child.stdout.on('data', data => { process.stdout.write(data); ${mode === "shell exit" ? "process.exit(0);" : ""} }); setInterval(() => {},1000);`,
    );
    const { execa: actualExeca } = await vi.importActual<typeof import("execa")>("execa");
    const environment = {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      TMPDIR: directory,
    };
    const unrelated = actualExeca(
      process.execPath,
      [
        "-e",
        `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(survivor)}, 'alive'), 5000)`,
      ],
      { env: environment, extendEnv: false },
    );
    const controller = new AbortController();
    let owned: ReturnType<typeof actualExeca> | undefined;
    const spy = vi.mocked(execaModule.execa).mockImplementation(((
      _command: string,
      _args: string[],
      options: execaModule.Options,
    ) => {
      owned = actualExeca(process.execPath, [parent], {
        ...options,
        env: environment,
        extendEnv: false,
      });
      owned.stdout?.on("data", (chunk) => {
        if (mode === "cancel" && String(chunk).includes("READY"))
          controller.abort(new Error("owned cancellation"));
      });
      return owned;
    }) as typeof actualExeca);
    let pending: Promise<unknown> | undefined;
    try {
      pending = runTestsTool.execute(
        {
          framework: "vitest",
          cwd: directory,
        },
        { signal: controller.signal },
      );
      if (mode === "cancel") await expect(pending).rejects.toThrow("owned cancellation");
      else expect(await pending).toMatchObject({ success: true });
      expect(owned!.exitCode !== null || owned!.signalCode !== null).toBe(true);
      await unrelated;
      await expect(fs.readFile(survivor, "utf8")).resolves.toBe("alive");
      await expect(fs.access(marker)).rejects.toMatchObject({ code: "ENOENT" });
      expect(_activeSubprocessCount()).toBe(0);
    } finally {
      controller.abort();
      if (owned?.pid) {
        try {
          process.kill(-owned.pid, "SIGKILL");
        } catch {
          /* Already closed own group. */
        }
      }
      await pending?.catch(() => {});
      if (unrelated.exitCode === null) unrelated.kill("SIGKILL");
      await unrelated.catch(() => {});
      spy.mockImplementation(actualExeca);
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
  20000,
);

it("rejects oversized multibyte output instead of accepting a partial report", async () => {
  const { execa: actualExeca } = await vi.importActual<typeof import("execa")>("execa");
  const spy = vi
    .mocked(execaModule.execa)
    .mockImplementation(((_command: string, _args: string[], options: execaModule.Options) =>
      actualExeca(process.execPath, ["-e", 'process.stdout.write("😀".repeat(5 * 1024 * 1024));'], {
        ...options,
        extendEnv: false,
      })) as typeof actualExeca);
  try {
    await expect(runTestsTool.execute({ framework: "vitest" })).rejects.toThrow(/16 MiB/);
    expect(_activeSubprocessCount()).toBe(0);
  } finally {
    spy.mockImplementation(actualExeca);
  }
});
