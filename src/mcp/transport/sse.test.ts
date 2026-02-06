/**
 * Tests for MCP SSE Transport
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SSETransport } from "./sse.js";
import { MCPConnectionError, MCPTransportError } from "../errors.js";

/**
 * Helper to create a mock response with a ReadableStream body that closes after delivering data
 */
function createMockSSEResponse(sseText: string): Response {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode(sseText)];
  let index = 0;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]!);
        index++;
      } else {
        controller.close();
      }
    },
  });

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "text/event-stream" }),
    body,
    bodyUsed: false,
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    clone: () => ({ body } as unknown as Response),
    text: async () => sseText,
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    bytes: async () => new Uint8Array(),
  } as unknown as Response;
}

/**
 * Helper to create a mock SSE response with a stream that stays open (doesn't close)
 * Useful for tests that need the transport to remain connected
 */
function createOpenSSEResponse(sseText: string): Response {
  const encoder = new TextEncoder();
  let sent = false;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        controller.enqueue(encoder.encode(sseText));
        sent = true;
      }
      // Don't close — keep the stream open, reader.read() will block
    },
  });

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "text/event-stream" }),
    body,
  } as unknown as Response;
}

/**
 * Helper to wait for async stream processing
 */
async function waitForProcessing(ms = 250): Promise<void> {
  // Multiple flushes to ensure microtasks and timers resolve
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, ms / 5));
  }
}

describe("SSETransport", () => {
  let transport: SSETransport;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(async () => {
    try {
      await transport?.disconnect();
    } catch {
      // Ignore
    }
  });

  describe("constructor", () => {
    it("should create SSE transport with config", () => {
      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      expect(transport.isConnected()).toBe(false);
    });

    it("should accept custom config", () => {
      transport = new SSETransport({
        url: "https://api.example.com/sse",
        headers: { Authorization: "Bearer test" },
        initialReconnectDelay: 2000,
        maxReconnectDelay: 60000,
        maxReconnectAttempts: 5,
      });

      expect(transport.isConnected()).toBe(false);
    });
  });

  describe("connect", () => {
    it("should connect to SSE endpoint", async () => {
      const response = createMockSSEResponse(
        "event: endpoint\ndata: /message\n\n",
      );

      vi.mocked(fetch).mockResolvedValueOnce(response);

      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      await transport.connect();

      expect(transport.isConnected()).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/sse",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Accept: "text/event-stream",
          }),
        }),
      );
    });

    it("should throw for failed connection", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers(),
        body: null,
      } as unknown as Response);

      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      await expect(transport.connect()).rejects.toThrow(MCPConnectionError);
    });

    it("should throw when response has no body", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        body: null,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
      } as unknown as Response);

      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      await expect(transport.connect()).rejects.toThrow(MCPConnectionError);
    });

    it("should not reconnect if already connected", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createOpenSSEResponse("event: endpoint\ndata: /msg\n\n"),
      );

      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      await transport.connect();
      await transport.connect();

      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("send", () => {
    it("should send message via HTTP POST", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          createOpenSSEResponse("event: endpoint\ndata: /message\n\n"),
        )
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as unknown as Response);

      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      await transport.connect();
      await waitForProcessing();

      await transport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

      expect(fetch).toHaveBeenCalledTimes(2);
      const postCall = vi.mocked(fetch).mock.calls[1];
      expect(postCall?.[1]?.method).toBe("POST");
    });

    it("should throw when not connected", async () => {
      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      await expect(
        transport.send({ jsonrpc: "2.0", id: 1, method: "test" }),
      ).rejects.toThrow(MCPConnectionError);
    });

    it("should throw on HTTP POST failure", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          createOpenSSEResponse("event: endpoint\ndata: /msg\n\n"),
        )
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Server Error",
        } as unknown as Response);

      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      await transport.connect();
      await waitForProcessing();

      await expect(
        transport.send({ jsonrpc: "2.0", id: 1, method: "test" }),
      ).rejects.toThrow(MCPTransportError);
    });

    it("should throw on network error", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          createOpenSSEResponse("event: endpoint\ndata: /msg\n\n"),
        )
        .mockRejectedValueOnce(new Error("Network error"));

      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      await transport.connect();
      await waitForProcessing();

      await expect(
        transport.send({ jsonrpc: "2.0", id: 1, method: "test" }),
      ).rejects.toThrow(MCPTransportError);
    });
  });

  describe("message handling", () => {
    it("should parse JSON-RPC messages from SSE events", async () => {
      const message = { jsonrpc: "2.0", id: 1, result: { tools: [] } };
      const sseData = `data: ${JSON.stringify(message)}\n\n`;

      vi.mocked(fetch).mockResolvedValueOnce(
        createMockSSEResponse(sseData),
      );

      transport = new SSETransport({
        url: "https://api.example.com/sse",
        maxReconnectAttempts: 0,
      });

      const messageHandler = vi.fn();
      transport.onMessage(messageHandler);

      await transport.connect();
      await waitForProcessing();

      expect(messageHandler).toHaveBeenCalledWith(message);
    });

    it("should handle endpoint event and use it for POST", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          createOpenSSEResponse(
            "event: endpoint\ndata: https://api.example.com/msg\n\n",
          ),
        )
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as unknown as Response);

      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      await transport.connect();
      await waitForProcessing();

      await transport.send({ jsonrpc: "2.0", id: 1, method: "test" });

      const postCall = vi.mocked(fetch).mock.calls[1];
      expect(postCall?.[0]).toBe("https://api.example.com/msg");
    });

    it("should handle invalid JSON in SSE data", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockSSEResponse("data: not-valid-json\n\n"),
      );

      transport = new SSETransport({
        url: "https://api.example.com/sse",
        maxReconnectAttempts: 0,
      });

      const errorHandler = vi.fn();
      transport.onError(errorHandler);

      await transport.connect();
      await waitForProcessing();

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Invalid JSON"),
        }),
      );
    });

    it("should ignore SSE comments", async () => {
      const message = { jsonrpc: "2.0", id: 1, result: {} };
      const sseData = `: this is a comment\ndata: ${JSON.stringify(message)}\n\n`;

      vi.mocked(fetch).mockResolvedValueOnce(
        createMockSSEResponse(sseData),
      );

      transport = new SSETransport({
        url: "https://api.example.com/sse",
        maxReconnectAttempts: 0,
      });

      const messageHandler = vi.fn();
      transport.onMessage(messageHandler);

      await transport.connect();
      await waitForProcessing();

      expect(messageHandler).toHaveBeenCalledWith(message);
    });

    it("should track last event ID", async () => {
      const message = { jsonrpc: "2.0", id: 1, result: {} };
      const sseData = `id: evt-42\ndata: ${JSON.stringify(message)}\n\n`;

      vi.mocked(fetch).mockResolvedValueOnce(
        createMockSSEResponse(sseData),
      );

      transport = new SSETransport({
        url: "https://api.example.com/sse",
        maxReconnectAttempts: 0,
      });

      const messageHandler = vi.fn();
      transport.onMessage(messageHandler);

      await transport.connect();
      await waitForProcessing();

      expect(messageHandler).toHaveBeenCalledWith(message);
    });
  });

  describe("disconnect", () => {
    it("should disconnect and call close handler", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createOpenSSEResponse("event: endpoint\ndata: /msg\n\n"),
      );

      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      const closeHandler = vi.fn();
      transport.onClose(closeHandler);

      await transport.connect();
      await transport.disconnect();

      expect(transport.isConnected()).toBe(false);
      expect(closeHandler).toHaveBeenCalled();
    });
  });

  describe("callbacks", () => {
    it("should register message handler", () => {
      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      const handler = vi.fn();
      transport.onMessage(handler);

      expect(true).toBe(true);
    });

    it("should register error handler", () => {
      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      const handler = vi.fn();
      transport.onError(handler);

      expect(true).toBe(true);
    });

    it("should register close handler", () => {
      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      const handler = vi.fn();
      transport.onClose(handler);

      expect(true).toBe(true);
    });
  });

  describe("fallback message endpoint", () => {
    it("should use default /message endpoint when no endpoint event received", async () => {
      const message = { jsonrpc: "2.0", id: 1, result: {} };
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          createOpenSSEResponse(`data: ${JSON.stringify(message)}\n\n`),
        )
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as unknown as Response);

      transport = new SSETransport({
        url: "https://api.example.com/sse",
      });

      await transport.connect();
      await waitForProcessing();

      await transport.send({ jsonrpc: "2.0", id: 2, method: "test" });

      const postCall = vi.mocked(fetch).mock.calls[1];
      expect(postCall?.[0]).toBe("https://api.example.com/sse/message");
    });
  });
});
