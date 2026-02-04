/**
 * MCP Configuration Module
 *
 * Handles MCP configuration files and settings.
 */

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { MCPErrorCode, type MCPServerConfig } from './types.js';
import { MCPError } from './errors.js';

/**
 * Default MCP configuration directory
 */
export const DEFAULT_MCP_CONFIG_DIR = join(homedir(), '.config', 'coco', 'mcp');

/**
 * Default registry file name
 */
export const DEFAULT_REGISTRY_FILE = 'registry.json';

/**
 * MCP global configuration
 */
export interface MCPGlobalConfig {
  /** Default timeout for MCP requests (milliseconds) */
  defaultTimeout: number;
  /** Auto-discover servers from well-known locations */
  autoDiscover: boolean;
  /** Log level for MCP operations */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Path to custom servers directory */
  customServersPath?: string;
}

/**
 * Default global configuration
 */
export const DEFAULT_MCP_CONFIG: MCPGlobalConfig = {
  defaultTimeout: 60000,
  autoDiscover: true,
  logLevel: 'info',
};

/**
 * Validate server configuration
 */
export function validateServerConfig(config: unknown): asserts config is MCPServerConfig {
  if (!config || typeof config !== 'object') {
    throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'Server config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  // Validate name
  if (!cfg.name || typeof cfg.name !== 'string') {
    throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'Server name is required and must be a string');
  }

  if (cfg.name.length < 1 || cfg.name.length > 64) {
    throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'Server name must be between 1 and 64 characters');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(cfg.name)) {
    throw new MCPError(
      MCPErrorCode.INVALID_PARAMS,
      'Server name must contain only letters, numbers, underscores, and hyphens'
    );
  }

  // Validate transport
  if (!cfg.transport || (cfg.transport !== 'stdio' && cfg.transport !== 'http')) {
    throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'Transport must be "stdio" or "http"');
  }

  // Validate transport-specific config
  if (cfg.transport === 'stdio') {
    if (!cfg.stdio || typeof cfg.stdio !== 'object') {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'stdio transport requires stdio configuration');
    }
    const stdio = cfg.stdio as Record<string, unknown>;
    if (!stdio.command || typeof stdio.command !== 'string') {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'stdio.command is required');
    }
  }

  if (cfg.transport === 'http') {
    if (!cfg.http || typeof cfg.http !== 'object') {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'http transport requires http configuration');
    }
    const http = cfg.http as Record<string, unknown>;
    if (!http.url || typeof http.url !== 'string') {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'http.url is required');
    }
    try {
      // eslint-disable-next-line no-new
      new URL(http.url as string);
    } catch {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'http.url must be a valid URL');
    }
  }
}

/**
 * Ensure directory exists
 */
async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch {
    // Directory might already exist
  }
}

/**
 * Load MCP global configuration
 */
export async function loadMCPConfig(
  configPath?: string
): Promise<MCPGlobalConfig> {
  const path = configPath || join(DEFAULT_MCP_CONFIG_DIR, 'config.json');

  try {
    await access(path);
    const content = await readFile(path, 'utf-8');
    const parsed = JSON.parse(content) as Partial<MCPGlobalConfig>;
    return { ...DEFAULT_MCP_CONFIG, ...parsed };
  } catch {
    return DEFAULT_MCP_CONFIG;
  }
}

/**
 * Save MCP global configuration
 */
export async function saveMCPConfig(
  config: MCPGlobalConfig,
  configPath?: string
): Promise<void> {
  const path = configPath || join(DEFAULT_MCP_CONFIG_DIR, 'config.json');
  await ensureDir(path);
  await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get default registry path
 */
export function getDefaultRegistryPath(): string {
  return join(DEFAULT_MCP_CONFIG_DIR, DEFAULT_REGISTRY_FILE);
}

/**
 * Parse registry from JSON
 */
export function parseRegistry(json: string): MCPServerConfig[] {
  try {
    const parsed = JSON.parse(json) as { servers?: MCPServerConfig[] };
    if (!parsed.servers || !Array.isArray(parsed.servers)) {
      return [];
    }
    return parsed.servers;
  } catch {
    return [];
  }
}

/**
 * Serialize registry to JSON
 */
export function serializeRegistry(servers: MCPServerConfig[]): string {
  return JSON.stringify({ servers, version: '1.0' }, null, 2);
}
