/**
 * MCP Configuration Module
 *
 * Handles MCP configuration validation and registry path resolution.
 * Global MCP settings (defaultTimeout, autoDiscover, logLevel) live in
 * ~/.coco/config.json under the `mcp` key — see src/config/schema.ts.
 */

import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_PATHS, LEGACY_PATHS } from "../config/paths.js";
import { MCPErrorCode, type MCPServerConfig } from "./types.js";
import { MCPError } from "./errors.js";
import { getLogger } from "../utils/logger.js";

/**
 * Get default registry path: ~/.coco/mcp.json
 */
export function getDefaultRegistryPath(): string {
  return CONFIG_PATHS.mcpRegistry;
}

/**
 * Validate server configuration
 */
export function validateServerConfig(config: unknown): asserts config is MCPServerConfig {
  if (!config || typeof config !== "object") {
    throw new MCPError(MCPErrorCode.INVALID_PARAMS, "Server config must be an object");
  }

  const cfg = config as Record<string, unknown>;

  // Validate name
  if (!cfg.name || typeof cfg.name !== "string") {
    throw new MCPError(MCPErrorCode.INVALID_PARAMS, "Server name is required and must be a string");
  }

  if (cfg.name.length < 1 || cfg.name.length > 64) {
    throw new MCPError(
      MCPErrorCode.INVALID_PARAMS,
      "Server name must be between 1 and 64 characters",
    );
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(cfg.name)) {
    throw new MCPError(
      MCPErrorCode.INVALID_PARAMS,
      "Server name must contain only letters, numbers, underscores, and hyphens",
    );
  }

  // Validate transport
  if (!cfg.transport || (cfg.transport !== "stdio" && cfg.transport !== "http")) {
    throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'Transport must be "stdio" or "http"');
  }

  // Validate transport-specific config
  if (cfg.transport === "stdio") {
    if (!cfg.stdio || typeof cfg.stdio !== "object") {
      throw new MCPError(
        MCPErrorCode.INVALID_PARAMS,
        "stdio transport requires stdio configuration",
      );
    }
    const stdio = cfg.stdio as Record<string, unknown>;
    if (!stdio.command || typeof stdio.command !== "string") {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, "stdio.command is required");
    }
  }

  if (cfg.transport === "http") {
    if (!cfg.http || typeof cfg.http !== "object") {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, "http transport requires http configuration");
    }
    const http = cfg.http as Record<string, unknown>;
    if (!http.url || typeof http.url !== "string") {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, "http.url is required");
    }
    try {
      // eslint-disable-next-line no-new
      new URL(http.url as string);
    } catch {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, "http.url must be a valid URL");
    }
  }
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
  return JSON.stringify({ servers, version: "1.0" }, null, 2);
}

// ============================================================================
// Migration
// ============================================================================

export interface MigrateMCPDataOpts {
  /** Old MCP directory (defaults to LEGACY_PATHS.oldMcpDir) */
  oldMcpDir?: string;
  /** New MCP registry file path (defaults to CONFIG_PATHS.mcpRegistry) */
  mcpRegistryPath?: string;
  /** Main coco config file path (defaults to CONFIG_PATHS.config) */
  configPath?: string;
}

/**
 * One-time migration from the old ~/.config/coco/mcp/ layout to the new
 * single-file approach:
 *
 *   ~/.config/coco/mcp/registry.json  →  ~/.coco/mcp.json
 *   ~/.config/coco/mcp/config.json    →  ~/.coco/config.json  (under `mcp` key)
 *
 * Idempotent: skips any file that already exists at the destination.
 * Copy-not-move: old files are preserved.
 * Never throws: all errors are caught and logged as warnings.
 */
export async function migrateMCPData(opts?: MigrateMCPDataOpts): Promise<void> {
  const oldDir = opts?.oldMcpDir ?? LEGACY_PATHS.oldMcpDir;
  const newRegistry = opts?.mcpRegistryPath ?? CONFIG_PATHS.mcpRegistry;
  const newConfig = opts?.configPath ?? CONFIG_PATHS.config;

  try {
    await migrateRegistry(oldDir, newRegistry);
    await migrateGlobalConfig(oldDir, newConfig);
  } catch (error) {
    getLogger().warn(
      `[MCP] Migration failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function migrateRegistry(oldDir: string, newRegistry: string): Promise<void> {
  const oldFile = join(oldDir, "registry.json");

  // Skip if destination already exists — never overwrite user data
  if (await fileExists(newRegistry)) return;

  // Skip if source doesn't exist — nothing to migrate
  if (!(await fileExists(oldFile))) return;

  try {
    const content = await readFile(oldFile, "utf-8");
    const servers = parseRegistry(content);
    await mkdir(dirname(newRegistry), { recursive: true });
    await writeFile(newRegistry, serializeRegistry(servers), "utf-8");
    getLogger().info(
      `[MCP] Migrated registry from ${oldFile} to ${newRegistry}. The old file can be safely deleted.`,
    );
  } catch (error) {
    getLogger().warn(
      `[MCP] Could not migrate registry: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function migrateGlobalConfig(oldDir: string, newConfigPath: string): Promise<void> {
  const oldFile = join(oldDir, "config.json");

  if (!(await fileExists(oldFile))) return;

  try {
    const oldContent = await readFile(oldFile, "utf-8");
    const oldMcpConfig = JSON.parse(oldContent) as Record<string, unknown>;

    // Read existing coco config (or start from empty object)
    let cocoConfig: Record<string, unknown> = {};
    if (await fileExists(newConfigPath)) {
      const existing = await readFile(newConfigPath, "utf-8");
      cocoConfig = JSON.parse(existing) as Record<string, unknown>;
    }

    const existingMcp = (cocoConfig.mcp ?? {}) as Record<string, unknown>;

    // Only copy fields that are not already set in the destination
    const fieldsToMigrate = ["defaultTimeout", "autoDiscover", "logLevel", "customServersPath"];
    let didMerge = false;
    for (const field of fieldsToMigrate) {
      if (oldMcpConfig[field] !== undefined && existingMcp[field] === undefined) {
        existingMcp[field] = oldMcpConfig[field];
        didMerge = true;
      }
    }

    if (!didMerge) return;

    cocoConfig.mcp = existingMcp;
    await mkdir(dirname(newConfigPath), { recursive: true });
    await writeFile(newConfigPath, JSON.stringify(cocoConfig, null, 2), "utf-8");
    getLogger().info(`[MCP] Migrated global MCP settings from ${oldFile} into ${newConfigPath}.`);
  } catch (error) {
    getLogger().warn(
      `[MCP] Could not migrate global MCP config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
