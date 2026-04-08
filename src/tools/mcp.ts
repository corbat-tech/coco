/**
 * MCP inspection tools
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { MCPRegistryImpl } from "../mcp/registry.js";
import {
  loadMCPServersFromCOCOConfig,
  loadProjectMCPFile,
  mergeMCPConfigs,
} from "../mcp/config-loader.js";
import { getMCPServerManager } from "../mcp/lifecycle.js";
import { registerMCPTools } from "../mcp/tools.js";
import { getAgentToolRegistry } from "../agents/provider-bridge.js";
import type { MCPServerConfig } from "../mcp/types.js";

export interface MCPFleetServerStatus {
  name: string;
  transport: "stdio" | "http" | "sse";
  enabled: boolean;
  connected: boolean;
  healthy: boolean;
  toolCount: number;
  tools?: string[];
}

export interface MCPFleetStatus {
  configuredCount: number;
  connectedCount: number;
  servers: MCPFleetServerStatus[];
}

export interface MCPConnectServerResult {
  requestedServer: string;
  connected: boolean;
  healthy: boolean;
  toolCount: number;
  tools?: string[];
  authTriggered: boolean;
  message: string;
}

async function loadConfiguredServers(projectPath?: string): Promise<MCPServerConfig[]> {
  const registry = new MCPRegistryImpl();
  await registry.load();

  const resolvedProjectPath = projectPath || process.cwd();
  return mergeMCPConfigs(
    registry.listServers(),
    await loadMCPServersFromCOCOConfig(),
    await loadProjectMCPFile(resolvedProjectPath),
  );
}

function findConfiguredServer(
  servers: MCPServerConfig[],
  requestedServer: string,
): MCPServerConfig | undefined {
  const normalized = requestedServer.trim().toLowerCase();
  return servers.find((server) => {
    const name = server.name.toLowerCase();
    if (name === normalized) return true;
    if (name.includes(normalized) || normalized.includes(name)) return true;
    if (name.includes("atlassian") && /^(atlassian|jira|confluence)$/.test(normalized)) return true;
    return false;
  });
}

export const mcpListServersTool: ToolDefinition<
  { includeDisabled?: boolean; includeTools?: boolean; projectPath?: string },
  MCPFleetStatus
> = defineTool({
  name: "mcp_list_servers",
  description: `Inspect Coco's MCP configuration and current runtime connections.

Use this instead of bash_exec with "coco mcp ..." and instead of manually reading ~/.coco/mcp.json
when you need to know which MCP servers are configured, connected, healthy, or which tools they expose.`,
  category: "config",
  parameters: z.object({
    includeDisabled: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include disabled MCP servers in the result"),
    includeTools: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include the list of exposed tool names for connected servers"),
    projectPath: z
      .string()
      .optional()
      .describe("Project path whose .mcp.json should be merged. Defaults to process.cwd()"),
  }),
  async execute({ includeDisabled, includeTools, projectPath }) {
    const configuredServers = (await loadConfiguredServers(projectPath)).filter(
      (server) => includeDisabled || server.enabled !== false,
    );

    const manager = getMCPServerManager();
    const servers: MCPFleetServerStatus[] = [];

    for (const server of configuredServers) {
      const connection = manager.getConnection(server.name);
      let tools: string[] | undefined;

      if (includeTools && connection) {
        try {
          const listed = await connection.client.listTools();
          tools = listed.tools.map((tool) => tool.name);
        } catch {
          tools = [];
        }
      }

      servers.push({
        name: server.name,
        transport: server.transport,
        enabled: server.enabled !== false,
        connected: connection !== undefined,
        healthy: connection?.healthy ?? false,
        toolCount: connection?.toolCount ?? 0,
        ...(includeTools ? { tools: tools ?? [] } : {}),
      });
    }

    return {
      configuredCount: servers.length,
      connectedCount: servers.filter((server) => server.connected).length,
      servers,
    };
  },
});

export const mcpConnectServerTool: ToolDefinition<
  { server: string; includeTools?: boolean; projectPath?: string },
  MCPConnectServerResult
> = defineTool({
  name: "mcp_connect_server",
  description: `Connect or reconnect a configured MCP server in the current Coco session.

Use this when mcp_list_servers shows a service as configured but disconnected, or when
the user explicitly asks you to use a specific MCP service. This tool can trigger the
built-in MCP OAuth browser login flow. Do not ask the user for raw tokens when this exists.`,
  category: "config",
  parameters: z.object({
    server: z
      .string()
      .describe("Configured MCP server name, or a common alias like 'jira' or 'atlassian'"),
    includeTools: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include discovered MCP tool names after connecting"),
    projectPath: z
      .string()
      .optional()
      .describe("Project path whose .mcp.json should be merged. Defaults to process.cwd()"),
  }),
  async execute({ server, includeTools, projectPath }) {
    const configuredServers = await loadConfiguredServers(projectPath);
    const target = findConfiguredServer(
      configuredServers.filter((configuredServer) => configuredServer.enabled !== false),
      server,
    );

    if (!target) {
      throw new Error(`MCP server '${server}' is not configured`);
    }

    const manager = getMCPServerManager();
    const existingConnection = manager.getConnection(target.name);
    if (existingConnection && existingConnection.healthy === false) {
      await manager.stopServer(target.name);
    }

    const connection = await manager.startServer(target);
    const toolRegistry = getAgentToolRegistry();
    if (toolRegistry) {
      await registerMCPTools(toolRegistry, connection.name, connection.client);
    }

    let tools: string[] | undefined;
    if (includeTools) {
      try {
        const listed = await connection.client.listTools();
        tools = listed.tools.map((tool) => tool.name);
      } catch {
        tools = [];
      }
    }

    return {
      requestedServer: server,
      connected: true,
      healthy: true,
      toolCount: connection.toolCount,
      ...(includeTools ? { tools: tools ?? [] } : {}),
      authTriggered: target.transport === "http",
      message: `MCP server '${target.name}' is connected for this session.`,
    };
  },
});

export const mcpTools = [mcpListServersTool, mcpConnectServerTool];
