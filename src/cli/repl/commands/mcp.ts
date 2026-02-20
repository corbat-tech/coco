/**
 * MCP Command for REPL
 *
 * Provides visibility and management of MCP (Model Context Protocol) servers.
 *
 * Subcommands:
 *   /mcp          — list all configured servers (alias for /mcp list)
 *   /mcp list     — list all configured servers with transport and status
 *   /mcp status   — show connected servers with tool count
 *   /mcp health [name]  — run health check on one or all servers
 *   /mcp restart <name> — restart a specific server
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import { getMCPServerManager } from "../../../mcp/lifecycle.js";
import { MCPRegistryImpl } from "../../../mcp/registry.js";

/**
 * Format latency as a human-readable string.
 */
function formatLatency(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * List all configured MCP servers (from registry) with runtime status.
 */
async function listServers(): Promise<void> {
  const registry = new MCPRegistryImpl();
  await registry.load();

  const servers = registry.listServers();
  const manager = getMCPServerManager();

  p.intro("MCP Servers");

  if (servers.length === 0) {
    p.log.info("No MCP servers configured.");
    p.log.message(chalk.dim("  Add servers via the MCP registry or configuration file."));
    p.outro("Done");
    return;
  }

  for (const server of servers) {
    const connection = manager.getConnection(server.name);
    const enabled = server.enabled !== false;
    const connected = connection !== undefined;

    const enabledLabel = enabled ? chalk.green("enabled") : chalk.dim("disabled");
    const connectedLabel = connected ? chalk.green("connected") : chalk.dim("disconnected");
    const toolLabel =
      connected && connection.toolCount > 0
        ? chalk.dim(` · ${connection.toolCount} tools`)
        : "";

    p.log.message(
      `  ${chalk.bold(server.name)}  ${chalk.dim(server.transport)}  ${enabledLabel}  ${connectedLabel}${toolLabel}`,
    );

    if (server.description) {
      p.log.message(chalk.dim(`    ${server.description}`));
    }
  }

  p.outro(`${servers.length} server(s) configured`);
}

/**
 * Show connected servers with tool counts.
 */
function showStatus(): void {
  const manager = getMCPServerManager();
  const connections = manager.getAllConnections();

  p.intro("MCP Status");

  if (connections.length === 0) {
    p.log.info("No MCP servers currently connected.");
    p.outro("Done");
    return;
  }

  for (const conn of connections) {
    const uptime = Math.round((Date.now() - conn.connectedAt.getTime()) / 1000);
    const uptimeStr =
      uptime < 60
        ? `${uptime}s`
        : uptime < 3600
          ? `${Math.floor(uptime / 60)}m`
          : `${Math.floor(uptime / 3600)}h`;

    const healthIcon = conn.healthy ? chalk.green("●") : chalk.red("●");
    p.log.message(
      `  ${healthIcon} ${chalk.bold(conn.name)}  ${chalk.dim(conn.config.transport)}  ${conn.toolCount} tools  ${chalk.dim(`up ${uptimeStr}`)}`,
    );
  }

  p.outro(`${connections.length} server(s) connected`);
}

/**
 * Run health check on one or all servers.
 */
async function runHealthCheck(name?: string): Promise<void> {
  const manager = getMCPServerManager();

  p.intro(name ? `MCP Health: ${name}` : "MCP Health Check");

  const connections = manager.getAllConnections();

  if (connections.length === 0) {
    p.log.info("No MCP servers currently connected.");
    p.outro("Done");
    return;
  }

  const targets = name
    ? connections.filter((c) => c.name === name)
    : connections;

  if (name && targets.length === 0) {
    p.log.error(`Server '${name}' is not connected.`);
    p.outro("Done");
    return;
  }

  for (const conn of targets) {
    const result = await manager.healthCheck(conn.name);

    if (result.healthy) {
      p.log.success(
        `${conn.name}  ${chalk.green("healthy")}  ${result.toolCount} tools  ${chalk.dim(formatLatency(result.latencyMs))}`,
      );
    } else {
      p.log.error(
        `${conn.name}  ${chalk.red("unhealthy")}  ${chalk.dim(result.error ?? "unknown error")}`,
      );
    }
  }

  p.outro("Done");
}

/**
 * Restart a specific server by name.
 */
async function restartServer(name: string): Promise<void> {
  const manager = getMCPServerManager();

  p.intro(`MCP Restart: ${name}`);

  const connection = manager.getConnection(name);
  if (!connection) {
    p.log.error(`Server '${name}' is not connected. Cannot restart.`);
    p.log.message(chalk.dim("  Use /mcp list to see available servers."));
    p.outro("Done");
    return;
  }

  const spinner = p.spinner();
  try {
    spinner.start(`Restarting ${name}...`);

    const newConn = await manager.restartServer(name);

    spinner.stop(`Restarted ${name}`);
    p.log.success(`${name}  connected  ${newConn.toolCount} tools`);
  } catch (error) {
    spinner.stop();
    p.log.error(
      `Failed to restart '${name}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  p.outro("Done");
}

/**
 * MCP command
 */
export const mcpCommand: SlashCommand = {
  name: "mcp",
  aliases: [],
  description: "Manage MCP servers (list, status, health, restart)",
  usage: "/mcp [list|status|health [name]|restart <name>]",
  execute: async (args: string[], _session: ReplSession): Promise<boolean> => {
    const subcommand = args[0]?.toLowerCase() ?? "list";

    try {
      switch (subcommand) {
        case "list":
          await listServers();
          break;

        case "status":
          showStatus();
          break;

        case "health": {
          const serverName = args[1];
          await runHealthCheck(serverName);
          break;
        }

        case "restart": {
          const serverName = args[1];
          if (!serverName) {
            p.log.error("Usage: /mcp restart <name>");
            break;
          }
          await restartServer(serverName);
          break;
        }

        default:
          p.log.error(`Unknown subcommand: ${subcommand}`);
          p.log.message(chalk.dim("  Available: list, status, health [name], restart <name>"));
          break;
      }
    } catch (error) {
      p.log.error(
        `MCP command failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return false;
  },
};
