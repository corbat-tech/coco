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
import { VERSION } from "../version.js";

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
  private starting = new Map<string, Promise<ServerConnection>>();
  private stopping = new Map<string, Promise<void>>();
  private ready = new Set<string>();

  /**
   * Create transport for a server config
   */
  private createTransport(config: MCPServerConfig): MCPTransport {
    switch (config.transport) {
      case "stdio": {
        if (!config.stdio?.command) {
          throw new MCPConnectionError(`Server '${config.name}' requires stdio.command`);
        }
        return new StdioTransport({
          command: config.stdio.command,
          args: config.stdio.args ?? [],
          env: config.stdio.env,
        });
      }
      case "http": {
        if (!config.http?.url) {
          throw new MCPConnectionError(`Server '${config.name}' requires http.url`);
        }
        return new HTTPTransport({
          name: config.name,
          url: config.http.url,
          headers: config.http.headers,
          auth: config.http.auth,
        });
      }
      case "sse": {
        if (!config.http?.url) {
          throw new MCPConnectionError(`Server '${config.name}' requires http.url for SSE`);
        }
        return new SSETransport({
          url: config.http.url,
          headers: config.http.headers,
        });
      }
      default:
        throw new MCPConnectionError(`Unsupported transport: ${config.transport}`);
    }
  }

  /**
   * Start a single server
   */
  async startServer(config: MCPServerConfig): Promise<ServerConnection> {
    const closing = this.stopping.get(config.name);
    if (closing) {
      await closing;
      return this.startServer(config);
    }
    const opening = this.starting.get(config.name);
    if (opening) return opening;
    const existing = this.connections.get(config.name);
    if (existing) {
      if (this.ready.has(config.name) && existing.transport.isConnected()) return existing;
      existing.healthy = false;
      this.ready.delete(config.name);
      throw new MCPConnectionError(`Server '${config.name}' requires cleanup before restart`);
    }
    const operation = Promise.resolve().then(() => this.openServer(config));
    this.starting.set(config.name, operation);
    try {
      return await operation;
    } finally {
      if (this.starting.get(config.name) === operation) this.starting.delete(config.name);
    }
  }

  private async openServer(config: MCPServerConfig): Promise<ServerConnection> {
    this.logger.info(`Starting MCP server: ${config.name}`);
    const transport = this.createTransport(config);
    const client = new MCPClientImpl(transport);
    const connection: ServerConnection = {
      name: config.name,
      client,
      transport,
      config,
      connectedAt: new Date(),
      toolCount: 0,
      healthy: false,
    };
    // Retain ownership before the first operation can fail or remain pending.
    this.connections.set(config.name, connection);
    try {
      await transport.connect();
      await client.initialize({
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "coco-mcp-client", version: VERSION },
      });
      try {
        const { tools } = await client.listTools({ timeout: 5000 });
        connection.toolCount = tools.length;
      } catch {
        // Servers without tools/list remain usable for other protocol methods.
      }
      if (!transport.isConnected())
        throw new MCPConnectionError("Server disconnected during startup");
      connection.healthy = true;
      this.ready.add(config.name);
      this.logger.info(`Server '${config.name}' started with ${connection.toolCount} tools`);
      return connection;
    } catch (error) {
      try {
        await transport.disconnect();
        this.connections.delete(config.name);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Server '${config.name}' startup and cleanup failed`,
        );
      }
      throw error;
    }
  }

  /** Stop retains ownership until the transport confirms closure. */
  async stopServer(name: string): Promise<void> {
    const closing = this.stopping.get(name);
    if (closing) return closing;
    const opening = this.starting.get(name);
    const operation = Promise.resolve().then(async () => {
      if (opening) await opening.catch(() => {});
      const connection = this.connections.get(name);
      if (!connection) return;
      connection.healthy = false;
      this.ready.delete(name);
      await connection.transport.disconnect();
      if (this.connections.get(name) === connection) this.connections.delete(name);
    });
    this.stopping.set(name, operation);
    try {
      await operation;
    } finally {
      if (this.stopping.get(name) === operation) this.stopping.delete(name);
    }
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
      const { tools } = await connection.client.listTools({ timeout: 5000 });
      if (
        this.connections.get(name) !== connection ||
        !this.ready.has(name) ||
        this.stopping.has(name) ||
        !connection.transport.isConnected()
      ) {
        throw new MCPConnectionError("Server closed during health check");
      }

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
  async startAll(configs: MCPServerConfig[]): Promise<Map<string, ServerConnection>> {
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
    const names = new Set([...this.connections.keys(), ...this.starting.keys()]);
    const results = await Promise.allSettled([...names].map((name) => this.stopServer(name)));
    const errors = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, "Some MCP servers could not be stopped");
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
