/** Lifecycle regressions: sending a signal is distinct from process settlement. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _activeSubprocessCount,
  killAllSubprocesses,
  killOrphanedTestProcesses,
  trackSubprocess,
  type TrackedProcess,
} from "./subprocess-registry.js";

const external = vi.hoisted(() => ({ execa: vi.fn() }));
vi.mock("execa", () => ({ execa: external.execa }));

const fixtures: Array<{ finish: () => void }> = [];
function processFixture(killed = false) {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const completion = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // This thenable models execa; only settlement means execution has finished.
  const proc: TrackedProcess & { kill: ReturnType<typeof vi.fn> } = {
    killed,
    kill: vi.fn((_signal?: string) => {
      proc.killed = true;
      return true;
    }),
    // eslint-disable-next-line unicorn/no-thenable -- models the execa subprocess contract
    then: completion.then.bind(completion),
  };
  fixtures.push({ finish: resolve });
  return { proc, finish: resolve, fail: () => reject(new Error("fixture process failed")) };
}

beforeEach(() => {
  vi.useFakeTimers();
  external.execa.mockClear();
  expect(_activeSubprocessCount()).toBe(0);
});

afterEach(async () => {
  // Settle every fixture, including assertion-failure paths, before draining timers.
  for (const fixture of fixtures.splice(0)) fixture.finish();
  await Promise.resolve();
  await vi.runAllTimersAsync();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("trackSubprocess completion ownership", () => {
  it("returns the process unchanged and tracks it until fulfillment", async () => {
    const { proc, finish } = processFixture();
    expect(trackSubprocess(proc)).toBe(proc);
    expect(_activeSubprocessCount()).toBe(1);
    finish();
    await Promise.resolve();
    expect(_activeSubprocessCount()).toBe(0);
  });

  it("removes rejected subprocesses without leaving an unhandled cleanup rejection", async () => {
    const { proc, fail } = processFixture();
    trackSubprocess(proc);
    fail();
    await Promise.resolve();
    expect(_activeSubprocessCount()).toBe(0);
    expect(proc.kill).not.toHaveBeenCalled();
  });
});

describe("killAllSubprocesses tracks termination rather than signal delivery", () => {
  it.each([false, true])(
    "escalates a pending process even when killed was %s before cleanup",
    async (alreadySignaled) => {
      const { proc, finish } = processFixture(alreadySignaled);
      trackSubprocess(proc);
      const cleanup = killAllSubprocesses("SIGTERM");
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
      expect(proc.killed).toBe(true);
      await vi.advanceTimersByTimeAsync(2999);
      expect(proc.kill).not.toHaveBeenCalledWith("SIGKILL");
      await vi.advanceTimersByTimeAsync(1);
      await cleanup;
      expect(proc.kill.mock.calls.map(([signal]) => signal)).toEqual(["SIGTERM", "SIGKILL"]);
      expect(_activeSubprocessCount()).toBe(1);
      finish();
      await Promise.resolve();
      expect(_activeSubprocessCount()).toBe(0);
    },
  );

  it("finishes promptly and cancels escalation when the process exits during the grace period", async () => {
    const { proc, finish } = processFixture();
    trackSubprocess(proc);
    const cleanup = killAllSubprocesses();
    await vi.advanceTimersByTimeAsync(50);
    finish();
    await cleanup;
    expect(proc.kill.mock.calls.map(([signal]) => signal)).toEqual(["SIGTERM"]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(_activeSubprocessCount()).toBe(0);
  });

  it("preserves new processes registered while an earlier snapshot is being terminated", async () => {
    const original = processFixture();
    trackSubprocess(original.proc);
    const cleanup = killAllSubprocesses();
    const newcomer = processFixture();
    trackSubprocess(newcomer.proc);
    await vi.advanceTimersByTimeAsync(3000);
    await cleanup;
    expect(newcomer.proc.kill).not.toHaveBeenCalled();
    expect(_activeSubprocessCount()).toBe(2);
    original.finish();
    await Promise.resolve();
    expect(_activeSubprocessCount()).toBe(1);
    expect(newcomer.proc.kill).not.toHaveBeenCalled();
    newcomer.finish();
    await Promise.resolve();
    expect(_activeSubprocessCount()).toBe(0);
  });

  it("does not mistake a kill error for confirmed exit or erase its registry entry", async () => {
    const { proc, finish } = processFixture();
    proc.kill.mockImplementation(() => {
      throw new Error("fixture signal error");
    });
    trackSubprocess(proc);
    const cleanup = killAllSubprocesses();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(cleanup).resolves.toBeUndefined();
    expect(_activeSubprocessCount()).toBe(1);
    finish();
    await Promise.resolve();
    expect(_activeSubprocessCount()).toBe(0);
  });

  it("SIGKILL sends a signal but retains ownership until subprocess settlement", async () => {
    const { proc, finish } = processFixture(true);
    trackSubprocess(proc);
    await killAllSubprocesses("SIGKILL");
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    expect(_activeSubprocessCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    finish();
    await Promise.resolve();
    expect(_activeSubprocessCount()).toBe(0);
  });
});

describe("deprecated orphan discovery", () => {
  it("returns zero without invoking execa, signaling any PID, or scheduling delayed kills", async () => {
    const signal = vi.spyOn(process, "kill").mockReturnValue(true);
    await expect(killOrphanedTestProcesses()).resolves.toBe(0);
    expect(external.execa).not.toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
