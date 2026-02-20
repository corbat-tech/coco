/**
 * Tests for subprocess-registry.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  trackSubprocess,
  killAllSubprocesses,
  _activeSubprocessCount,
} from "./subprocess-registry.js";

// Minimal mock of an execa subprocess
function makeMockProc(killed = false): {
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  then: ReturnType<typeof vi.fn>;
} {
  const proc = {
    killed,
    kill: vi.fn<[string?], boolean>(() => {
      proc.killed = true;
      return true;
    }),
    // eslint-disable-next-line unicorn/no-thenable -- intentional mock of a thenable subprocess
    then: vi.fn((onFulfilled: () => void, _onRejected: () => void) => {
      // Store the callback so tests can trigger cleanup
      (proc as unknown as { _resolve: () => void })._resolve = onFulfilled;
      return proc;
    }),
  };
  return proc;
}

beforeEach(async () => {
  // Reset by killing all (no-op if set is empty)
  await killAllSubprocesses("SIGKILL");
});

afterEach(async () => {
  await killAllSubprocesses("SIGKILL");
});

describe("trackSubprocess", () => {
  it("adds process to active set", () => {
    const before = _activeSubprocessCount();
    const proc = makeMockProc();
    trackSubprocess(proc);
    expect(_activeSubprocessCount()).toBe(before + 1);
  });

  it("returns the subprocess unchanged", () => {
    const proc = makeMockProc();
    const result = trackSubprocess(proc);
    expect(result).toBe(proc);
  });

  it("removes process from set when it completes", () => {
    const proc = makeMockProc();
    trackSubprocess(proc);
    const before = _activeSubprocessCount();

    // Simulate process completion — call the onFulfilled callback
    const trackedProc = proc as unknown as { _resolve: () => void };
    trackedProc._resolve?.();

    expect(_activeSubprocessCount()).toBe(before - 1);
  });
});

describe("killAllSubprocesses", () => {
  it("kills all tracked processes with SIGTERM by default", async () => {
    const proc1 = makeMockProc();
    const proc2 = makeMockProc();
    trackSubprocess(proc1);
    trackSubprocess(proc2);

    // Simulate quick exit after SIGTERM
    proc1.kill.mockImplementation(() => {
      proc1.killed = true;
      return true;
    });
    proc2.kill.mockImplementation(() => {
      proc2.killed = true;
      return true;
    });

    await killAllSubprocesses("SIGTERM");

    expect(proc1.kill).toHaveBeenCalledWith("SIGTERM");
    expect(proc2.kill).toHaveBeenCalledWith("SIGTERM");
    expect(_activeSubprocessCount()).toBe(0);
  });

  it("does not kill processes that are already killed", async () => {
    const proc = makeMockProc(true); // already killed
    trackSubprocess(proc);

    await killAllSubprocesses("SIGTERM");

    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("clears the active set after killing", async () => {
    const proc = makeMockProc();
    trackSubprocess(proc);

    await killAllSubprocesses("SIGKILL");

    expect(_activeSubprocessCount()).toBe(0);
  });

  it("handles kill errors gracefully", async () => {
    const proc = makeMockProc();
    proc.kill.mockImplementation(() => {
      throw new Error("ESRCH: no such process");
    });
    trackSubprocess(proc);

    // Should not throw
    await expect(killAllSubprocesses("SIGTERM")).resolves.not.toThrow();
  });
});
