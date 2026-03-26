/**
 * MCP Config File Loader
 *
 * Supports two config formats:
 *
 * 1. Standard format — compatible with Claude Code, Cursor, Windsurf, and most MCP tools.
 *    File: .mcp.json (project root) — loaded automatically at session start
 *    Transport is auto-detected: `command` → stdio, `url` → http/sse.
 *
 *    {
 *      "mcpServers": {
 *        "github": { "command": "npx", "args": [...], "env": {...} },
 *        "vercel": { "url": "https://...", "headers": { "Authorization": "Bearer ..." } }
 *      }
 *    }
 *
 * 2. Coco extended format — for advanced options (explicit transport, auth objects, metadata).
 *    {
 *      "version": "1.0",
 *      "servers": [{ "name": "...", "transport": "stdio", "stdio": {...} }]
 *    }
 */

import { readFile, access } from "node:fs/promises";
import path from "node:path";
import type { MCPServerConfig } from "./types.js";
import { validateServerConfig } from "./config.js";
import { MCPErrorCode } from "./types.js";
import { MCPError } from "./errors.js";
import { getLogger } from "../utils/logger.js";

// ============================================================================
// Standard format (mcpServers) — cross-agent compatible
// ============================================================================

/**
 * Standard mcpServers entry — compatible with Claude Code, Cursor, Windsurf.
 * Transport is auto-detected from the fields present:
 *   command present → stdio
 *   url present     → http (or sse)
 */
interface StandardMCPServerEntry {
  /** stdio: command to execute */
  command?: string;
  /** stdio: command arguments */
  args?: string[];
  /** stdio/http: environment variables */
  env?: Record<string, string>;
  /** http/sse: server URL */
  url?: string;
  /** http: request headers (e.g. Authorization: Bearer ...) */
  headers?: Record<string, string>;
  /** Whether the server is enabled (default: true) */
  enabled?: boolean;
}

interface StandardMCPConfigFile {
  mcpServers: Record<string, StandardMCPServerEntry>;
}

/**
 * Expand `${VAR_NAME}` references in a string using `process.env`.
 * Unknown variables are left as-is (no silent empty-string substitution).
 */
function expandEnvVar(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, name: string) => process.env[name] ?? match);
}

/** Expand env var references in every value of an env object. */
function expandEnvObject(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    result[k] = expandEnvVar(v);
  }
  return result;
}

/** Expand env var references in every value of a headers object. */
function expandHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    result[k] = expandEnvVar(v);
  }
  return result;
}

/**
 * Convert a standard mcpServers entry to MCPServerConfig.
 * Transport is inferred: command → stdio, url → http.
 *
 * `${VAR}` references in `env` and `headers` values are expanded from `process.env`
 * at load time, matching the documented behavior in .mcp.json examples.
 */
function convertStandardEntry(name: string, entry: StandardMCPServerEntry): MCPServerConfig {
  if (entry.command) {
    return {
      name,
      transport: "stdio",
      enabled: entry.enabled ?? true,
      stdio: {
        command: entry.command,
        args: entry.args,
        env: entry.env ? expandEnvObject(entry.env) : undefined,
      },
    };
  }

  if (entry.url) {
    const headers = entry.headers ? expandHeaders(entry.headers) : undefined;
    const authHeader = headers?.["Authorization"] ?? headers?.["authorization"];

    type HttpAuth = NonNullable<NonNullable<MCPServerConfig["http"]>["auth"]>;
    let auth: HttpAuth | undefined;

    if (authHeader) {
      if (authHeader.startsWith("Bearer ")) {
        auth = { type: "bearer", token: authHeader.slice(7) };
      } else {
        auth = { type: "apikey", token: authHeader };
      }
    }

    return {
      name,
      transport: "http",
      enabled: entry.enabled ?? true,
      http: {
        url: entry.url,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
        ...(auth ? { auth } : {}),
      },
    };
  }


  throw new Error(`Server "${name}" must have either "command" (stdio) or "url" (http) defined`);
}

/**
 * Load MCP config from a file, auto-detecting the format.
 *
 * Supports:
 *  - Standard format: { "mcpServers": { ... } }  ← Claude Code / Cursor / Windsurf compatible
 *  - Coco format:     { "servers": [...] }
 */
export async function loadMCPConfigFile(configPath: string): Promise<MCPServerConfig[]> {
  try {
    await access(configPath);
  } catch {
    throw new MCPError(MCPErrorCode.CONNECTION_ERROR, `Config file not found: ${configPath}`);
  }

  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch (error) {
    throw new MCPError(
      MCPErrorCode.CONNECTION_ERROR,
      `Failed to read config file: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new MCPError(MCPErrorCode.PARSE_ERROR, "Invalid JSON in config file");
  }

  const obj = parsed as Record<string, unknown>;

  // Detect format: standard (mcpServers) vs Coco (servers array)
  if (obj.mcpServers && typeof obj.mcpServers === "object" && !Array.isArray(obj.mcpServers)) {
    return loadStandardFormat(obj as unknown as StandardMCPConfigFile, configPath);
  }

  if (obj.servers && Array.isArray(obj.servers)) {
    return loadCocoFormat(obj as unknown as CocoMCPConfigFile, configPath);
  }

  throw new MCPError(
    MCPErrorCode.INVALID_PARAMS,
    'Config file must have either a "mcpServers" object (standard) or a "servers" array (Coco format)',
  );
}

function loadStandardFormat(
  config: StandardMCPConfigFile,
  configPath: string,
): MCPServerConfig[] {
  const validServers: MCPServerConfig[] = [];
  const errors: string[] = [];

  for (const [name, entry] of Object.entries(config.mcpServers)) {
    // Skip comment/metadata keys starting with _
    if (name.startsWith("_")) continue;
    try {
      const converted = convertStandardEntry(name, entry);
      validateServerConfig(converted);
      validServers.push(converted);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Server '${name}': ${message}`);
    }
  }

  if (errors.length > 0) {
    getLogger().warn(`[MCP] Some servers in ${configPath} failed to load: ${errors.join("; ")}`);
  }

  return validServers;
}

/**
 * Load the project-level .mcp.json file (standard cross-agent MCP config).
 *
 * Non-fatal: returns an empty array if the file does not exist or cannot be
 * parsed, so a broken .mcp.json never prevents the REPL from starting.
 */
export async function loadProjectMCPFile(projectPath: string): Promise<MCPServerConfig[]> {
  const mcpJsonPath = path.join(projectPath, ".mcp.json");
  try {
    await access(mcpJsonPath);
  } catch {
    return [];
  }
  try {
    return await loadMCPConfigFile(mcpJsonPath);
  } catch (error) {
    getLogger().warn(
      `[MCP] Failed to load .mcp.json: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

// ============================================================================
// Coco extended format (servers array)
// ============================================================================

/**
 * Coco extended MCP config file format.
 * Supports explicit transport, auth objects, metadata, and other advanced options.
 */
export interface CocoMCPConfigFile {
  /** Config version */
  version?: string;
  /** MCP servers */
  servers: Array<{
    name: string;
    description?: string;
    transport: "stdio" | "http";
    stdio?: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    };
    http?: {
      url: string;
      /** Custom request headers (e.g. { "X-API-Key": "..." }) */
      headers?: Record<string, string>;
      auth?: {
        type: "oauth" | "bearer" | "apikey";
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

/** @deprecated Use CocoMCPConfigFile instead */
export type MCPConfigFile = CocoMCPConfigFile;

function loadCocoFormat(config: CocoMCPConfigFile, configPath: string): MCPServerConfig[] {
  const validServers: MCPServerConfig[] = [];
  const errors: string[] = [];

  for (const server of config.servers) {
    try {
      const converted = convertCocoServerEntry(server);
      validateServerConfig(converted);
      validServers.push(converted);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Server '${server.name || "unknown"}': ${message}`);
    }
  }

  if (errors.length > 0) {
    getLogger().warn(`[MCP] Some servers in ${configPath} failed to load: ${errors.join("; ")}`);
  }

  return validServers;
}

function convertCocoServerEntry(server: CocoMCPConfigFile["servers"][0]): MCPServerConfig {
  const base: MCPServerConfig = {
    name: server.name,
    description: server.description,
    transport: server.transport,
    enabled: server.enabled ?? true,
    metadata: server.metadata,
  };

  if (server.transport === "stdio" && server.stdio) {
    return {
      ...base,
      stdio: {
        command: server.stdio.command,
        args: server.stdio.args,
        env: server.stdio.env ? expandEnvObject(server.stdio.env) : undefined,
        cwd: server.stdio.cwd,
      },
    };
  }

  if (server.transport === "http" && server.http) {
    return {
      ...base,
      http: {
        url: server.http.url,
        ...(server.http.headers ? { headers: expandHeaders(server.http.headers) } : {}),
        ...(server.http.auth ? { auth: server.http.auth } : {}),
        ...(server.http.timeout !== undefined ? { timeout: server.http.timeout } : {}),
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
  configPath?: string,
): Promise<MCPServerConfig[]> {
  const { loadConfig } = await import("../config/loader.js");
  const { MCPServerConfigEntrySchema } = await import("../config/schema.js");

  const config = await loadConfig(configPath);

  if (!config.mcp?.servers || config.mcp.servers.length === 0) {
    return [];
  }

  const servers: MCPServerConfig[] = [];

  for (const entry of config.mcp.servers) {
    try {
      // Validate and parse entry (fills defaults)
      const parsed = MCPServerConfigEntrySchema.parse(entry);

      // Convert to MCPServerConfig
      const serverConfig: MCPServerConfig = {
        name: parsed.name,
        description: parsed.description,
        transport: parsed.transport,
        enabled: parsed.enabled,
        ...(parsed.transport === "stdio" &&
          parsed.command && {
            stdio: {
              command: parsed.command,
              args: parsed.args,
              env: parsed.env ? expandEnvObject(parsed.env) : undefined,
            },
          }),
        ...(parsed.transport === "http" &&
          parsed.url && {
            http: {
              url: parsed.url,
              auth: parsed.auth,
            },
          }),
      };

      validateServerConfig(serverConfig);
      servers.push(serverConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      getLogger().warn(`[MCP] Failed to load server '${entry.name}': ${message}`);
    }
  }

  return servers;
}
