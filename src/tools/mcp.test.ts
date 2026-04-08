import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRegistryMethods = {
  load: vi.fn(),
  listServers: vi.fn(),
};

const mockConfigLoader = vi.hoisted(() => ({
  loadMCPServersFromCOCOConfig: vi.fn(),
  loadProjectMCPFile: vi.fn(),
  mergeMCPConfigs: vi.fn((...configs: Array<Array<Record<string, unknown>>>) => {
    const merged = new Map<string, Record<string, unknown>>();
    for (const config of configs) {
      for (const server of config) {
        merged.set(String(server.name), { ...merged.get(String(server.name)), ...server });
      }
    }
    return Array.from(merged.values());
  }),
}));

const mockManagerMethods = {
  getConnection: vi.fn(),
};

vi.mock("../mcp/registry.js", () => ({
  MCPRegistryImpl: function () {
    return mockRegistryMethods;
  },
}));

vi.mock("../mcp/config-loader.js", () => mockConfigLoader);

vi.mock("../mcp/lifecycle.js", () => ({
  getMCPServerManager: vi.fn(() => mockManagerMethods),
}));

describe("mcpListServersTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistryMethods.load.mockResolvedValue(undefined);
    mockRegistryMethods.listServers.mockReturnValue([]);
    mockConfigLoader.loadMCPServersFromCOCOConfig.mockResolvedValue([]);
    mockConfigLoader.loadProjectMCPFile.mockResolvedValue([]);
    mockManagerMethods.getConnection.mockReturnValue(undefined);
  });

  it("lists configured servers merged from all MCP sources", async () => {
    const { mcpListServersTool } = await import("./mcp.js");

    mockRegistryMethods.listServers.mockReturnValue([{ name: "atlassian", transport: "http" }]);
    mockConfigLoader.loadMCPServersFromCOCOConfig.mockResolvedValue([
      { name: "github", transport: "http" },
    ]);

    const result = await mcpListServersTool.execute({});

    expect(result.configuredCount).toBe(2);
    expect(result.connectedCount).toBe(0);
    expect(result.servers.map((server) => server.name)).toEqual(["atlassian", "github"]);
  });

  it("includes runtime connection state and tools when requested", async () => {
    const { mcpListServersTool } = await import("./mcp.js");

    mockRegistryMethods.listServers.mockReturnValue([{ name: "atlassian", transport: "http" }]);
    mockManagerMethods.getConnection.mockReturnValue({
      healthy: true,
      toolCount: 2,
      client: {
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: "browse_issue" }, { name: "search_issues" }],
        }),
      },
    });

    const result = await mcpListServersTool.execute({ includeTools: true });

    expect(result.connectedCount).toBe(1);
    expect(result.servers[0]).toMatchObject({
      name: "atlassian",
      connected: true,
      healthy: true,
      toolCount: 2,
      tools: ["browse_issue", "search_issues"],
    });
  });

  it("filters disabled servers by default", async () => {
    const { mcpListServersTool } = await import("./mcp.js");

    mockRegistryMethods.listServers.mockReturnValue([
      { name: "atlassian", transport: "http", enabled: false },
      { name: "github", transport: "http", enabled: true },
    ]);

    const result = await mcpListServersTool.execute({});

    expect(result.servers.map((server) => server.name)).toEqual(["github"]);
  });
});
