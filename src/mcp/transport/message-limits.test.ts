import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HTTPTransport } from "./http.js";
import { SSETransport } from "./sse.js";
import { StdioTransport } from "./stdio.js";
import { MAX_MCP_MESSAGE_BYTES, MCPMessageLimitError } from "./limits.js";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../oauth.js", () => ({ getStoredMcpOAuthToken: vi.fn(), authenticateMcpOAuth: vi.fn() }));
const request = { jsonrpc: "2.0" as const, id: 1, method: "tools/call" };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function oversizedBody(sse: boolean) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (sse) {
        // Two independently legal lines exceed the aggregate event budget.
        controller.enqueue(Buffer.from(`data: ${"x".repeat(MAX_MCP_MESSAGE_BYTES / 2)}\n`));
        controller.enqueue(Buffer.from(`data: ${"x".repeat(MAX_MCP_MESSAGE_BYTES / 2)}\n\n`));
      } else controller.enqueue(Buffer.alloc(MAX_MCP_MESSAGE_BYTES + 1, 120));
    },
    cancel,
  });
  return {
    body,
    cancel,
    response: new Response(body, {
      headers: { "content-type": sse ? "text/event-stream" : "application/json" },
    }),
  };
}

describe("MCP oversize generation cleanup", () => {
  it.each([false, true])(
    "HTTP closes without replay and aborts sibling requests, SSE=%s",
    async (sse) => {
      const transport = new HTTPTransport({
        url: "https://fixture.invalid/mcp",
        auth: { type: "bearer", token: "fixture" },
      });
      const close = vi.fn();
      const message = vi.fn();
      transport.onClose(close);
      transport.onMessage(message);
      await transport.connect();
      let siblingSignal!: AbortSignal;
      const source = oversizedBody(sse);
      const fetch = vi
        .fn()
        .mockImplementationOnce((_url: string, options: RequestInit) => {
          siblingSignal = options.signal as AbortSignal;
          return new Promise((_resolve, reject) =>
            siblingSignal.addEventListener("abort", () => reject(siblingSignal.reason), {
              once: true,
            }),
          );
        })
        .mockResolvedValueOnce(source.response);
      vi.stubGlobal("fetch", fetch);
      const sibling = transport.send({ ...request, id: 2 }).catch((error: unknown) => error);
      await expect(transport.send(request)).rejects.toThrow(MCPMessageLimitError);
      expect(await sibling).toBeInstanceOf(MCPMessageLimitError);
      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
      expect(close).toHaveBeenCalledOnce();
      expect(source.cancel).toHaveBeenCalledOnce();
      expect(source.body.locked).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(message).not.toHaveBeenCalled();
    },
  );

  it("SSE closes its generation and never reconnects after oversized events", async () => {
    const source = oversizedBody(true);
    const fetch = vi.fn().mockResolvedValue(source.response);
    vi.stubGlobal("fetch", fetch);
    const transport = new SSETransport({
      url: "https://fixture.invalid/sse",
      initialReconnectDelay: 0,
    });
    const error = vi.fn();
    transport.onError(error);
    const closed = new Promise<void>((resolve) => transport.onClose(resolve));
    await transport.connect();
    await closed;
    expect(error.mock.calls[0]?.[0]).toBeInstanceOf(MCPMessageLimitError);
    expect(fetch).toHaveBeenCalledOnce();
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(source.body.locked).toBe(false);
    expect(transport.isConnected()).toBe(false);
  });

  it("stdio refuses further frames and owns process cleanup after overflow", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdin: { end: vi.fn(), write: vi.fn() },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    mocks.spawn.mockReturnValue(child);
    const transport = new StdioTransport({ command: "fixture" });
    const message = vi.fn();
    const error = vi.fn();
    const close = vi.fn();
    transport.onMessage(message);
    transport.onError(error);
    transport.onClose(close);
    const opening = transport.connect();
    child.emit("spawn");
    await opening;
    child.stdout.emit("data", Buffer.alloc(MAX_MCP_MESSAGE_BYTES, 120));
    child.stdout.emit("data", Buffer.from("x"));
    child.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n'));
    expect(error.mock.calls[0]?.[0]).toBeInstanceOf(MCPMessageLimitError);
    expect(transport.isConnected()).toBe(false);
    expect(message).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8000);
    expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
    child.emit("close", null, "SIGKILL");
    await transport.disconnect();
    expect(close).toHaveBeenCalledOnce();
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
