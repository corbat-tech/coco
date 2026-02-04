/**
 * MCP Registry
 *
 * Manages MCP server configurations with persistence.
 */

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MCPErrorCode, type MCPRegistry, type MCPServerConfig } from './types.js';
import {
  validateServerConfig,
  parseRegistry,
  serializeRegistry,
  getDefaultRegistryPath,
} from './config.js';
import { MCPError } from './errors.js';

/**
 * MCP Registry implementation
 */
export class MCPRegistryImpl implements MCPRegistry {
  private servers = new Map<string, MCPServerConfig>();
  private registryPath: string;

  constructor(registryPath?: string) {
    this.registryPath = registryPath || getDefaultRegistryPath();
  }

  /**
   * Add or update a server configuration
   */
  async addServer(config: MCPServerConfig): Promise<void> {
    validateServerConfig(config);

    // Merge with existing if present
    const existing = this.servers.get(config.name);
    if (existing) {
      this.servers.set(config.name, { ...existing, ...config });
    } else {
      this.servers.set(config.name, config);
    }

    await this.save();
  }

  /**
   * Remove a server by name
   */
  async removeServer(name: string): Promise<boolean> {
    const existed = this.servers.has(name);
    if (existed) {
      this.servers.delete(name);
      await this.save();
    }
    return existed;
  }

  /**
   * Get a server configuration by name
   */
  getServer(name: string): MCPServerConfig | undefined {
    return this.servers.get(name);
  }

  /**
   * List all registered servers
   */
  listServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * List enabled servers only
   */
  listEnabledServers(): MCPServerConfig[] {
    return this.listServers().filter((s) => s.enabled !== false);
  }

  /**
   * Check if a server exists
   */
  hasServer(name: string): boolean {
    return this.servers.has(name);
  }

  /**
   * Get registry file path
   */
  getRegistryPath(): string {
    return this.registryPath;
  }

  /**
   * Save registry to disk
   */
  async save(): Promise<void> {
    try {
      await this.ensureDir(this.registryPath);
      const data = serializeRegistry(this.listServers());
      await writeFile(this.registryPath, data, 'utf-8');
    } catch (error) {
      throw new MCPError(
        MCPErrorCode.TRANSPORT_ERROR,
        `Failed to save registry: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Load registry from disk
   */
  async load(): Promise<void> {
    try {
      await access(this.registryPath);
      const content = await readFile(this.registryPath, 'utf-8');
      const servers = parseRegistry(content);

      this.servers.clear();
      for (const server of servers) {
        try {
          validateServerConfig(server);
          this.servers.set(server.name, server);
        } catch {
          // Skip invalid server configs
        }
      }
    } catch {
      // Registry doesn't exist yet, start empty
      this.servers.clear();
    }
  }

  /**
   * Ensure directory exists
   */
  private async ensureDir(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
  }
}

/**
 * Create a new MCP registry
 */
export function createMCPRegistry(registryPath?: string): MCPRegistry {
  return new MCPRegistryImpl(registryPath);
}
