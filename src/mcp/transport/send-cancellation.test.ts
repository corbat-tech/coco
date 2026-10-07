import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPTransport } from "./http.js";
import { SSETransport } from "./sse.js";
import type { JSONRPCRequest } from "../types.js";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), stored: vi.fn(), authenticate: vi.fn() }));
vi.mock("../oauth.js", () => ({
  getStoredMcpOAuthToken: mocks.stored,
  authenticateMcpOAuth: mocks.authenticate,
}));
const request: JSONRPCRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "fixture" },
};
const responseData = { jsonrpc: "2.0", id: 1, result: { fixture: true } };
const kinds = ["HTTP", "SSE"] as const;
const disposals: Array<() => Promise<void>> = [];
function success(kind: (typeof kinds)[number], data: unknown = responseData) {
  const response = new Response(JSON.stringify(data), {
    status: kind === "HTTP" ? 200 : 202,
    headers: { "content-type": "application/json" },
  });
  vi.spyOn(response.body!, "cancel");
  return response;
}

async function fixture(kind: (typeof kinds)[number], timeout?: number) {
  let connectionSignal: AbortSignal | undefined;
  let finishRead: (() => void) | undefined;
  if (kind === "SSE")
    mocks.fetch.mockImplementationOnce(async (_url: string, options: RequestInit) => {
      connectionSignal = options.signal as AbortSignal;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: () =>
              new Promise((resolve) => {
                finishRead = () => resolve({ done: true });
              }),
            releaseLock: vi.fn(),
            cancel: vi.fn(async () => {
              finishRead?.();
            }),
          }),
        },
      };
    });
  const config = {
    url: "https://fixture.invalid/mcp",
    ...(timeout === undefined ? {} : { timeout }),
  };
  const transport =
    kind === "HTTP"
      ? new HTTPTransport({ ...config, auth: { type: "bearer", token: "fixture-token" } })
      : new SSETransport(config);
  const message = vi.fn();
  const error = vi.fn();
  transport.onMessage(message);
  transport.onError(error);
  await transport.connect();
  mocks.fetch.mockClear();
  disposals.push(async () => {
    await transport.disconnect();
    finishRead?.();
  });
  return { transport, message, error, connectionSignal };
}
beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MCP HTTP/SSE send cancellation", () => {
  it.each(kinds)("%s pre-abort performs no POST or global callback", async (kind) => {
    const f = await fixture(kind);
    const controller = new AbortController();
    controller.abort(new Error("fixture canceled"));
    await expect(f.transport.send(request, { signal: controller.signal })).rejects.toBe(
      controller.signal.reason,
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(f.message).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it.each(kinds)("%s success cleans its timer, caller listener and response body", async (kind) => {
    const f = await fixture(kind);
    const controller = new AbortController();
    const response = success(kind);
    mocks.fetch.mockResolvedValue(response);
    await f.transport.send(request, { signal: controller.signal });
    const owned = mocks.fetch.mock.calls[0]?.[1].signal as AbortSignal;
    expect(owned).not.toBe(controller.signal);
    expect(owned.aborted).toBe(true);
    expect(response.body!.cancel).toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    if (kind === "HTTP") expect(f.message).toHaveBeenCalledWith(responseData);
    else expect(f.connectionSignal?.aborted).toBe(false);
  });

  it.each(kinds)("%s cancel A does not abort B or its shared connection", async (kind) => {
    const f = await fixture(kind);
    const a = new AbortController();
    const b = new AbortController();
    const signals: AbortSignal[] = [];
    let finishB!: (value: unknown) => void;
    mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal;
      signals.push(signal);
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        if (signals.length === 2) finishB = resolve;
      });
    });
    const canceled = f.transport
      .send(request, { signal: a.signal })
      .catch((error: unknown) => error);
    const surviving = f.transport.send({ ...request, id: 2 }, { signal: b.signal });
    a.abort(new Error("only A canceled"));
    expect(await canceled).toBe(a.signal.reason);
    expect(signals[1]?.aborted).toBe(false);
    expect(f.transport.isConnected()).toBe(true);
    if (kind === "SSE") expect(f.connectionSignal?.aborted).toBe(false);
    expect(f.error).not.toHaveBeenCalled();
    expect(f.message).not.toHaveBeenCalled();
    finishB(success(kind));
    await surviving;
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(f.error).not.toHaveBeenCalled();
    expect(getEventListeners(a.signal, "abort")).toHaveLength(0);
    expect(getEventListeners(b.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(kinds)(
    "%s timeout zero permits a pending POST past the default deadline",
    async (kind) => {
      const f = await fixture(kind, 0);
      let finish!: (value: unknown) => void;
      let owned!: AbortSignal;
      mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
        owned = options.signal as AbortSignal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      const pending = f.transport.send(request);
      await vi.advanceTimersByTimeAsync(60001);
      expect(owned.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      finish(success(kind));
      await pending;
    },
  );

  it("SSE default POST deadline aborts at 60 seconds without closing the receive connection", async () => {
    const f = await fixture("SSE");
    let signal!: AbortSignal;
    mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    });
    const outcome = f.transport.send(request).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(59999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe(signal.reason);
    expect(f.connectionSignal?.aborted).toBe(false);
    expect(f.error).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("HTTP deadline remains active while JSON body is pending", async () => {
    const f = await fixture("HTTP", 13);
    let signal!: AbortSignal;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(body, { headers: { "content-type": "application/json" } });
    mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return response;
    });
    const outcome = f.transport.send(request).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(13);
    expect(await outcome).toBe(signal.reason);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(f.message).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("HTTP deadline cancels a pending SSE reader and releases its lock", async () => {
    const f = await fixture("HTTP", 13);
    let finishRead!: (value: unknown) => void;
    const reader = {
      read: vi.fn(
        () =>
          new Promise((resolve) => {
            finishRead = resolve;
          }),
      ),
      cancel: vi.fn(async () => {
        finishRead({ done: true });
      }),
      releaseLock: vi.fn(),
    };
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: { getReader: () => reader, cancel: vi.fn().mockResolvedValue(undefined) },
    });
    const outcome = f.transport.send(request).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(13);
    expect(String(await outcome)).toMatch(/timeout|timed out/i);
    expect(reader.cancel).toHaveBeenCalled();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(f.message).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("HTTP 401 never starts login or retries the POST", async () => {
    const f = await fixture("HTTP");
    const body = { cancel: vi.fn().mockResolvedValue(undefined) };
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: new Headers(),
      body,
    });
    await expect(f.transport.send(request)).rejects.toThrow(/401/);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.stored).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(body.cancel).toHaveBeenCalled();
  });

  it("HTTP JSON-RPC auth hints are delivered once without replay or login", async () => {
    const f = await fixture("HTTP");
    const rpcError = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32001, message: "Unauthorized: authentication required" },
    };
    const response = success("HTTP", rpcError);
    mocks.fetch.mockResolvedValue(response);
    await f.transport.send(request);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(f.message).toHaveBeenCalledWith(rpcError);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
