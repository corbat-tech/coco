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
    const registry = new MCPRegistryImpl();
    await registry.load();

    const resolvedProjectPath = projectPath || process.cwd();
    const configuredServers = mergeMCPConfigs(
      registry.listServers(),
      await loadMCPServersFromCOCOConfig(),
      await loadProjectMCPFile(resolvedProjectPath),
    ).filter((server) => includeDisabled || server.enabled !== false);

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

export const mcpTools = [mcpListServersTool];
