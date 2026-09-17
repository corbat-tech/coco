import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTestsTool } from "./test.js";
import { _activeSubprocessCount } from "../utils/subprocess-registry.js";
const mocks = vi.hoisted(() => ({ execa: vi.fn() }));
vi.mock("execa", () => ({ execa: mocks.execa }));
beforeEach(() => vi.clearAllMocks());
const good = {
  exitCode: 0,
  stdout: '{"numPassedTests":1,"numFailedTests":0,"numPendingTests":0,"testResults":[]}',
  stderr: "",
};
describe("run_tests cancellation", () => {
  it("never spawns when already cancelled", async () => {
    const host = new AbortController();
    host.abort();
    await expect(
      runTestsTool.execute({ framework: "vitest" }, { signal: host.signal }),
    ).rejects.toThrow();
    expect(mocks.execa).not.toHaveBeenCalled();
  });
  it("forwards cancellation and escalation and drains the tracked process", async () => {
    const host = new AbortController();
    const reason = new Error("test cancelled");
    mocks.execa.mockImplementation((_command, _args, options) => {
      expect(options.detached).toBe(process.platform !== "win32");
      expect(options.timeout).toBe(0);
      expect(options.maxBuffer).toBe(16 * 1024 * 1024);
      return Promise.resolve().then(() => {
        host.abort(reason);
        return good;
      });
    });
    await expect(
      runTestsTool.execute({ framework: "vitest" }, { signal: host.signal }),
    ).rejects.toBe(reason);
    expect(_activeSubprocessCount()).toBe(0);
  });
  it("preserves host reason when subprocess rejects after cancellation", async () => {
    const host = new AbortController();
    const reason = new Error("host reason");
    mocks.execa.mockImplementation(() =>
      Promise.resolve().then(() => {
        host.abort(reason);
        throw new Error("execa canceled");
      }),
    );
    await expect(
      runTestsTool.execute({ framework: "vitest" }, { signal: host.signal }),
    ).rejects.toBe(reason);
    expect(_activeSubprocessCount()).toBe(0);
  });
});

it.each([
  { isMaxBuffer: true, exitCode: 0 },
  { timedOut: true, exitCode: 0 },
  { isCanceled: true, exitCode: 0 },
  { signal: "SIGTERM", exitCode: undefined },
  { exitCode: undefined },
])("rejects abnormal result even when JSON claims success: %j", async (outcome) => {
  mocks.execa.mockResolvedValue({ ...good, ...outcome });
  await expect(runTestsTool.execute({ framework: "vitest" })).rejects.toThrow();
  expect(_activeSubprocessCount()).toBe(0);
});

it("does not let a passing JSON report override a failed exit", async () => {
  mocks.execa.mockResolvedValue({ ...good, exitCode: 1 });
  await expect(runTestsTool.execute({ framework: "vitest" })).resolves.toMatchObject({
    passed: 1,
    success: false,
  });
});
