/**
 * Tests for /mcp command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — all vi.mock() calls are hoisted before any imports
// ---------------------------------------------------------------------------

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    message: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("chalk", () => {
  const id = (s: string) => s;
  const chained = Object.assign(id, {
    dim: id,
    green: id,
    red: id,
    bold: id,
    yellow: id,
    cyan: id,
  });
  return { default: chained };
});

// MCP lifecycle mock — expose control functions at module scope so tests
// can re-configure them without fighting vi.clearAllMocks() resetting impls.
const mockManagerMethods = {
  getConnection: vi.fn(),
  getAllConnections: vi.fn(),
  healthCheck: vi.fn(),
  restartServer: vi.fn(),
};

const mockGetMCPServerManager = vi.fn(() => mockManagerMethods);

vi.mock("../../../mcp/lifecycle.js", () => ({
  getMCPServerManager: (...args: unknown[]) => mockGetMCPServerManager(...args),
}));

// MCP registry mock — same stable-instance approach.
const mockRegistryMethods = {
  load: vi.fn(),
  listServers: vi.fn(),
};

vi.mock("../../../mcp/registry.js", () => ({
  MCPRegistryImpl: function () {
    return mockRegistryMethods;
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import * as p from "@clack/prompts";
import { mcpCommand } from "./mcp.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSession = { projectPath: "/test/project" } as any;

function makeConnection(
  name: string,
  transport: "stdio" | "http" | "sse" = "stdio",
  toolCount = 3,
  healthy = true,
  connectedAt?: Date,
) {
  return {
    name,
    config: { name, transport, enabled: true },
    toolCount,
    healthy,
    connectedAt: connectedAt ?? new Date(Date.now() - 5000),
  };
}

function makeServerConfig(
  name: string,
  transport: "stdio" | "http" | "sse" = "stdio",
  enabled = true,
  description?: string,
) {
  return { name, transport, enabled, description };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset call history but keep implementations stable (the mocked objects are
  // never cleared because the manager and registry are plain objects, not vi.fn).
  vi.clearAllMocks();

  // Re-set default implementations after clearAllMocks.
  // (clearAllMocks resets vi.fn() implementations too, so we restore them here.)
  mockRegistryMethods.load.mockResolvedValue(undefined);
  mockRegistryMethods.listServers.mockReturnValue([]);
  mockManagerMethods.getAllConnections.mockReturnValue([]);
  mockManagerMethods.getConnection.mockReturnValue(undefined);
  mockGetMCPServerManager.mockReturnValue(mockManagerMethods);

  // Restore p.spinner default (it must return a start/stop object)
  vi.mocked(p.spinner).mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe("mcpCommand metadata", () => {
  it("has name 'mcp'", () => {
    expect(mcpCommand.name).toBe("mcp");
  });

  it("has empty aliases array", () => {
    expect(mcpCommand.aliases).toEqual([]);
  });

  it("has a description mentioning MCP", () => {
    expect(mcpCommand.description.toLowerCase()).toContain("mcp");
  });

  it("has a usage string", () => {
    expect(mcpCommand.usage).toContain("/mcp");
  });

  it("always returns false (never exits the REPL)", async () => {
    const result = await mcpCommand.execute([], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /mcp list (default)
// ---------------------------------------------------------------------------

describe("/mcp list (default subcommand)", () => {
  it("shows message when no servers are configured", async () => {
    mockRegistryMethods.listServers.mockReturnValue([]);

    await mcpCommand.execute([], mockSession);

    expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("No MCP servers configured"));
  });

  it("shows each configured server name", async () => {
    mockRegistryMethods.listServers.mockReturnValue([
      makeServerConfig("filesystem", "stdio"),
      makeServerConfig("github", "http"),
    ]);
    mockManagerMethods.getConnection.mockReturnValue(undefined);

    await mcpCommand.execute(["list"], mockSession);

    const messages = vi.mocked(p.log.message).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("filesystem"))).toBe(true);
    expect(messages.some((m) => m.includes("github"))).toBe(true);
  });

  it("shows transport type for each server", async () => {
    mockRegistryMethods.listServers.mockReturnValue([makeServerConfig("myserver", "stdio")]);
    mockManagerMethods.getConnection.mockReturnValue(undefined);

    await mcpCommand.execute(["list"], mockSession);

    const messages = vi.mocked(p.log.message).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("stdio"))).toBe(true);
  });

  it("shows connected status for running server", async () => {
    mockRegistryMethods.listServers.mockReturnValue([makeServerConfig("myserver", "stdio")]);
    mockManagerMethods.getConnection.mockReturnValue(makeConnection("myserver"));

    await mcpCommand.execute(["list"], mockSession);

    const messages = vi.mocked(p.log.message).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("connected"))).toBe(true);
  });

  it("shows disconnected status for server not in manager", async () => {
    mockRegistryMethods.listServers.mockReturnValue([makeServerConfig("myserver", "stdio")]);
    mockManagerMethods.getConnection.mockReturnValue(undefined);

    await mcpCommand.execute(["list"], mockSession);

    const messages = vi.mocked(p.log.message).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("disconnected"))).toBe(true);
  });

  it("shows tool count when server is connected with tools", async () => {
    mockRegistryMethods.listServers.mockReturnValue([makeServerConfig("myserver", "stdio")]);
    mockManagerMethods.getConnection.mockReturnValue(makeConnection("myserver", "stdio", 7));

    await mcpCommand.execute(["list"], mockSession);

    const messages = vi.mocked(p.log.message).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("7 tools"))).toBe(true);
  });

  it("shows server description when present", async () => {
    mockRegistryMethods.listServers.mockReturnValue([
      makeServerConfig("myserver", "stdio", true, "A great server"),
    ]);
    mockManagerMethods.getConnection.mockReturnValue(undefined);

    await mcpCommand.execute(["list"], mockSession);

    const messages = vi.mocked(p.log.message).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("A great server"))).toBe(true);
  });

  it("calls p.intro and p.outro", async () => {
    mockRegistryMethods.listServers.mockReturnValue([]);

    await mcpCommand.execute(["list"], mockSession);

    expect(p.intro).toHaveBeenCalled();
    expect(p.outro).toHaveBeenCalled();
  });

  it("returns false", async () => {
    const result = await mcpCommand.execute(["list"], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /mcp status
// ---------------------------------------------------------------------------

describe("/mcp status", () => {
  it("shows message when no servers are connected", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([]);

    await mcpCommand.execute(["status"], mockSession);

    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining("No MCP servers currently connected"),
    );
  });

  it("shows each connected server name and tool count", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([
      makeConnection("filesystem", "stdio", 5),
      makeConnection("github", "http", 12),
    ]);

    await mcpCommand.execute(["status"], mockSession);

    const messages = vi.mocked(p.log.message).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("filesystem"))).toBe(true);
    expect(messages.some((m) => m.includes("github"))).toBe(true);
    expect(messages.some((m) => m.includes("5 tools"))).toBe(true);
    expect(messages.some((m) => m.includes("12 tools"))).toBe(true);
  });

  it("shows healthy indicator for healthy connection", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([makeConnection("myserver", "stdio", 3, true)]);

    await mcpCommand.execute(["status"], mockSession);

    const messages = vi.mocked(p.log.message).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("●"))).toBe(true);
  });

  it("calls p.outro with server count", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([
      makeConnection("a"),
      makeConnection("b"),
    ]);

    await mcpCommand.execute(["status"], mockSession);

    expect(p.outro).toHaveBeenCalledWith(expect.stringContaining("2"));
  });

  it("returns false", async () => {
    const result = await mcpCommand.execute(["status"], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /mcp health
// ---------------------------------------------------------------------------

describe("/mcp health", () => {
  it("shows message when no servers connected", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([]);

    await mcpCommand.execute(["health"], mockSession);

    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining("No MCP servers currently connected"),
    );
  });

  it("checks health of all connected servers when no name given", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([
      makeConnection("server-a"),
      makeConnection("server-b"),
    ]);
    mockManagerMethods.healthCheck.mockResolvedValue({
      name: "server-a",
      healthy: true,
      toolCount: 3,
      latencyMs: 10,
    });

    await mcpCommand.execute(["health"], mockSession);

    expect(mockManagerMethods.healthCheck).toHaveBeenCalledTimes(2);
  });

  it("checks health of named server only", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([
      makeConnection("server-a"),
      makeConnection("server-b"),
    ]);
    mockManagerMethods.healthCheck.mockResolvedValue({
      name: "server-a",
      healthy: true,
      toolCount: 3,
      latencyMs: 10,
    });

    await mcpCommand.execute(["health", "server-a"], mockSession);

    expect(mockManagerMethods.healthCheck).toHaveBeenCalledTimes(1);
    expect(mockManagerMethods.healthCheck).toHaveBeenCalledWith("server-a");
  });

  it("shows error when named server is not connected", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([makeConnection("other-server")]);

    await mcpCommand.execute(["health", "missing-server"], mockSession);

    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("missing-server"));
    expect(mockManagerMethods.healthCheck).not.toHaveBeenCalled();
  });

  it("shows success for healthy server", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([makeConnection("myserver")]);
    mockManagerMethods.healthCheck.mockResolvedValue({
      name: "myserver",
      healthy: true,
      toolCount: 4,
      latencyMs: 50,
    });

    await mcpCommand.execute(["health"], mockSession);

    expect(p.log.success).toHaveBeenCalledWith(expect.stringContaining("myserver"));
  });

  it("shows error for unhealthy server", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([makeConnection("badserver")]);
    mockManagerMethods.healthCheck.mockResolvedValue({
      name: "badserver",
      healthy: false,
      toolCount: 0,
      latencyMs: 5001,
      error: "Health check timeout",
    });

    await mcpCommand.execute(["health"], mockSession);

    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("badserver"));
  });

  it("returns false", async () => {
    const result = await mcpCommand.execute(["health"], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /mcp restart
// ---------------------------------------------------------------------------

describe("/mcp restart", () => {
  it("shows usage error when no server name provided", async () => {
    await mcpCommand.execute(["restart"], mockSession);

    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("Usage"));
    expect(mockManagerMethods.restartServer).not.toHaveBeenCalled();
  });

  it("shows error when named server is not connected", async () => {
    mockManagerMethods.getConnection.mockReturnValue(undefined);

    await mcpCommand.execute(["restart", "missing-server"], mockSession);

    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("missing-server"));
    expect(mockManagerMethods.restartServer).not.toHaveBeenCalled();
  });

  it("calls restartServer when server is connected", async () => {
    mockManagerMethods.getConnection.mockReturnValue(makeConnection("myserver"));
    mockManagerMethods.restartServer.mockResolvedValue(makeConnection("myserver", "stdio", 5));

    await mcpCommand.execute(["restart", "myserver"], mockSession);

    expect(mockManagerMethods.restartServer).toHaveBeenCalledWith("myserver");
  });

  it("shows success message after restart", async () => {
    mockManagerMethods.getConnection.mockReturnValue(makeConnection("myserver"));
    mockManagerMethods.restartServer.mockResolvedValue(makeConnection("myserver", "stdio", 5));

    await mcpCommand.execute(["restart", "myserver"], mockSession);

    expect(p.log.success).toHaveBeenCalledWith(expect.stringContaining("myserver"));
  });

  it("shows error when restart throws", async () => {
    const mockSpinner = { start: vi.fn(), stop: vi.fn() };
    vi.mocked(p.spinner).mockReturnValue(mockSpinner as any);
    mockManagerMethods.getConnection.mockReturnValue(makeConnection("flaky"));
    mockManagerMethods.restartServer.mockRejectedValue(new Error("Connection refused"));

    await mcpCommand.execute(["restart", "flaky"], mockSession);

    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("Connection refused"));
    expect(mockSpinner.stop).toHaveBeenCalled();
  });

  it("returns false", async () => {
    mockManagerMethods.getConnection.mockReturnValue(undefined);
    const result = await mcpCommand.execute(["restart", "any"], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unknown subcommand
// ---------------------------------------------------------------------------

describe("/mcp unknown subcommand", () => {
  it("shows error for unrecognized subcommand", async () => {
    await mcpCommand.execute(["foobar"], mockSession);

    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("foobar"));
  });

  it("returns false", async () => {
    const result = await mcpCommand.execute(["unknown-cmd"], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("/mcp error handling", () => {
  it("catches errors thrown by registry.load() and shows error message", async () => {
    mockRegistryMethods.load.mockRejectedValue(new Error("Disk read failed"));

    const result = await mcpCommand.execute(["list"], mockSession);

    expect(result).toBe(false);
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("Disk read failed"));
  });
});

// ---------------------------------------------------------------------------
// Singleton regression — verifies commands use getMCPServerManager (not create)
// ---------------------------------------------------------------------------

describe("MCP singleton usage", () => {
  it("status subcommand calls getMCPServerManager (not createMCPServerManager)", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([]);

    await mcpCommand.execute(["status"], mockSession);

    // getMCPServerManager must have been called at least once
    expect(mockGetMCPServerManager).toHaveBeenCalled();
  });

  it("health subcommand calls getMCPServerManager (not createMCPServerManager)", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([]);

    await mcpCommand.execute(["health"], mockSession);

    expect(mockGetMCPServerManager).toHaveBeenCalled();
  });

  it("restart subcommand calls getMCPServerManager (not createMCPServerManager)", async () => {
    mockManagerMethods.getConnection.mockReturnValue(undefined);

    await mcpCommand.execute(["restart", "myserver"], mockSession);

    expect(mockGetMCPServerManager).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// formatLatency branches
// ---------------------------------------------------------------------------

describe("formatLatency via health output", () => {
  it("shows <1ms for sub-millisecond latency", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([makeConnection("fast")]);
    mockManagerMethods.healthCheck.mockResolvedValue({
      name: "fast",
      healthy: true,
      toolCount: 1,
      latencyMs: 0.5,
    });

    await mcpCommand.execute(["health"], mockSession);

    expect(p.log.success).toHaveBeenCalledWith(expect.stringContaining("<1ms"));
  });

  it("shows seconds for latency >= 1000ms", async () => {
    mockManagerMethods.getAllConnections.mockReturnValue([makeConnection("slow")]);
    mockManagerMethods.healthCheck.mockResolvedValue({
      name: "slow",
      healthy: true,
      toolCount: 1,
      latencyMs: 1500,
    });

    await mcpCommand.execute(["health"], mockSession);

    expect(p.log.success).toHaveBeenCalledWith(expect.stringContaining("1.5s"));
  });
});

// ---------------------------------------------------------------------------
// /mcp list — disabled server state
// ---------------------------------------------------------------------------

describe("/mcp list — disabled server", () => {
  it("shows disabled label for servers with enabled: false", async () => {
    mockRegistryMethods.listServers.mockReturnValue([
      makeServerConfig("inactive-server", "stdio", false),
    ]);
    mockManagerMethods.getConnection.mockReturnValue(undefined);

    await mcpCommand.execute(["list"], mockSession);

    expect(p.log.message).toHaveBeenCalledWith(expect.stringContaining("disabled"));
  });
});
