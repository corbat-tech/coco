import { EventEmitter, getEventListeners } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StdioTransport } from "./stdio.js";
import type { JSONRPCRequest } from "../types.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
type WriteCallback = (error?: Error | null) => void;
const request: JSONRPCRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "fixture" },
};
async function fixture() {
  const callbacks: WriteCallback[] = [];
  const stdin = Object.assign(new EventEmitter(), {
    write: vi.fn((_line: string, callback: WriteCallback) => {
      callbacks.push(callback);
      return true;
    }),
    end: vi.fn(),
  });
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    killed: false,
  });
  mocks.spawn.mockReturnValue(child);
  const transport = new StdioTransport({ command: "fixture-never-spawned" });
  const pending = transport.connect();
  child.emit("spawn");
  await pending;
  return { transport, stdin, child, callbacks };
}
function clean(signal: AbortSignal, stdin: EventEmitter) {
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
  expect(stdin.listenerCount("drain")).toBe(0);
}
beforeEach(() => {
  mocks.spawn.mockReset();
});

describe("MCP stdio per-write cancellation", () => {
  it("pre-abort writes no bytes and preserves the connection", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort(new Error("fixture canceled"));
    await expect(f.transport.send(request, { signal: controller.signal })).rejects.toBe(
      controller.signal.reason,
    );
    expect(f.stdin.write).not.toHaveBeenCalled();
    expect(f.transport.isConnected()).toBe(true);
    expect(f.child.kill).not.toHaveBeenCalled();
    clean(controller.signal, f.stdin);
  });

  it.each([true, false])(
    "write callback completes request with canWrite=%s and no drain subscription",
    async (canWrite) => {
      const f = await fixture();
      const controller = new AbortController();
      f.stdin.write.mockImplementation((line: string, callback: WriteCallback) => {
        expect(line).toBe(JSON.stringify(request) + "\n");
        f.callbacks.push(callback);
        return canWrite;
      });
      let settled = false;
      const pending = f.transport.send(request, { signal: controller.signal }).then(() => {
        settled = true;
      });
      expect(f.stdin.listenerCount("drain")).toBe(0);
      f.stdin.emit("drain");
      await Promise.resolve();
      expect(settled).toBe(false);
      f.callbacks[0]!();
      await pending;
      expect(settled).toBe(true);
      clean(controller.signal, f.stdin);
    },
  );

  it("write callback error rejects and removes the abort listener", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const pending = f.transport.send(request, { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow(/fixture write failure/);
    f.callbacks[0]!(new Error("fixture write failure"));
    await rejected;
    clean(controller.signal, f.stdin);
  });

  it("synchronous write throw rejects without retaining listeners", async () => {
    const f = await fixture();
    const controller = new AbortController();
    f.stdin.write.mockImplementation(() => {
      throw new Error("fixture synchronous failure");
    });
    await expect(f.transport.send(request, { signal: controller.signal })).rejects.toThrow(
      /fixture synchronous failure/,
    );
    clean(controller.signal, f.stdin);
    expect(f.transport.isConnected()).toBe(true);
  });

  it.each(["success", "error"] as const)("abort wins over a late %s callback", async (late) => {
    const f = await fixture();
    const controller = new AbortController();
    const outcome = f.transport
      .send(request, { signal: controller.signal })
      .catch((error: unknown) => error);
    const reason = new Error("fixture pending write canceled");
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    f.callbacks[0]!(late === "error" ? new Error("late fixture failure") : undefined);
    expect(await outcome).toBe(reason);
    clean(controller.signal, f.stdin);
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.stdin.end).not.toHaveBeenCalled();
  });

  it("canceling A leaves B's write and the shared connection usable", async () => {
    const f = await fixture();
    const a = new AbortController();
    const b = new AbortController();
    const canceled = f.transport
      .send(request, { signal: a.signal })
      .catch((error: unknown) => error);
    let settledB = false;
    const pendingB = f.transport.send({ ...request, id: 2 }, { signal: b.signal }).then(() => {
      settledB = true;
    });
    a.abort(new Error("A canceled"));
    expect(await canceled).toBe(a.signal.reason);
    f.callbacks[0]!();
    await Promise.resolve();
    expect(settledB).toBe(false);
    expect(getEventListeners(b.signal, "abort")).toHaveLength(1);
    f.callbacks[1]!();
    await pendingB;
    const third = f.transport.send({ ...request, id: 3 });
    f.callbacks[2]!();
    await third;
    expect(f.transport.isConnected()).toBe(true);
    expect(f.child.kill).not.toHaveBeenCalled();
    clean(a.signal, f.stdin);
    clean(b.signal, f.stdin);
  });

  it("writes a notification without inventing an id", async () => {
    const f = await fixture();
    const notification = {
      jsonrpc: "2.0" as const,
      method: "notifications/cancelled",
      params: { requestId: 1, reason: "fixture" },
    };
    const pending = f.transport.send(notification);
    expect(f.stdin.write.mock.calls[0]?.[0]).toBe(JSON.stringify(notification) + "\n");
    f.callbacks[0]!();
    await pending;
  });
});
