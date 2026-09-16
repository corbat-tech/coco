import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPTransport } from "./http.js";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), stored: vi.fn(), authenticate: vi.fn() }));
vi.mock("../oauth.js", () => ({
  getStoredMcpOAuthToken: mocks.stored,
  authenticateMcpOAuth: mocks.authenticate,
}));
const request = {
  jsonrpc: "2.0" as const,
  id: 1,
  method: "tools/call",
  params: { name: "fixture" },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function create(auth: "bearer" | "oauth" = "bearer") {
  const transport = new HTTPTransport({
    url: "https://fixture.invalid/mcp",
    auth: { type: auth, ...(auth === "bearer" ? { token: "fixture-token" } : {}) },
  });
  const close = vi.fn();
  const message = vi.fn();
  const error = vi.fn();
  transport.onClose(close);
  transport.onMessage(message);
  transport.onError(error);
  return { transport, close, message, error };
}
beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HTTP transport retains owned work during disconnect", () => {
  it("disconnect waits for ignored fetch abort and subsequent body cleanup", async () => {
    const f = create();
    await f.transport.connect();
    const headers = deferred<unknown>();
    const bodyCleanup = deferred<void>();
    let signal!: AbortSignal;
    mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return headers.promise;
    });
    const outcome = f.transport.send(request).catch((error: unknown) => error);
    let disconnected = false;
    const closing = f.transport.disconnect().then(() => {
      disconnected = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(signal.aborted).toBe(true);
    expect(disconnected).toBe(false);
    const cancel = vi.fn(() => bodyCleanup.promise);
    headers.resolve({ ok: true, status: 202, headers: new Headers(), body: { cancel } });
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(disconnected).toBe(false);
    bodyCleanup.resolve();
    expect(await outcome).toBe(signal.reason);
    await closing;
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.message).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("concurrent disconnect calls share cleanup and emit one close callback", async () => {
    const f = create();
    await f.transport.connect();
    const headers = deferred<unknown>();
    mocks.fetch.mockReturnValue(headers.promise);
    const outcome = f.transport.send(request).catch((error: unknown) => error);
    const first = f.transport.disconnect();
    const second = f.transport.disconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.close).not.toHaveBeenCalled();
    const cancel = vi.fn().mockResolvedValue(undefined);
    headers.resolve({ ok: true, status: 202, body: { cancel } });
    await Promise.all([outcome, first, second]);
    await f.transport.disconnect();
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.transport.isConnected()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("connect during closing waits for the old operation before opening again", async () => {
    const f = create();
    await f.transport.connect();
    const headers = deferred<unknown>();
    mocks.fetch.mockReturnValueOnce(headers.promise);
    const outcome = f.transport.send(request).catch((error: unknown) => error);
    const closing = f.transport.disconnect();
    let opened = false;
    const connecting = f.transport.connect().then(() => {
      opened = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(opened).toBe(false);
    expect(f.transport.isConnected()).toBe(false);
    headers.resolve({
      ok: true,
      status: 202,
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    });
    await Promise.all([outcome, closing, connecting]);
    expect(opened).toBe(true);
    expect(f.transport.isConnected()).toBe(true);
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      headers: new Headers(),
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    });
    await f.transport.send({ ...request, id: 2 });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    await f.transport.disconnect();
    expect(f.close).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disconnect during credential loading awaits it and cannot resurrect the old connection", async () => {
    const f = create("oauth");
    const credentials = deferred<string | undefined>();
    mocks.stored.mockReturnValue(credentials.promise);
    const opening = f.transport.connect().then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.stored).toHaveBeenCalledOnce();
    let disconnected = false;
    const closing = f.transport.disconnect().then(() => {
      disconnected = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(disconnected).toBe(false);
    credentials.resolve("fixture-late-credential");
    expect((await opening).ok).toBe(false);
    await closing;
    expect(f.transport.isConnected()).toBe(false);
    expect(f.close).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
