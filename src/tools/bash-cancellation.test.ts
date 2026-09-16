import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bashExecTool } from "./bash.js";
import { TimeoutError } from "../utils/errors.js";
import { _activeSubprocessCount } from "../utils/subprocess-registry.js";

const mocked = vi.hoisted(() => ({ execa: vi.fn() }));
vi.mock("execa", () => ({ execa: mocked.execa }));

function subprocess(result: Record<string, unknown>, rejected = false) {
  let trackedDuringRun = 0;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const existingListener = vi.fn();
  stdout.on("data", existingListener);
  let finish!: (value: Record<string, unknown>) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const proc = Object.assign(promise, { stdout, stderr, killed: false, kill: vi.fn() });
  mocked.execa.mockImplementation(() => {
    queueMicrotask(() => {
      trackedDuringRun = _activeSubprocessCount();
      stdout.emit("data", Buffer.from("fixture stdout"));
      stderr.emit("data", Buffer.from("fixture stderr"));
      if (rejected) fail(result);
      else finish(result);
    });
    return proc;
  });
  return { proc, stdout, stderr, existingListener, trackedDuringRun: () => trackedDuringRun };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  mocked.execa.mockReset();
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(async () => {
  await Promise.resolve();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function expectCleanup(proc: ReturnType<typeof subprocess>) {
  expect(vi.getTimerCount()).toBe(0);
  expect(proc.stdout.listeners("data")).toEqual([proc.existingListener]);
  expect(proc.stderr.listenerCount("data")).toBe(0);
  expect(_activeSubprocessCount()).toBe(0);
}

describe("bash_exec cancellation and terminal outcomes", () => {
  it("rejects a pre-aborted host context before spawning or starting heartbeat timers", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      bashExecTool.execute({ command: "fixture-command" }, { signal: controller.signal }),
    ).rejects.toThrow(/abort|cancel/i);
    expect(mocked.execa).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards cancellation and force-kill delay, tracks the process, and cleans up normal completion", async () => {
    const controller = new AbortController();
    const proc = subprocess({ exitCode: 0 });
    const result = await bashExecTool.execute(
      { command: "fixture-command", timeout: 1234 },
      { signal: controller.signal },
    );
    expect(mocked.execa).toHaveBeenCalledWith(
      "fixture-command",
      expect.objectContaining({
        detached: process.platform !== "win32",
        buffer: false,
        timeout: 0,
        reject: false,
      }),
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "fixture stdout",
      stderr: "fixture stderr",
    });
    expect(proc.trackedDuringRun()).toBe(1);
    expectCleanup(proc);
  });

  it.each([
    { isCanceled: true, exitCode: 0 },
    { signal: "SIGTERM", exitCode: undefined },
    { exitCode: null },
    {},
  ])("does not report successful execution for terminal flags %j", async (outcome) => {
    const proc = subprocess(outcome);
    await expect(bashExecTool.execute({ command: "fixture-command" })).rejects.toThrow();
    expectCleanup(proc);
  });

  it.each([false, true])(
    "normalizes timeout to TimeoutError when execa rejects=%s",
    async (rejects) => {
      const proc = subprocess({ timedOut: true, exitCode: 0, message: "fixture timeout" }, rejects);
      await expect(
        bashExecTool.execute({ command: "fixture-command", timeout: 25 }),
      ).rejects.toBeInstanceOf(TimeoutError);
      expectCleanup(proc);
    },
  );

  it("cleans up a rejected cancellation as well as a resolved cancellation flag", async () => {
    const proc = subprocess({ isCanceled: true, message: "fixture aborted" }, true);
    await expect(bashExecTool.execute({ command: "fixture-command" })).rejects.toThrow(
      /abort|cancel/i,
    );
    expectCleanup(proc);
  });

  it("preserves ordinary numeric nonzero exit status and captured output", async () => {
    const proc = subprocess({ exitCode: 7 });
    await expect(bashExecTool.execute({ command: "fixture-command" })).resolves.toMatchObject({
      exitCode: 7,
      stdout: "fixture stdout",
      stderr: "fixture stderr",
    });
    expectCleanup(proc);
  });
});

it("caps capture and terminal forwarding while draining oversized output", async () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  mocked.execa.mockImplementation(() =>
    Object.assign(
      new Promise((resolve) => {
        queueMicrotask(() => {
          for (let i = 0; i < 64; i++) {
            stdout.emit("data", Buffer.alloc(65536, "x"));
            stderr.emit("data", Buffer.alloc(65536, "y"));
          }
          resolve({ exitCode: 0 });
        });
      }),
      { stdout, stderr, kill: vi.fn(), killed: false },
    ),
  );
  const result = await bashExecTool.execute({ command: "fixture-large-output" });
  const stdoutWrites = vi
    .mocked(process.stdout.write)
    .mock.calls.map(([data]) => String(data))
    .join("");
  const stderrWrites = vi
    .mocked(process.stderr.write)
    .mock.calls.map(([data]) => String(data))
    .join("");
  expect(Buffer.byteLength(stdoutWrites)).toBeLessThan(1024 * 1024 + 150);
  expect(Buffer.byteLength(stderrWrites)).toBeLessThan(1024 * 1024 + 150);
  expect(stdoutWrites.match(/capture limit reached/g)).toHaveLength(1);
  expect(stderrWrites.match(/capture limit reached/g)).toHaveLength(1);
  expect(result.stdout).toContain("Output truncated");
  expect(result.stderr).toContain("Output truncated");
  expect(result.stdout.length).toBeLessThan(50200);
  expect(mocked.execa).toHaveBeenCalledWith(
    "fixture-large-output",
    expect.objectContaining({ buffer: false, maxBuffer: 1024 * 1024 }),
  );
});
