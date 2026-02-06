/**
 * MCP Server Lifecycle Manager
 * Manages connection lifecycle for MCP servers: start, stop, health check, restart
 */

import type { MCPClient, MCPServerConfig, MCPTransport } from "./types.js";
import { MCPClientImpl } from "./client.js";
import { StdioTransport } from "./transport/stdio.js";
import { HTTPTransport } from "./transport/http.js";
import { SSETransport } from "./transport/sse.js";
import { MCPConnectionError } from "./errors.js";
import { getLogger } from "../utils/logger.js";

/**
 * Server connection state
 */
export interface ServerConnection {
  name: string;
  client: MCPClient;
  transport: MCPTransport;
  config: MCPServerConfig;
  connectedAt: Date;
  toolCount: number;
  healthy: boolean;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  name: string;
  healthy: boolean;
  toolCount: number;
  latencyMs: number;
  error?: string;
}

/**
 * MCP Server Lifecycle Manager
 */
export class MCPServerManager {
  private connections = new Map<string, ServerConnection>();
  private logger = getLogger();

  /**
   * Create transport for a server config
   */
  private createTransport(config: MCPServerConfig): MCPTransport {
    switch (config.transport) {
      case "stdio": {
        if (!config.stdio?.command) {
          throw new MCPConnectionError(
            `Server '${config.name}' requires stdio.command`,
          );
        }
        return new StdioTransport({
          command: config.stdio.command,
          args: config.stdio.args ?? [],
          env: config.stdio.env,
        });
      }
      case "http": {
        if (!config.http?.url) {
          throw new MCPConnectionError(
            `Server '${config.name}' requires http.url`,
          );
        }
        return new HTTPTransport({
          url: config.http.url,
          headers: config.http.headers,
          auth: config.http.auth,
        });
      }
      case "sse": {
        if (!config.http?.url) {
          throw new MCPConnectionError(
            `Server '${config.name}' requires http.url for SSE`,
          );
        }
        return new SSETransport({
          url: config.http.url,
          headers: config.http.headers,
        });
      }
      default:
        throw new MCPConnectionError(
          `Unsupported transport: ${config.transport}`,
        );
    }
  }

  /**
   * Start a single server
   */
  async startServer(config: MCPServerConfig): Promise<ServerConnection> {
    if (this.connections.has(config.name)) {
      this.logger.warn(`Server '${config.name}' already connected`);
      return this.connections.get(config.name)!;
    }

    this.logger.info(`Starting MCP server: ${config.name}`);

    const transport = this.createTransport(config);
    await transport.connect();

    const client = new MCPClientImpl(transport);

    // Initialize MCP protocol
    await client.initialize({
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "coco-mcp-client", version: "0.3.0" },
    });

    // Get tool count
    let toolCount = 0;
    try {
      const { tools } = await client.listTools();
      toolCount = tools.length;
    } catch {
      // Non-fatal: tools list might not be available
    }

    const connection: ServerConnection = {
      name: config.name,
      client,
      transport,
      config,
      connectedAt: new Date(),
      toolCount,
      healthy: true,
    };

    this.connections.set(config.name, connection);
    this.logger.info(
      `Server '${config.name}' started with ${toolCount} tools`,
    );

    return connection;
  }

  /**
   * Stop a single server
   */
  async stopServer(name: string): Promise<void> {
    const connection = this.connections.get(name);
    if (!connection) {
      this.logger.warn(`Server '${name}' not found`);
      return;
    }

    this.logger.info(`Stopping MCP server: ${name}`);

    try {
      await connection.transport.disconnect();
    } catch (error) {
      this.logger.error(
        `Error disconnecting server '${name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.connections.delete(name);
  }

  /**
   * Restart a server
   */
  async restartServer(name: string): Promise<ServerConnection> {
    const connection = this.connections.get(name);
    if (!connection) {
      throw new MCPConnectionError(`Server '${name}' not found`);
    }

    const config = connection.config;
    await this.stopServer(name);

    // Small delay before restart
    await new Promise((resolve) => setTimeout(resolve, 500));

    return this.startServer(config);
  }

  /**
   * Health check for a server
   */
  async healthCheck(name: string): Promise<HealthCheckResult> {
    const connection = this.connections.get(name);
    if (!connection) {
      return {
        name,
        healthy: false,
        toolCount: 0,
        latencyMs: 0,
        error: "Server not connected",
      };
    }

    const startTime = performance.now();

    try {
      const { tools } = await Promise.race([
        connection.client.listTools(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), 5000),
        ),
      ]);

      const latencyMs = performance.now() - startTime;
      connection.healthy = true;
      connection.toolCount = tools.length;

      return {
        name,
        healthy: true,
        toolCount: tools.length,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      connection.healthy = false;

      return {
        name,
        healthy: false,
        toolCount: 0,
        latencyMs,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Start all servers from config list
   */
  async startAll(
    configs: MCPServerConfig[],
  ): Promise<Map<string, ServerConnection>> {
    const results = new Map<string, ServerConnection>();

    for (const config of configs) {
      if (config.enabled === false) continue;

      try {
        const connection = await this.startServer(config);
        results.set(config.name, connection);
      } catch (error) {
        this.logger.error(
          `Failed to start server '${config.name}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return results;
  }

  /**
   * Stop all servers
   */
  async stopAll(): Promise<void> {
    const names = Array.from(this.connections.keys());
    for (const name of names) {
      await this.stopServer(name);
    }
  }

  /**
   * Get list of connected server names
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get a specific server connection
   */
  getConnection(name: string): ServerConnection | undefined {
    return this.connections.get(name);
  }

  /**
   * Get all connections
   */
  getAllConnections(): ServerConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get the client for a server
   */
  getClient(name: string): MCPClient | undefined {
    return this.connections.get(name)?.client;
  }
}

/**
 * Create a singleton lifecycle manager
 */
let globalManager: MCPServerManager | null = null;

export function getMCPServerManager(): MCPServerManager {
  if (!globalManager) {
    globalManager = new MCPServerManager();
  }
  return globalManager;
}

/**
 * Create a new lifecycle manager
 */
export function createMCPServerManager(): MCPServerManager {
  return new MCPServerManager();
}
