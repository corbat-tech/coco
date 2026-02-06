/**
 * Tests for MCP Server Lifecycle Manager
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock transports
vi.mock("./transport/stdio.js", () => ({
  StdioTransport: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  })),
}));

vi.mock("./transport/http.js", () => ({
  HTTPTransport: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  })),
}));

vi.mock("./transport/sse.js", () => ({
  SSETransport: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  })),
}));

// Mock client
vi.mock("./client.js", () => ({
  MCPClientImpl: vi.fn().mockImplementation(() => {
    let initialized = false;
    return {
      initialize: vi.fn().mockImplementation(() => {
        initialized = true;
        return Promise.resolve({
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "test-server", version: "1.0.0" },
        });
      }),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: "tool1", inputSchema: { type: "object" } },
          { name: "tool2", inputSchema: { type: "object" } },
        ],
      }),
      callTool: vi.fn(),
      listResources: vi.fn(),
      listPrompts: vi.fn(),
      readResource: vi.fn(),
      getPrompt: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockImplementation(() => initialized),
    };
  }),
}));

describe("MCPServerManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("startServer", () => {
    it("should start a stdio server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      const connection = await manager.startServer({
        name: "test-server",
        transport: "stdio",
        stdio: {
          command: "npx",
          args: ["-y", "test-server"],
        },
      });

      expect(connection.name).toBe("test-server");
      expect(connection.healthy).toBe(true);
      expect(connection.toolCount).toBe(2);
      expect(connection.connectedAt).toBeInstanceOf(Date);
    });

    it("should start an HTTP server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      const connection = await manager.startServer({
        name: "http-server",
        transport: "http",
        http: {
          url: "https://api.example.com/mcp",
        },
      });

      expect(connection.name).toBe("http-server");
      expect(connection.healthy).toBe(true);
    });

    it("should start an SSE server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      const connection = await manager.startServer({
        name: "sse-server",
        transport: "sse",
        http: {
          url: "https://api.example.com/sse",
        },
      });

      expect(connection.name).toBe("sse-server");
      expect(connection.healthy).toBe(true);
    });

    it("should return existing connection if already started", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      const config = {
        name: "test-server",
        transport: "stdio" as const,
        stdio: { command: "npx" },
      };

      const conn1 = await manager.startServer(config);
      const conn2 = await manager.startServer(config);

      expect(conn1).toBe(conn2);
    });

    it("should throw for stdio without command", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await expect(
        manager.startServer({
          name: "test",
          transport: "stdio",
        }),
      ).rejects.toThrow("requires stdio.command");
    });

    it("should throw for http without url", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await expect(
        manager.startServer({
          name: "test",
          transport: "http",
        }),
      ).rejects.toThrow("requires http.url");
    });

    it("should throw for sse without url", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await expect(
        manager.startServer({
          name: "test",
          transport: "sse",
        }),
      ).rejects.toThrow("requires http.url for SSE");
    });

    it("should throw for unsupported transport", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await expect(
        manager.startServer({
          name: "test",
          transport: "websocket" as "stdio",
        }),
      ).rejects.toThrow("Unsupported transport");
    });
  });

  describe("stopServer", () => {
    it("should stop a running server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await manager.startServer({
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx" },
      });

      expect(manager.getConnectedServers()).toContain("test-server");

      await manager.stopServer("test-server");

      expect(manager.getConnectedServers()).not.toContain("test-server");
    });

    it("should not throw for unknown server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await expect(manager.stopServer("unknown")).resolves.toBeUndefined();
    });
  });

  describe("restartServer", () => {
    it("should restart a running server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await manager.startServer({
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx" },
      });

      const newConn = await manager.restartServer("test-server");

      expect(newConn.name).toBe("test-server");
      expect(newConn.healthy).toBe(true);
    });

    it("should throw for unknown server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await expect(manager.restartServer("unknown")).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("healthCheck", () => {
    it("should return healthy for running server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await manager.startServer({
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx" },
      });

      const result = await manager.healthCheck("test-server");

      expect(result.name).toBe("test-server");
      expect(result.healthy).toBe(true);
      expect(result.toolCount).toBe(2);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should return unhealthy for unknown server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      const result = await manager.healthCheck("unknown");

      expect(result.healthy).toBe(false);
      expect(result.error).toBe("Server not connected");
    });
  });

  describe("startAll", () => {
    it("should start all enabled servers", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      const results = await manager.startAll([
        {
          name: "server1",
          transport: "stdio",
          stdio: { command: "npx" },
          enabled: true,
        },
        {
          name: "server2",
          transport: "stdio",
          stdio: { command: "npx" },
          enabled: true,
        },
      ]);

      expect(results.size).toBe(2);
      expect(results.has("server1")).toBe(true);
      expect(results.has("server2")).toBe(true);
    });

    it("should skip disabled servers", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      const results = await manager.startAll([
        {
          name: "enabled",
          transport: "stdio",
          stdio: { command: "npx" },
          enabled: true,
        },
        {
          name: "disabled",
          transport: "stdio",
          stdio: { command: "npx" },
          enabled: false,
        },
      ]);

      expect(results.size).toBe(1);
      expect(results.has("enabled")).toBe(true);
      expect(results.has("disabled")).toBe(false);
    });

    it("should continue on server start failure", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      const results = await manager.startAll([
        {
          name: "bad-server",
          transport: "stdio",
          // Missing command - will fail
        },
        {
          name: "good-server",
          transport: "stdio",
          stdio: { command: "npx" },
        },
      ]);

      expect(results.size).toBe(1);
      expect(results.has("good-server")).toBe(true);
    });
  });

  describe("stopAll", () => {
    it("should stop all running servers", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await manager.startAll([
        {
          name: "server1",
          transport: "stdio",
          stdio: { command: "npx" },
        },
        {
          name: "server2",
          transport: "stdio",
          stdio: { command: "npx" },
        },
      ]);

      expect(manager.getConnectedServers()).toHaveLength(2);

      await manager.stopAll();

      expect(manager.getConnectedServers()).toHaveLength(0);
    });
  });

  describe("getters", () => {
    it("should return connected server names", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await manager.startServer({
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx" },
      });

      expect(manager.getConnectedServers()).toEqual(["test-server"]);
    });

    it("should return connection by name", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await manager.startServer({
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx" },
      });

      const conn = manager.getConnection("test-server");
      expect(conn).toBeDefined();
      expect(conn?.name).toBe("test-server");
    });

    it("should return undefined for unknown connection", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      expect(manager.getConnection("unknown")).toBeUndefined();
    });

    it("should return all connections", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await manager.startAll([
        { name: "s1", transport: "stdio", stdio: { command: "npx" } },
        { name: "s2", transport: "stdio", stdio: { command: "npx" } },
      ]);

      const all = manager.getAllConnections();
      expect(all).toHaveLength(2);
    });

    it("should return client for server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      await manager.startServer({
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx" },
      });

      const client = manager.getClient("test-server");
      expect(client).toBeDefined();
      expect(typeof client?.listTools).toBe("function");
    });

    it("should return undefined client for unknown server", async () => {
      const { MCPServerManager } = await import("./lifecycle.js");
      const manager = new MCPServerManager();

      expect(manager.getClient("unknown")).toBeUndefined();
    });
  });
});

describe("singleton and factory", () => {
  it("should return singleton manager", async () => {
    const { getMCPServerManager } = await import("./lifecycle.js");

    const m1 = getMCPServerManager();
    const m2 = getMCPServerManager();

    expect(m1).toBe(m2);
  });

  it("should create new manager instances", async () => {
    const { createMCPServerManager } = await import("./lifecycle.js");

    const m1 = createMCPServerManager();
    const m2 = createMCPServerManager();

    expect(m1).not.toBe(m2);
  });
});
