/**
 * MCP Config File Loader
 *
 * Loads MCP configuration from external files.
 */

import { readFile, access } from 'node:fs/promises';
import type { MCPServerConfig } from './types.js';
import { validateServerConfig } from './config.js';
import { MCPErrorCode } from './types.js';
import { MCPError } from './errors.js';

/**
 * MCP config file format
 */
export interface MCPConfigFile {
  /** Config version */
  version?: string;
  /** MCP servers */
  servers: Array<{
    name: string;
    description?: string;
    transport: 'stdio' | 'http';
    stdio?: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    };
    http?: {
      url: string;
      auth?: {
        type: 'oauth' | 'bearer' | 'apikey';
        token?: string;
        tokenEnv?: string;
        headerName?: string;
      };
      timeout?: number;
    };
    enabled?: boolean;
    metadata?: Record<string, unknown>;
  }>;
}

/**
 * Load MCP config from file
 */
export async function loadMCPConfigFile(configPath: string): Promise<MCPServerConfig[]> {
  try {
    await access(configPath);
  } catch {
    throw new MCPError(
      MCPErrorCode.CONNECTION_ERROR,
      `Config file not found: ${configPath}`
    );
  }

  let content: string;
  try {
    content = await readFile(configPath, 'utf-8');
  } catch (error) {
    throw new MCPError(
      MCPErrorCode.CONNECTION_ERROR,
      `Failed to read config file: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Try JSON5 or YAML in the future
    throw new MCPError(MCPErrorCode.PARSE_ERROR, 'Invalid JSON in config file');
  }

  const config = parsed as MCPConfigFile;

  if (!config.servers || !Array.isArray(config.servers)) {
    throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'Config file must have a "servers" array');
  }

  const validServers: MCPServerConfig[] = [];
  const errors: string[] = [];

  for (const server of config.servers) {
    try {
      const converted = convertServerConfig(server);
      validateServerConfig(converted);
      validServers.push(converted);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Server '${server.name || 'unknown'}': ${message}`);
    }
  }

  if (errors.length > 0) {
    console.warn('Some servers failed to load:', errors);
  }

  return validServers;
}

/**
 * Convert config file format to MCPServerConfig
 */
function convertServerConfig(server: MCPConfigFile['servers'][0]): MCPServerConfig {
  const base: MCPServerConfig = {
    name: server.name,
    description: server.description,
    transport: server.transport,
    enabled: server.enabled ?? true,
    metadata: server.metadata,
  };

  if (server.transport === 'stdio' && server.stdio) {
    return {
      ...base,
      stdio: {
        command: server.stdio.command,
        args: server.stdio.args,
        env: server.stdio.env,
        cwd: server.stdio.cwd,
      },
    };
  }

  if (server.transport === 'http' && server.http) {
    return {
      ...base,
      http: {
        url: server.http.url,
        auth: server.http.auth,
        timeout: server.http.timeout,
      },
    };
  }

  throw new Error(`Missing configuration for transport: ${server.transport}`);
}

/**
 * Merge MCP configs from multiple sources
 */
export function mergeMCPConfigs(
  base: MCPServerConfig[],
  ...overrides: MCPServerConfig[][]
): MCPServerConfig[] {
  const merged = new Map<string, MCPServerConfig>();

  // Add base configs
  for (const server of base) {
    merged.set(server.name, server);
  }

  // Override with each additional config
  for (const override of overrides) {
    for (const server of override) {
      const existing = merged.get(server.name);
      if (existing) {
        merged.set(server.name, { ...existing, ...server });
      } else {
        merged.set(server.name, server);
      }
    }
  }

  return Array.from(merged.values());
}

/**
 * Load MCP servers from COCO config
 */
export async function loadMCPServersFromCOCOConfig(
  configPath?: string
): Promise<MCPServerConfig[]> {
  const { loadConfig } = await import('../config/loader.js');
  const { MCPServerConfigEntrySchema } = await import('../config/schema.js');

  const config = await loadConfig(configPath);
  
  if (!config.mcp?.servers || config.mcp.servers.length === 0) {
    return [];
  }

  const servers: MCPServerConfig[] = [];

  for (const entry of config.mcp.servers) {
    try {
      // Validate entry
      MCPServerConfigEntrySchema.parse(entry);

      // Convert to MCPServerConfig
      const serverConfig: MCPServerConfig = {
        name: entry.name,
        description: entry.description,
        transport: entry.transport,
        enabled: entry.enabled,
        ...(entry.transport === 'stdio' && entry.command && {
          stdio: {
            command: entry.command,
            args: entry.args,
            env: entry.env,
          },
        }),
        ...(entry.transport === 'http' && entry.url && {
          http: {
            url: entry.url,
            auth: entry.auth,
          },
        }),
      };

      validateServerConfig(serverConfig);
      servers.push(serverConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to load MCP server '${entry.name}': ${message}`);
    }
  }

  return servers;
}
