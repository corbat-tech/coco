import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as execaModule from "execa";
import { expect, it, vi } from "vitest";
import { bashExecTool } from "../src/tools/bash.js";
import { _activeSubprocessCount } from "../src/utils/subprocess-registry.js";

vi.mock("execa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("execa")>();
  return { ...actual, execa: vi.fn(actual.execa) };
});

it.skipIf(process.platform === "win32")(
  "aborts an owned shell-exec Node process after READY and waits for its exit",
  async () => {
    const directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "coco-bash-abort-")),
    );
    const script = path.join(directory, "fixture.cjs");
    await fs.writeFile(script, 'process.stdout.write("READY\\n"); setInterval(() => {}, 1000);\n');
    const controller = new AbortController();
    const { execa: actualExeca } = await vi.importActual<typeof import("execa")>("execa");
    let owned: ReturnType<typeof actualExeca> | undefined;
    let ready!: () => void;
    const readiness = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
    // Retain an actual ChildProcess handle for cleanup. Override only its environment
    // to prevent this fixture from inheriting credentials or shell initialization.
    const spy = vi.mocked(execaModule.execa).mockImplementation(((
      command: string,
      options: execaModule.Options,
    ) => {
      owned = actualExeca(command, {
        ...options,
        shell: "/bin/sh",
        extendEnv: false,
        env: {
          PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
          TMPDIR: directory,
        },
      });
      let stdout = "";
      owned.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
        if (stdout.includes("READY")) {
          controller.abort();
          ready();
        }
      });
      return owned;
    }) as typeof actualExeca);
    let pending: Promise<{ error?: unknown; value?: unknown }> | undefined;
    try {
      pending = bashExecTool
        .execute(
          {
            command: `exec ${quote(process.execPath)} ${quote(script)}`,
            cwd: directory,
            timeout: 10000,
          },
          { signal: controller.signal },
        )
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      expect(
        await Promise.race([readiness.then(() => "ready"), pending.then(() => "finished")]),
      ).toBe("ready");
      const outcome = await pending;
      expect(outcome.value).toBeUndefined();
      expect(outcome.error).toBeInstanceOf(Error);
      expect((outcome.error as Error).message).toMatch(/abort|cancel/i);
      expect(owned).toBeDefined();
      // A real exitCode/signalCode on our own handle is stronger than killed=true.
      expect(owned!.exitCode !== null || owned!.signalCode !== null).toBe(true);
      expect(_activeSubprocessCount()).toBe(0);
    } finally {
      controller.abort();
      if (owned && owned.exitCode === null && owned.signalCode === null) owned.kill("SIGKILL");
      if (owned) await owned.catch(() => {});
      if (pending) await pending;
      spy.mockImplementation(actualExeca);
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
  20000,
);
