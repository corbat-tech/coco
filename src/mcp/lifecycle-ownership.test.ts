import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCPServerManager } from "./lifecycle.js";
import type { MCPServerConfig } from "./types.js";
const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  initialize: vi.fn(),
  listTools: vi.fn(),
  isConnected: vi.fn(),
}));
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("./transport/stdio.js", () => ({
  StdioTransport: vi.fn(function () {
    const transport = {
      connect: mocks.connect,
      disconnect: mocks.disconnect,
      send: vi.fn(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
      isConnected: mocks.isConnected,
    };
    mocks.construct(transport);
    return transport;
  }),
}));
vi.mock("./client.js", () => ({
  MCPClientImpl: vi.fn(function () {
    return {
      initialize: mocks.initialize,
      listTools: mocks.listTools,
      isConnected: mocks.isConnected,
      close: mocks.disconnect,
    };
  }),
}));
const config: MCPServerConfig = {
  name: "fixture",
  transport: "stdio",
  stdio: { command: "fixture-not-spawned" },
};
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.isConnected.mockReturnValue(true);
  mocks.connect.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.initialize.mockResolvedValue({
    protocolVersion: "2024-11-05",
    capabilities: {},
    serverInfo: { name: "fixture", version: "1" },
  });
  mocks.listTools.mockResolvedValue({ tools: [] });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("MCP lifecycle retains ownership until settlement", () => {
  it.each(["connect", "initialize"] as const)(
    "failed %s awaits disconnect cleanup before rejecting",
    async (stage) => {
      const manager = new MCPServerManager();
      const cleanup = deferred();
      const failure = new Error(`fixture ${stage} failed`);
      mocks[stage].mockRejectedValue(failure);
      mocks.disconnect.mockReturnValue(cleanup.promise);
      let settled = false;
      const outcome = manager
        .startServer(config)
        .catch((error: unknown) => error)
        .finally(() => {
          settled = true;
        });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.disconnect).toHaveBeenCalledOnce();
      expect(settled).toBe(false);
      cleanup.resolve();
      const error = await outcome;
      expect(String(error)).toContain(failure.message);
      expect(manager.getConnection(config.name)).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("startup cleanup failure keeps the transport accessible for another stop attempt", async () => {
    const manager = new MCPServerManager();
    const startupFailure = new Error("fixture initialization failure");
    const cleanupFailure = new Error("fixture cleanup failure");
    mocks.initialize.mockRejectedValue(startupFailure);
    mocks.disconnect.mockRejectedValue(cleanupFailure);
    await expect(manager.startServer(config)).rejects.toBeInstanceOf(Error);
    const owned = manager.getConnection(config.name);
    expect(owned).toBeDefined();
    expect(owned?.transport).toBe(mocks.construct.mock.calls[0]?.[0]);
    expect(owned?.healthy).toBe(false);
    mocks.disconnect.mockResolvedValue(undefined);
    await manager.stopServer(config.name);
    expect(mocks.disconnect).toHaveBeenCalledTimes(2);
    expect(manager.getConnection(config.name)).toBeUndefined();
  });

  it("stop stays pending beyond five seconds and retains its connection until close", async () => {
    const manager = new MCPServerManager();
    const connection = await manager.startServer(config);
    const closing = deferred();
    mocks.disconnect.mockReturnValue(closing.promise);
    let settled = false;
    const pending = manager.stopServer(config.name).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(settled).toBe(false);
    expect(manager.getConnection(config.name)).toBe(connection);
    closing.resolve();
    await pending;
    expect(manager.getConnection(config.name)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disconnect rejection propagates and leaves the owner available for retry", async () => {
    const manager = new MCPServerManager();
    const connection = await manager.startServer(config);
    const failure = new Error("fixture disconnect failure");
    mocks.disconnect.mockRejectedValue(failure);
    await expect(manager.stopServer(config.name)).rejects.toBe(failure);
    expect(manager.getConnection(config.name)).toBe(connection);
    mocks.disconnect.mockResolvedValue(undefined);
    await manager.stopServer(config.name);
    expect(manager.getConnection(config.name)).toBeUndefined();
  });

  it("concurrent starts for the same name create one transport and one handshake", async () => {
    const manager = new MCPServerManager();
    const connecting = deferred();
    mocks.connect.mockReturnValue(connecting.promise);
    const first = manager.startServer(config);
    const second = manager.startServer(config);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.construct).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledOnce();
    connecting.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(mocks.initialize).toHaveBeenCalledOnce();
    await manager.stopServer(config.name);
  });

  it("stop during startup waits for initialization and then owned shutdown", async () => {
    const manager = new MCPServerManager();
    const initializing = deferred();
    const closing = deferred();
    mocks.initialize.mockReturnValue(initializing.promise);
    mocks.disconnect.mockReturnValue(closing.promise);
    const startup = manager.startServer(config).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stopping = manager.stopServer(config.name).then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    expect(mocks.construct).toHaveBeenCalledOnce();
    initializing.resolve();
    await startup;
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(stopped).toBe(false);
    closing.resolve();
    await stopping;
    expect(manager.getConnection(config.name)).toBeUndefined();
  });

  it("start during stop cannot create a replacement before old close", async () => {
    const manager = new MCPServerManager();
    await manager.startServer(config);
    const closing = deferred();
    mocks.disconnect.mockReturnValueOnce(closing.promise);
    const stopping = manager.stopServer(config.name);
    let restarted = false;
    const starting = manager.startServer(config).then((connection) => {
      restarted = true;
      return connection;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.construct).toHaveBeenCalledOnce();
    expect(restarted).toBe(false);
    closing.resolve();
    await stopping;
    const replacement = await starting;
    expect(mocks.construct).toHaveBeenCalledTimes(2);
    expect(manager.getConnection(config.name)).toBe(replacement);
    await manager.stopServer(config.name);
  });

  it("health check delegates its deadline to listTools instead of abandoning a race", async () => {
    const manager = new MCPServerManager();
    await manager.startServer(config);
    mocks.listTools.mockClear();
    const pending = deferred();
    mocks.listTools.mockImplementation(() => pending.promise.then(() => ({ tools: [] })));
    let settled = false;
    const checking = manager.healthCheck(config.name).finally(() => {
      settled = true;
    });
    expect(mocks.listTools).toHaveBeenCalledWith({ timeout: 5000 });
    await vi.advanceTimersByTimeAsync(5001);
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve();
    expect((await checking).healthy).toBe(true);
    await manager.stopServer(config.name);
  });
});

describe("MCP stopAll partial cleanup", () => {
  it("drains other servers when one disconnect fails and retains only the failed owner", async () => {
    const manager = new MCPServerManager();
    const first = await manager.startServer({ ...config, name: "first" });
    await manager.startServer({ ...config, name: "second" });
    const failure = new Error("fixture first shutdown failed");
    const secondClose = deferred();
    mocks.disconnect.mockRejectedValueOnce(failure).mockReturnValueOnce(secondClose.promise);
    let settled = false;
    const outcome = manager
      .stopAll()
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.disconnect).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);
    secondClose.resolve();
    const error = await outcome;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toContain(failure);
    expect(manager.getConnection("first")).toBe(first);
    expect(manager.getConnection("second")).toBeUndefined();
    mocks.disconnect.mockResolvedValue(undefined);
    await manager.stopServer("first");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("MCP lifecycle rejects stale readiness", () => {
  it("close during startup tool discovery cannot produce a healthy connection", async () => {
    const manager = new MCPServerManager();
    const discovery = deferred();
    mocks.listTools.mockImplementation(() => discovery.promise.then(() => ({ tools: [] })));
    const outcome = manager.startServer(config).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.listTools).toHaveBeenCalledOnce();
    mocks.isConnected.mockReturnValue(false);
    discovery.resolve();
    expect(await outcome).toBeInstanceOf(Error);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(manager.getConnection(config.name)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("successful late health response cannot revive a disconnected transport", async () => {
    const manager = new MCPServerManager();
    const connection = await manager.startServer(config);
    const discovery = deferred();
    mocks.listTools.mockImplementation(() => discovery.promise.then(() => ({ tools: [] })));
    const outcome = manager.healthCheck(config.name);
    mocks.isConnected.mockReturnValue(false);
    discovery.resolve();
    expect((await outcome).healthy).toBe(false);
    expect(connection.healthy).toBe(false);
    await manager.stopServer(config.name);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starting an existing dead connection rejects instead of returning stale success", async () => {
    const manager = new MCPServerManager();
    const connection = await manager.startServer(config);
    mocks.isConnected.mockReturnValue(false);
    await expect(manager.startServer(config)).rejects.toBeInstanceOf(Error);
    expect(connection.healthy).toBe(false);
    expect(mocks.construct).toHaveBeenCalledOnce();
    await manager.stopServer(config.name);
    expect(manager.getConnection(config.name)).toBeUndefined();
  });
});
