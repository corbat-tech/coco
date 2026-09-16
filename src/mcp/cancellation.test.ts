import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCPClientImpl } from "./client.js";
import { wrapMCPTool } from "./tools.js";
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  MCPTransport,
  MCPOutboundMessage,
  MCPTransportSendOptions,
} from "./types.js";

const result = { content: [{ type: "text", text: "fixture" }] };
async function fixture(timeout = 1000) {
  let message!: (response: JSONRPCResponse) => void;
  let error!: (failure: Error) => void;
  let close!: () => void;
  const requests: JSONRPCRequest[] = [];
  const send = vi.fn(async (request: MCPOutboundMessage, _options?: MCPTransportSendOptions) => {
    if (request.method === "initialize" && "id" in request) {
      message({
        jsonrpc: "2.0",
        id: request.id!,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "fixture", version: "1" },
        },
      });
    } else if (request.method === "tools/call" && "id" in request) requests.push(request);
  });
  const transport: MCPTransport = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send,
    isConnected: () => true,
    onMessage: (callback) => {
      message = callback;
    },
    onError: (callback) => {
      error = callback;
    },
    onClose: (callback) => {
      close = callback;
    },
  };
  const client = new MCPClientImpl(transport, timeout);
  await client.initialize({
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "fixture", version: "1" },
  });
  send.mockClear();
  const respond = (index = 0) => message({ jsonrpc: "2.0", id: requests[index]!.id!, result });
  return { client, transport, send, requests, respond, message, error, close };
}
function clean(signal: AbortSignal) {
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("MCP local request lifetime", () => {
  it("pre-abort does not send", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort(new Error("fixture preabort"));
    await expect(
      f.client.callTool({ name: "fixture" }, { signal: controller.signal }),
    ).rejects.toBe(controller.signal.reason);
    expect(f.send).not.toHaveBeenCalled();
    clean(controller.signal);
  });

  it.each([
    "response",
    "RPC error",
    "transport error",
    "close",
    "abort",
    "send rejection",
    "send throw",
  ] as const)("%s settles once and releases deadline and host listener", async (ending) => {
    const f = await fixture();
    const controller = new AbortController();
    const failure = new Error("fixture failure");
    if (ending === "send throw")
      f.send.mockImplementationOnce(() => {
        throw failure;
      });
    if (ending === "send rejection") f.send.mockRejectedValueOnce(failure);
    const outcome = f.client.callTool({ name: "fixture" }, { signal: controller.signal }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (ending === "response") f.respond();
    if (ending === "RPC error")
      f.message({
        jsonrpc: "2.0",
        id: f.requests[0]!.id!,
        error: { code: -32603, message: failure.message },
      });
    if (ending === "transport error") f.error(failure);
    if (ending === "close") f.close();
    if (ending === "abort") controller.abort(failure);
    const settled = await outcome;
    expect(settled.ok).toBe(ending === "response");
    if (settled.ok) expect(settled.value).toEqual(result);
    else if (["abort", "transport error", "send rejection", "send throw"].includes(ending))
      expect(settled.error).toBe(failure);
    else expect(settled.error).toBeInstanceOf(Error);
    if (f.requests.length) f.respond(); // Late response must remain ignored.
    clean(controller.signal);
  });

  it.each([
    { timeout: undefined, deadline: 41 },
    { timeout: 13, deadline: 13 },
  ])("uses local deadline $deadline", async ({ timeout, deadline }) => {
    const f = await fixture(41);
    const controller = new AbortController();
    const outcome = f.client
      .callTool(
        { name: "fixture" },
        { signal: controller.signal, ...(timeout === undefined ? {} : { timeout }) },
      )
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(deadline - 1);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(String(await outcome)).toMatch(/timed out|timeout/i);
    f.respond();
    clean(controller.signal);
  });

  it("timeout zero waits without a timer until the response arrives", async () => {
    const f = await fixture(5);
    const controller = new AbortController();
    const pending = f.client.callTool(
      { name: "fixture" },
      { signal: controller.signal, timeout: 0 },
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(vi.getTimerCount()).toBe(0);
    f.respond();
    await expect(pending).resolves.toEqual(result);
    clean(controller.signal);
  });

  it.each([-1, NaN, Infinity, 2147483648])(
    "invalid timeout %s does not dispatch",
    async (timeout) => {
      const f = await fixture();
      const controller = new AbortController();
      await expect(
        f.client.callTool({ name: "fixture" }, { signal: controller.signal, timeout }),
      ).rejects.toThrow(/timeout/i);
      expect(f.send).not.toHaveBeenCalled();
      clean(controller.signal);
    },
  );

  it("aborting A leaves B pending and ignores A's late response", async () => {
    const f = await fixture();
    const a = new AbortController();
    const b = new AbortController();
    const canceled = f.client
      .callTool({ name: "a" }, { signal: a.signal })
      .catch((error: unknown) => error);
    let bSettled = false;
    const pending = f.client.callTool({ name: "b" }, { signal: b.signal }).finally(() => {
      bSettled = true;
    });
    a.abort(new Error("A canceled"));
    expect(await canceled).toBe(a.signal.reason);
    f.respond(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(bSettled).toBe(false);
    expect(getEventListeners(a.signal, "abort")).toHaveLength(0);
    expect(getEventListeners(b.signal, "abort")).toHaveLength(1);
    f.respond(1);
    await expect(pending).resolves.toEqual(result);
    clean(a.signal);
    clean(b.signal);
  });
});

describe("MCP tool wrapper delegates lifetime to the real client", () => {
  function wrapped(client: MCPClientImpl, requestTimeout = 17) {
    return wrapMCPTool(
      { name: "fixture", description: "fixture", inputSchema: { type: "object", properties: {} } },
      "fixture-server",
      client,
      { requestTimeout },
    ).tool;
  }

  it("success uses one client timer and leaves none after completion", async () => {
    const f = await fixture(999);
    const controller = new AbortController();
    const spy = vi.spyOn(f.client, "callTool");
    const pending = wrapped(f.client).execute({}, { signal: controller.signal });
    expect(spy).toHaveBeenCalledWith(
      { name: "fixture", arguments: {} },
      { signal: controller.signal, timeout: 17 },
    );
    expect(vi.getTimerCount()).toBe(1);
    f.respond();
    await expect(pending).resolves.toBe("fixture");
    clean(controller.signal);
  });

  it("wrapper timeout is enforced by client with no orphaned second timer", async () => {
    const f = await fixture(999);
    const controller = new AbortController();
    const outcome = wrapped(f.client)
      .execute({}, { signal: controller.signal })
      .catch((error: unknown) => error);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(17);
    expect(String(await outcome)).toMatch(/timed out|timeout/i);
    f.respond();
    clean(controller.signal);
  });

  it("abort preserves the exact reason through the wrapper", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const outcome = wrapped(f.client)
      .execute({}, { signal: controller.signal })
      .catch((error: unknown) => error);
    controller.abort(new Error("wrapper canceled"));
    expect(await outcome).toBe(controller.signal.reason);
    f.respond();
    clean(controller.signal);
  });

  it("cancellation after client response but before wrapper continuation suppresses success", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const outcome = wrapped(f.client)
      .execute({}, { signal: controller.signal })
      .catch((error: unknown) => error);
    f.respond();
    controller.abort(new Error("late wrapper cancel"));
    expect(await outcome).toBe(controller.signal.reason);
    clean(controller.signal);
  });
});

describe("MCP transport cancellation and protocol notification", () => {
  it.each(["abort", "deadline", "success", "RPC error"] as const)(
    "%s closes its transport signal and sends cancellation only when needed",
    async (ending) => {
      const f = await fixture();
      const controller = new AbortController();
      const reason = new Error("fixture-sensitive-cancellation-detail");
      const outcome = f.client
        .callTool({ name: "fixture" }, { signal: controller.signal, timeout: 11 })
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      const transportSignal = f.send.mock.calls[0]?.[1]?.signal;
      expect(transportSignal).toBeInstanceOf(AbortSignal);
      expect(transportSignal).not.toBe(controller.signal);
      expect(transportSignal?.aborted).toBe(false);
      if (ending === "abort") controller.abort(reason);
      if (ending === "deadline") await vi.advanceTimersByTimeAsync(11);
      if (ending === "success") f.respond();
      if (ending === "RPC error")
        f.message({
          jsonrpc: "2.0",
          id: f.requests[0]!.id,
          error: { code: -32603, message: "fixture RPC failure" },
        });
      const settled = await outcome;
      await vi.advanceTimersByTimeAsync(0);
      expect(settled.ok).toBe(ending === "success");
      if (ending === "abort" && !settled.ok) expect(settled.error).toBe(reason);
      expect(transportSignal?.aborted).toBe(true);
      const notifications = f.send.mock.calls.filter(
        ([message]) => message.method === "notifications/cancelled",
      );
      if (ending === "abort" || ending === "deadline") {
        expect(notifications).toHaveLength(1);
        expect(notifications[0]?.[0]).toEqual({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: f.requests[0]!.id },
        });
        expect(JSON.stringify(notifications[0]?.[0])).not.toContain(reason.message);
      } else expect(notifications).toHaveLength(0);
      clean(controller.signal);
    },
  );

  it("initialize deadline aborts transport without sending a cancellation notification", async () => {
    const f = await fixture();
    f.send.mockImplementation(async () => {});
    const client = new MCPClientImpl(f.transport, 7);
    const outcome = client
      .initialize({
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "fixture", version: "1" },
      })
      .catch((error: unknown) => error);
    const signal = f.send.mock.calls[0]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(7);
    expect(String(await outcome)).toMatch(/timeout|timed out/i);
    expect(signal?.aborted).toBe(true);
    expect(f.send.mock.calls.map(([message]) => message.method)).toEqual(["initialize"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["throw", "reject"] as const)(
    "notification send %s cannot change A's reason or reject B",
    async (failureMode) => {
      const f = await fixture();
      const a = new AbortController();
      const b = new AbortController();
      const canceled = f.client
        .callTool({ name: "a" }, { signal: a.signal })
        .catch((error: unknown) => error);
      let bSettled = false;
      const pending = f.client.callTool({ name: "b" }, { signal: b.signal }).finally(() => {
        bSettled = true;
      });
      const notifyFailure = new Error("fixture notification send failed");
      if (failureMode === "throw")
        f.send.mockImplementationOnce(() => {
          throw notifyFailure;
        });
      else f.send.mockRejectedValueOnce(notifyFailure);
      const reason = new Error("A original cancellation");
      a.abort(reason);
      expect(await canceled).toBe(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(bSettled).toBe(false);
      f.respond(1);
      await expect(pending).resolves.toEqual(result);
      expect(await canceled).toBe(reason);
      clean(a.signal);
      clean(b.signal);
    },
  );
});

describe("MCP initialize deadline waits for transport persistence", () => {
  it.each(["save failure", "send success"] as const)(
    "deadline aborts transport but retains pending initialization until %s",
    async (ending) => {
      const f = await fixture();
      let resolveSend!: () => void;
      let rejectSend!: (error: unknown) => void;
      f.send.mockImplementation(
        () =>
          new Promise<void>((resolve, reject) => {
            resolveSend = resolve;
            rejectSend = reject;
          }),
      );
      const client = new MCPClientImpl(f.transport, 11);
      let settled = false;
      const outcome = client
        .initialize({
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "fixture", version: "1" },
        })
        .catch((error: unknown) => error)
        .finally(() => {
          settled = true;
        });
      const signal = f.send.mock.calls[0]?.[1]?.signal;
      await vi.advanceTimersByTimeAsync(11);
      expect(signal?.aborted).toBe(true);
      expect(settled).toBe(false);
      if (ending === "save failure") {
        const failure = Object.assign(new Error("fixture persistence failed"), { code: "ENOSPC" });
        rejectSend(failure);
        expect(await outcome).toBe(failure);
      } else {
        resolveSend();
        expect(await outcome).toBe(signal?.reason);
        expect(String(signal?.reason)).toMatch(/timeout|timed out/i);
      }
      expect(f.send).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
