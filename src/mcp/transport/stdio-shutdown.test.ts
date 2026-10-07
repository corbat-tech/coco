import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StdioTransport } from "./stdio.js";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
function childFixture() {
  return Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { end: vi.fn(), write: vi.fn() }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => true),
    killed: false,
  });
}
async function fixture() {
  const child = childFixture();
  mocks.spawn.mockReturnValue(child);
  const transport = new StdioTransport({ command: "fixture-not-spawned" });
  const close = vi.fn();
  transport.onClose(close);
  const ready = transport.connect();
  child.emit("spawn");
  await ready;
  return { child, transport, close };
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.spawn.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("MCP stdio owned process shutdown", () => {
  it("ends stdin, escalates TERM then KILL, and still waits for close", async () => {
    const f = await fixture();
    let settled = false;
    const pending = f.transport.disconnect().then(() => {
      settled = true;
    });
    expect(f.child.stdin.end).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4999);
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.child.kill.mock.calls).toEqual([["SIGTERM"]]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(f.child.kill).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(settled).toBe(false);
    f.child.emit("close", null, "SIGKILL");
    await pending;
    expect(settled).toBe(true);
    expect(f.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("natural close cancels all escalation timers", async () => {
    const f = await fixture();
    const pending = f.transport.disconnect();
    f.child.emit("close", 0, null);
    await pending;
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("killed true and exit do not count as settled process close", async () => {
    const f = await fixture();
    f.child.killed = true;
    let settled = false;
    const pending = f.transport.disconnect().then(() => {
      settled = true;
    });
    f.child.emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    expect(f.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.child.kill).toHaveBeenCalledWith("SIGTERM");
    f.child.emit("close", 0, null);
    await pending;
    expect(f.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("concurrent disconnect calls share shutdown effects and await the same close", async () => {
    const f = await fixture();
    const settled: string[] = [];
    const first = f.transport.disconnect().then(() => {
      settled.push("first");
    });
    const second = f.transport.disconnect().then(() => {
      settled.push("second");
    });
    expect(f.child.stdin.end).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8000);
    expect(f.child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(settled).toEqual([]);
    f.child.emit("close", null, "SIGKILL");
    await Promise.all([first, second]);
    expect(settled.sort()).toEqual(["first", "second"]);
    expect(f.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await f.transport.disconnect();
    expect(f.child.stdin.end).toHaveBeenCalledOnce();
  });

  it("refuses connect during shutdown and permits a new child only after close", async () => {
    const f = await fixture();
    const closing = f.transport.disconnect();
    await expect(f.transport.connect()).rejects.toBeInstanceOf(Error);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    f.child.emit("close", 0, null);
    await closing;
    const replacement = childFixture();
    mocks.spawn.mockReturnValue(replacement);
    const ready = f.transport.connect();
    replacement.emit("spawn");
    await ready;
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(f.transport.isConnected()).toBe(true);
    const finalClose = f.transport.disconnect();
    replacement.emit("close", 0, null);
    await finalClose;
    expect(replacement.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exit followed by close emits exactly one close callback outside explicit shutdown", async () => {
    const f = await fixture();
    f.child.emit("exit", 0, null);
    expect(f.close).not.toHaveBeenCalled();
    f.child.emit("close", 0, null);
    expect(f.close).toHaveBeenCalledOnce();
    await f.transport.disconnect();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
