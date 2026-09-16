import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { HTTPTransport } from "../src/mcp/transport/http.js";
import { SSETransport } from "../src/mcp/transport/sse.js";
import { MCPClientImpl } from "../src/mcp/client.js";

vi.mock("../src/mcp/oauth.js", () => ({ getStoredMcpOAuthToken: async () => undefined }));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("MCP HTTP request cancellation on loopback", () => {
  it.each(["headers", "json", "sse"] as const)(
    "abort disconnects pending %s without replay",
    async (phase) => {
      const received = deferred();
      const closed = deferred();
      let requests = 0;
      const server = createServer((request, response) => {
        requests++;
        request.resume();
        response.on("close", closed.resolve);
        if (phase !== "headers") {
          response.writeHead(200, {
            "Content-Type": phase === "json" ? "application/json" : "text/event-stream",
          });
          response.write(phase === "json" ? '{"jsonrpc":"2.0",' : ": waiting\n\n");
        }
        received.resolve();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing address");
      const transport = new HTTPTransport({ url: `http://127.0.0.1:${address.port}`, retries: 3 });
      const controller = new AbortController();
      const callback = vi.fn();
      const errors = vi.fn();
      transport.onMessage(callback);
      transport.onError(errors);
      let outcome: Promise<unknown> | undefined;
      try {
        await transport.connect();
        outcome = transport
          .send({ jsonrpc: "2.0", id: 1, method: "tools/call" }, { signal: controller.signal })
          .catch((error: unknown) => error);
        await received.promise;
        controller.abort(new Error("fixture cancel"));
        expect(await outcome).toBe(controller.signal.reason);
        await closed.promise;
        expect(requests).toBe(1);
        expect(callback).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();
        expect(transport.isConnected()).toBe(true);
      } finally {
        controller.abort();
        await transport.disconnect();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await outcome;
      }
    },
  );

  it("client notifies cancellation and can use the same connection for another tool", async () => {
    const received = deferred();
    const notified = deferred();
    const closed = deferred();
    const messages: Record<string, unknown>[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const message = JSON.parse(body) as Record<string, unknown>;
      messages.push(message);
      if (message.method === "notifications/cancelled") {
        response.writeHead(202).end();
        notified.resolve();
        return;
      }
      if (message.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "tools/call" && (message.params as { name: string }).name === "slow") {
        response.on("close", closed.resolve);
        received.resolve();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result:
            message.method === "initialize"
              ? {
                  protocolVersion: "2024-11-05",
                  capabilities: {},
                  serverInfo: { name: "fixture", version: "1" },
                }
              : { content: [{ type: "text", text: "OK" }] },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const transport = new HTTPTransport({ url: `http://127.0.0.1:${address.port}` });
    const client = new MCPClientImpl(transport);
    const controller = new AbortController();
    let outcome: Promise<unknown> | undefined;
    try {
      await client.initialize({
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "fixture", version: "1" },
      });
      outcome = client
        .callTool({ name: "slow" }, { signal: controller.signal })
        .catch((error: unknown) => error);
      await received.promise;
      controller.abort(new Error("fixture cancel"));
      expect(await outcome).toBe(controller.signal.reason);
      await notified.promise;
      await closed.promise;
      const original = messages.find((message) => message.method === "tools/call");
      expect(messages.find((message) => message.method === "notifications/cancelled")).toEqual({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: original?.id },
      });
      await expect(client.callTool({ name: "fast" })).resolves.toEqual({
        content: [{ type: "text", text: "OK" }],
      });
      expect(messages.filter((message) => message.method === "tools/call")).toHaveLength(2);
    } finally {
      controller.abort();
      await client.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await outcome;
    }
  });
  it.each(["http", "sse"] as const)("%s does not replay a POST via redirect", async (kind) => {
    let original = 0;
    let redirected = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (request.method === "GET") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(": fixture\n\n");
      } else if (request.url === "/destination") {
        redirected++;
        response.writeHead(202).end();
      } else {
        original++;
        response.writeHead(307, { Location: "/destination" }).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const url = `http://127.0.0.1:${address.port}`;
    const transport = kind === "http" ? new HTTPTransport({ url }) : new SSETransport({ url });
    try {
      await transport.connect();
      await expect(
        transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call" }),
      ).rejects.toThrow();
      expect(original).toBe(1);
      expect(redirected).toBe(0);
    } finally {
      await transport.disconnect();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
