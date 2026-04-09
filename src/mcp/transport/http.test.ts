/**
 * Tests for MCP HTTP Transport
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HTTPTransport } from "./http.js";
import { MCPConnectionError, MCPTransportError } from "../errors.js";
import { authenticateMcpOAuth, getStoredMcpOAuthToken } from "../oauth.js";

vi.mock("../oauth.js", () => ({
  authenticateMcpOAuth: vi.fn(),
  getStoredMcpOAuthToken: vi.fn(),
}));

describe("HTTPTransport", () => {
  let transport: HTTPTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    vi.mocked(authenticateMcpOAuth).mockResolvedValue("oauth-token");
    vi.mocked(getStoredMcpOAuthToken).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    try {
      await transport?.disconnect();
    } catch {
      // Ignore
    }
  });

  describe("constructor", () => {
    it("should create http transport with config", () => {
      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
        timeout: 30000,
        retries: 2,
      });

      expect(transport.getURL()).toBe("https://api.example.com/mcp");
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe("connect", () => {
    it("should connect to valid url without probing endpoint with GET", async () => {
      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
      });

      await transport.connect();

      expect(transport.isConnected()).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should throw for invalid url", async () => {
      transport = new HTTPTransport({
        url: "not-a-url",
      });

      await expect(transport.connect()).rejects.toThrow(MCPConnectionError);
    });

    it("should throw if already connected", async () => {
      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
      });

      await transport.connect();
      await expect(transport.connect()).rejects.toThrow(MCPConnectionError);
    });

    it("should preload stored oauth token during connect without forcing auth yet", async () => {
      vi.mocked(getStoredMcpOAuthToken).mockResolvedValue("cached-token");

      transport = new HTTPTransport({
        name: "atlassian",
        url: "https://mcp.example.com/v1/mcp",
      });

      await transport.connect();

      expect(getStoredMcpOAuthToken).toHaveBeenCalledWith("https://mcp.example.com/v1/mcp");
      expect(authenticateMcpOAuth).not.toHaveBeenCalled();
    });
  });

  describe("authentication", () => {
    it("should include bearer token", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          status: 200,
        }),
      );

      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
        auth: {
          type: "bearer",
          token: "my-token",
        },
      });

      await transport.connect();
      await transport.send({ jsonrpc: "2.0", id: 1, method: "test" });

      const calls = vi.mocked(fetch).mock.calls;
      const lastCall = calls[calls.length - 1];
      const headers = lastCall?.[1]?.headers as Record<string, string>;

      expect(headers["Authorization"]).toBe("Bearer my-token");
      expect(headers["Accept"]).toContain("application/json");
      expect(headers["Accept"]).toContain("text/event-stream");
    });

    it("should include api key", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          status: 200,
        }),
      );

      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
        auth: {
          type: "apikey",
          token: "my-api-key",
          headerName: "X-Custom-Key",
        },
      });

      await transport.connect();
      await transport.send({ jsonrpc: "2.0", id: 1, method: "test" });

      const calls = vi.mocked(fetch).mock.calls;
      const lastCall = calls[calls.length - 1];
      const headers = lastCall?.[1]?.headers as Record<string, string>;

      expect(headers["X-Custom-Key"]).toBe("my-api-key");
    });

    it("should read token from environment variable", async () => {
      process.env.TEST_API_TOKEN = "env-token";

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          status: 200,
        }),
      );

      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
        auth: {
          type: "bearer",
          tokenEnv: "TEST_API_TOKEN",
        },
      });

      await transport.connect();
      await transport.send({ jsonrpc: "2.0", id: 1, method: "test" });

      const calls = vi.mocked(fetch).mock.calls;
      const lastCall = calls[calls.length - 1];
      const headers = lastCall?.[1]?.headers as Record<string, string>;

      expect(headers["Authorization"]).toBe("Bearer env-token");

      delete process.env.TEST_API_TOKEN;
    });

    it("should include custom headers", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          status: 200,
        }),
      );

      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
        headers: {
          "X-Custom-Header": "custom-value",
        },
      });

      await transport.connect();
      await transport.send({ jsonrpc: "2.0", id: 1, method: "test" });

      const calls = vi.mocked(fetch).mock.calls;
      const lastCall = calls[calls.length - 1];
      const headers = lastCall?.[1]?.headers as Record<string, string>;

      expect(headers["X-Custom-Header"]).toBe("custom-value");
    });
  });

  describe("send", () => {
    beforeEach(async () => {
      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
        retries: 1,
      });

      await transport.connect();
    });

    it("should send request and receive response", async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      const response = { jsonrpc: "2.0", id: 1, result: { data: "test" } };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(response), { status: 200 }),
      );

      await transport.send({ jsonrpc: "2.0", id: 1, method: "test" });

      expect(messageCallback).toHaveBeenCalledWith(response);
    });

    it("should accept notification responses with 202 and empty body", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 202 }));

      await expect(
        transport.send({ jsonrpc: "2.0", id: 1, method: "notifications/initialized" }),
      ).resolves.toBeUndefined();
    });

    it("should persist MCP session id across requests", async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: {} },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json", "mcp-session-id": "sess-123" },
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );

      await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
      await transport.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

      const secondHeaders = vi.mocked(fetch).mock.calls[1]?.[1]?.headers as Record<string, string>;
      expect(secondHeaders["Mcp-Session-Id"]).toBe("sess-123");
      expect(messageCallback).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 2, result: { ok: true } });
    });

    it("should parse streamable HTTP event-stream responses", async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n',
            ),
          );
          controller.close();
        },
      });

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-sse" },
        }),
      );

      await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

      const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers["Accept"]).toContain("text/event-stream");
      expect(messageCallback).toHaveBeenCalledWith({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true },
      });
    });

    it("should throw when not connected", async () => {
      await transport.disconnect();

      await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "test" })).rejects.toThrow(
        MCPTransportError,
      );
    });

    it("should throw on http error", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response("Error", { status: 500, statusText: "Internal Server Error" }),
      );

      await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "test" })).rejects.toThrow(
        MCPTransportError,
      );
    });

    it("should retry on failure", async () => {
      const response = { jsonrpc: "2.0", id: 1, result: { data: "test" } };

      // Create new transport with retries
      const retryTransport = new HTTPTransport({
        url: "https://api.example.com/mcp",
        retries: 2,
      });

      await retryTransport.connect();

      const messageCallback = vi.fn();
      retryTransport.onMessage(messageCallback);

      // Mock retry: first fails, second succeeds
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

      await retryTransport.send({ jsonrpc: "2.0", id: 1, method: "test" });

      expect(messageCallback).toHaveBeenCalledWith(response);
    });

    it("should perform oauth login on 401 during send and retry", async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response("Unauthorized", {
            status: 401,
            statusText: "Unauthorized",
            headers: {
              "www-authenticate":
                'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
            },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
            status: 200,
          }),
        );

      await transport.send({ jsonrpc: "2.0", id: 1, method: "test" });

      expect(authenticateMcpOAuth).toHaveBeenCalledTimes(1);
      expect(messageCallback).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 1, result: { ok: true } });
      const secondHeaders = vi.mocked(fetch).mock.calls[1]?.[1]?.headers as Record<string, string>;
      expect(secondHeaders.Authorization).toBe("Bearer oauth-token");
    });

    it("forces oauth refresh when a cached token is rejected with HTTP 401 invalid_token", async () => {
      await transport.disconnect();
      vi.mocked(getStoredMcpOAuthToken).mockResolvedValueOnce("stale-token");
      vi.mocked(authenticateMcpOAuth).mockResolvedValueOnce("fresh-token");

      transport = new HTTPTransport({
        name: "atlassian",
        url: "https://mcp.example.com/v1/mcp",
        retries: 1,
      });
      await transport.connect();

      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response("Unauthorized", {
            status: 401,
            statusText: "Unauthorized",
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
            status: 200,
          }),
        );

      await transport.send({ jsonrpc: "2.0", id: 1, method: "test" });

      expect(authenticateMcpOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          serverName: "atlassian",
          resourceUrl: "https://mcp.example.com/v1/mcp",
          forceRefresh: true,
        }),
      );
      const postCalls = vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      const firstHeaders = postCalls[0]?.[1]?.headers as Record<string, string>;
      const secondHeaders = postCalls[1]?.[1]?.headers as Record<string, string>;
      expect(firstHeaders.Authorization).toBe("Bearer stale-token");
      expect(secondHeaders.Authorization).toBe("Bearer fresh-token");
      expect(messageCallback).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    });

    it("should trigger oauth when JSON-RPC error indicates auth is required", async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: {
                code: -32001,
                message: "Not authenticated. Please generate a token or login.",
              },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
            status: 200,
          }),
        );

      await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });

      expect(authenticateMcpOAuth).toHaveBeenCalledTimes(1);
      expect(messageCallback).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    });

    it("should trigger oauth for Atlassian Gemini-CLI style auth hint", async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: {
                code: -32001,
                message:
                  "Atlassian Remote MCP is a Gemini CLI extension for Jira and Confluence. Please authenticate first.",
              },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
            status: 200,
          }),
        );

      await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });

      expect(authenticateMcpOAuth).toHaveBeenCalledTimes(1);
      expect(messageCallback).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    });

    it("should trigger oauth for invalid_token JSON-RPC errors", async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: {
                code: -32001,
                message: "401 invalid_token",
              },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
            status: 200,
          }),
        );

      await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });

      expect(authenticateMcpOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          forceRefresh: true,
        }),
      );
      expect(messageCallback).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    });

    it("should not trigger oauth for non-auth domain errors", async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: -32000,
              message: "Jira issue COR-123 not found in this project.",
            },
          }),
          { status: 200 },
        ),
      );

      await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });

      expect(authenticateMcpOAuth).not.toHaveBeenCalled();
      expect(messageCallback).toHaveBeenCalledWith({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32000,
          message: "Jira issue COR-123 not found in this project.",
        },
      });
    });
  });

  describe("disconnect", () => {
    it("should disconnect and call close callback", async () => {
      const closeCallback = vi.fn();
      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
      });

      transport.onClose(closeCallback);
      await transport.connect();
      await transport.disconnect();

      expect(transport.isConnected()).toBe(false);
      expect(closeCallback).toHaveBeenCalled();
    });
  });

  describe("callbacks", () => {
    beforeEach(async () => {
      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
      });

      await transport.connect();
    });

    it("should call message callback", async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      const response = { jsonrpc: "2.0", id: 1, result: {} };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(response), { status: 200 }),
      );

      await transport.send({ jsonrpc: "2.0", id: 1, method: "test" });

      expect(messageCallback).toHaveBeenCalledWith(response);
    });
  });

  describe("getters", () => {
    it("should return auth type", () => {
      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
        auth: { type: "bearer", token: "test" },
      });

      expect(transport.getAuthType()).toBe("bearer");
    });

    it("should return undefined auth type when no auth", () => {
      transport = new HTTPTransport({
        url: "https://api.example.com/mcp",
      });

      expect(transport.getAuthType()).toBeUndefined();
    });
  });
});
