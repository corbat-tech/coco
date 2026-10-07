import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSETransport } from "./sse.js";
const fetchMock = vi.fn();
const transports: SSETransport[] = [];
const request = {
  jsonrpc: "2.0" as const,
  id: 1,
  method: "tools/call",
  params: { name: "fixture" },
};
function streamFixture() {
  type Read = { done: boolean; value?: Uint8Array };
  const queue: Read[] = [];
  let deliver: ((value: Read) => void) | undefined;
  const reader = {
    read: vi.fn(
      () =>
        new Promise<Read>((resolve) => {
          const item = queue.shift();
          if (item) resolve(item);
          else deliver = resolve;
        }),
    ),
    cancel: vi.fn(async () => {
      deliver?.({ done: true });
      deliver = undefined;
    }),
    releaseLock: vi.fn(),
  };
  function emit(value: Read) {
    if (deliver) {
      const resolve = deliver;
      deliver = undefined;
      resolve(value);
    } else queue.push(value);
  }
  return {
    reader,
    response: { ok: true, body: { getReader: () => reader } },
    event: (type: string, data: string) =>
      emit({ done: false, value: new TextEncoder().encode(`event: ${type}\ndata: ${data}\n\n`) }),
    eof: () => emit({ done: true }),
  };
}
function create(timeout?: number) {
  const transport = new SSETransport({
    url: "https://fixture.invalid/sse",
    ...(timeout === undefined ? {} : { timeout }),
    initialReconnectDelay: 1000,
  });
  transports.push(transport);
  return transport;
}
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  for (const transport of transports.splice(0)) await transport.disconnect();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SSE receive lifetime", () => {
  it("disconnect drains an aborted pending POST before allowing a clean reconnect", async () => {
    const firstStream = streamFixture();
    const nextStream = streamFixture();
    fetchMock.mockResolvedValueOnce(firstStream.response);
    const transport = create();
    await transport.connect();
    let postSignal!: AbortSignal;
    let finishPost!: (value: unknown) => void;
    fetchMock.mockImplementationOnce((_url: string, options: RequestInit) => {
      postSignal = options.signal as AbortSignal;
      return new Promise((resolve) => {
        finishPost = resolve;
      });
    });
    const sendOutcome = transport.send(request).catch((error: unknown) => error);
    let disconnected = false;
    const closing = transport.disconnect().then(() => {
      disconnected = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(postSignal.aborted).toBe(true);
    expect(disconnected).toBe(false);
    const cancelBody = vi.fn().mockResolvedValue(undefined);
    finishPost({ ok: true, status: 202, body: { cancel: cancelBody } });
    expect(await sendOutcome).toBe(postSignal.reason);
    await closing;
    expect(cancelBody).toHaveBeenCalledOnce();
    expect(firstStream.reader.releaseLock).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValueOnce(nextStream.response);
    await transport.connect();
    expect(transport.isConnected()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await transport.disconnect();
    expect(nextStream.reader.releaseLock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disconnect awaits reader cleanup and suppresses a late old-generation event", async () => {
    const old = streamFixture();
    const next = streamFixture();
    fetchMock.mockResolvedValueOnce(old.response).mockResolvedValueOnce(next.response);
    const transport = create();
    const onMessage = vi.fn();
    transport.onMessage(onMessage);
    await transport.connect();
    let finishCancel!: () => void;
    old.reader.cancel.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCancel = resolve;
        }),
    );
    let closed = false;
    const closing = transport.disconnect().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(old.reader.cancel).toHaveBeenCalled();
    expect(closed).toBe(false);
    old.event("message", JSON.stringify({ jsonrpc: "2.0", id: 1, result: "stale" }));
    finishCancel();
    await closing;
    expect(old.reader.releaseLock).toHaveBeenCalledOnce();
    expect(onMessage).not.toHaveBeenCalled();
    await transport.connect();
    next.event("message", JSON.stringify({ jsonrpc: "2.0", id: 2, result: "fresh" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 2, result: "fresh" });
  });

  it("automatic EOF closure drains POSTs before disconnect or reconnect", async () => {
    const old = streamFixture();
    const next = streamFixture();
    let resolvePost!: (value: unknown) => void;
    let postSignal!: AbortSignal;
    fetchMock
      .mockResolvedValueOnce(old.response)
      .mockImplementationOnce((_url: string, options: RequestInit) => {
        postSignal = options.signal as AbortSignal;
        return new Promise((resolve) => {
          resolvePost = resolve;
        });
      })
      .mockResolvedValueOnce(next.response);
    const transport = new SSETransport({
      url: "https://fixture.invalid/sse",
      maxReconnectAttempts: 0,
    });
    transports.push(transport);
    await transport.connect();
    const post = transport.send(request).catch((error: unknown) => error);
    old.eof();
    await vi.advanceTimersByTimeAsync(0);
    expect(postSignal.aborted).toBe(true);
    let closed = false;
    let reopened = false;
    const opening = transport.connect().then(() => {
      reopened = true;
    });
    const secondOpening = transport.connect();
    const closing = transport.disconnect().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBe(false);
    expect(reopened).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolvePost({ ok: true, status: 202, body: { cancel: vi.fn().mockResolvedValue(undefined) } });
    await post;
    await closing;
    await opening;
    await secondOpening;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(transport.isConnected()).toBe(true);
  });

  it("disconnect cancels reconnect backoff and prevents another GET", async () => {
    const stream = streamFixture();
    fetchMock.mockResolvedValue(stream.response);
    const transport = create();
    await transport.connect();
    stream.eof();
    await vi.advanceTimersByTimeAsync(0);
    await transport.disconnect();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(stream.reader.releaseLock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, 17])("connect GET timeout %s cancels the pending fetch", async (timeout) => {
    const transport = create(timeout);
    let signal!: AbortSignal;
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    });
    const outcome = transport.connect().catch((error: unknown) => error);
    const duration = timeout ?? 60000;
    await vi.advanceTimersByTimeAsync(duration - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(String(await outcome)).toMatch(/timeout|timed out/i);
    expect(signal.aborted).toBe(true);
    expect(transport.isConnected()).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("connect timeout zero allows delayed headers and then owns the reader", async () => {
    const transport = create(0);
    const stream = streamFixture();
    let signal!: AbortSignal;
    let respond!: (value: unknown) => void;
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise((resolve) => {
        respond = resolve;
      });
    });
    const pending = transport.connect();
    await vi.advanceTimersByTimeAsync(60001);
    expect(signal.aborted).toBe(false);
    respond(stream.response);
    await pending;
    expect(transport.isConnected()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await transport.disconnect();
    expect(stream.reader.cancel).toHaveBeenCalled();
    expect(stream.reader.releaseLock).toHaveBeenCalledOnce();
  });

  it("malformed JSON reports a parse error and a following valid event remains usable", async () => {
    const stream = streamFixture();
    fetchMock.mockResolvedValue(stream.response);
    const transport = create();
    const error = vi.fn();
    const message = vi.fn();
    transport.onError(error);
    transport.onMessage(message);
    await transport.connect();
    stream.event("message", "{bad-json");
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toMatch(/JSON/i);
    stream.event("message", JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(message).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("consumer callback error is not mislabeled as invalid JSON", async () => {
    const stream = streamFixture();
    fetchMock.mockResolvedValue(stream.response);
    const transport = create();
    const failure = new Error("fixture consumer failure");
    const error = vi.fn();
    transport.onMessage(() => {
      throw failure;
    });
    transport.onError(error);
    await transport.connect();
    stream.event("message", JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalled();
    expect(error.mock.calls.some(([value]) => String(value).includes(failure.message))).toBe(true);
    expect(error.mock.calls.every(([value]) => !String(value).includes("Invalid JSON"))).toBe(true);
  });

  it("relative endpoint resolves on the SSE origin before POST", async () => {
    const stream = streamFixture();
    fetchMock.mockResolvedValueOnce(stream.response);
    const transport = create();
    await transport.connect();
    stream.event("endpoint", "/messages?session=fixture");
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    });
    await transport.send(request);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://fixture.invalid/messages?session=fixture");
    expect(fetchMock.mock.calls[1]?.[1].method).toBe("POST");
  });

  it("cross-origin endpoint cannot receive a POST", async () => {
    const stream = streamFixture();
    fetchMock.mockResolvedValueOnce(stream.response);
    const transport = create();
    const error = vi.fn();
    transport.onError(error);
    await transport.connect();
    stream.event("endpoint", "https://other.fixture.invalid/messages");
    await vi.advanceTimersByTimeAsync(0);
    await expect(transport.send(request)).rejects.toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalled();
  });
});
