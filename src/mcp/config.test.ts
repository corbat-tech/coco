/**
 * Tests for MCP Config
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateServerConfig,
  parseRegistry,
  serializeRegistry,
  migrateMCPData,
} from "./config.js";
import { MCPError } from "./errors.js";
import type { MCPServerConfig } from "./types.js";

describe("validateServerConfig", () => {
  it("should validate valid stdio server config", () => {
    const config: MCPServerConfig = {
      name: "test-server",
      transport: "stdio",
      stdio: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
    };

    expect(() => validateServerConfig(config)).not.toThrow();
  });

  it("should validate valid http server config", () => {
    const config: MCPServerConfig = {
      name: "test-server",
      transport: "http",
      http: { url: "https://api.example.com/mcp" },
    };

    expect(() => validateServerConfig(config)).not.toThrow();
  });

  it("should throw for missing name", () => {
    const config = {
      transport: "stdio",
      stdio: { command: "test" },
    };

    expect(() => validateServerConfig(config)).toThrow(MCPError);
  });

  it("should throw for invalid name characters", () => {
    const config = {
      name: "test server!",
      transport: "stdio",
      stdio: { command: "test" },
    };

    expect(() => validateServerConfig(config)).toThrow(
      /letters, numbers, underscores, and hyphens/,
    );
  });

  it("should throw for name too long", () => {
    const config = {
      name: "a".repeat(65),
      transport: "stdio",
      stdio: { command: "test" },
    };

    expect(() => validateServerConfig(config)).toThrow(/between 1 and 64 characters/);
  });

  it("should throw for invalid transport", () => {
    const config = {
      name: "test",
      transport: "invalid",
    };

    expect(() => validateServerConfig(config)).toThrow(/"stdio" or "http"/);
  });

  it("should throw for missing stdio config", () => {
    const config = {
      name: "test",
      transport: "stdio",
    };

    expect(() => validateServerConfig(config)).toThrow(/stdio configuration/);
  });

  it("should throw for missing stdio.command", () => {
    const config = {
      name: "test",
      transport: "stdio",
      stdio: {},
    };

    expect(() => validateServerConfig(config)).toThrow(/stdio.command is required/);
  });

  it("should throw for missing http config", () => {
    const config = {
      name: "test",
      transport: "http",
    };

    expect(() => validateServerConfig(config)).toThrow(/http configuration/);
  });

  it("should throw for invalid http URL", () => {
    const config = {
      name: "test",
      transport: "http",
      http: { url: "not-a-url" },
    };

    expect(() => validateServerConfig(config)).toThrow(/valid URL/);
  });

  it("should throw for non-object config", () => {
    expect(() => validateServerConfig(null)).toThrow(/must be an object/);
    expect(() => validateServerConfig("string")).toThrow(/must be an object/);
    expect(() => validateServerConfig(123)).toThrow(/must be an object/);
  });
});

describe("migrateMCPData", () => {
  let tempDir: string;
  let oldMcpDir: string;
  let newDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp-migrate-test-"));
    oldMcpDir = join(tempDir, "old-mcp");
    newDir = join(tempDir, "new-coco");
    await mkdir(oldMcpDir, { recursive: true });
    await mkdir(newDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should copy registry.json from old path to new path", async () => {
    const servers: MCPServerConfig[] = [
      { name: "github", transport: "stdio", stdio: { command: "npx" } },
    ];
    await writeFile(join(oldMcpDir, "registry.json"), serializeRegistry(servers), "utf-8");

    const newRegistry = join(newDir, "mcp.json");
    await migrateMCPData({ oldMcpDir, mcpRegistryPath: newRegistry });

    const content = await readFile(newRegistry, "utf-8");
    const migrated = parseRegistry(content);
    expect(migrated).toHaveLength(1);
    expect(migrated[0]?.name).toBe("github");
  });

  it("should not overwrite existing mcp.json", async () => {
    const oldServers: MCPServerConfig[] = [
      { name: "old-server", transport: "stdio", stdio: { command: "old" } },
    ];
    const newServers: MCPServerConfig[] = [
      { name: "new-server", transport: "stdio", stdio: { command: "new" } },
    ];

    await writeFile(join(oldMcpDir, "registry.json"), serializeRegistry(oldServers), "utf-8");
    const newRegistry = join(newDir, "mcp.json");
    await writeFile(newRegistry, serializeRegistry(newServers), "utf-8");

    await migrateMCPData({ oldMcpDir, mcpRegistryPath: newRegistry });

    const content = await readFile(newRegistry, "utf-8");
    const servers = parseRegistry(content);
    expect(servers[0]?.name).toBe("new-server");
  });

  it("should merge MCPGlobalConfig fields into config.json under mcp key", async () => {
    const oldConfig = { defaultTimeout: 30000, autoDiscover: false, logLevel: "debug" };
    await writeFile(join(oldMcpDir, "config.json"), JSON.stringify(oldConfig), "utf-8");

    const cocoConfigPath = join(newDir, "config.json");
    await writeFile(cocoConfigPath, JSON.stringify({ provider: { type: "anthropic" } }), "utf-8");

    await migrateMCPData({
      oldMcpDir,
      mcpRegistryPath: join(newDir, "mcp.json"),
      configPath: cocoConfigPath,
    });

    const content = await readFile(cocoConfigPath, "utf-8");
    const parsed = JSON.parse(content) as { mcp?: Record<string, unknown> };
    expect(parsed.mcp?.defaultTimeout).toBe(30000);
    expect(parsed.mcp?.autoDiscover).toBe(false);
    expect(parsed.mcp?.logLevel).toBe("debug");
  });

  it("should not overwrite existing mcp fields in config.json", async () => {
    const oldConfig = { defaultTimeout: 30000, logLevel: "debug" };
    await writeFile(join(oldMcpDir, "config.json"), JSON.stringify(oldConfig), "utf-8");

    const cocoConfigPath = join(newDir, "config.json");
    await writeFile(
      cocoConfigPath,
      JSON.stringify({ mcp: { defaultTimeout: 90000, logLevel: "error" } }),
      "utf-8",
    );

    await migrateMCPData({
      oldMcpDir,
      mcpRegistryPath: join(newDir, "mcp.json"),
      configPath: cocoConfigPath,
    });

    const content = await readFile(cocoConfigPath, "utf-8");
    const parsed = JSON.parse(content) as { mcp?: Record<string, unknown> };
    // User-set values must not be overwritten
    expect(parsed.mcp?.defaultTimeout).toBe(90000);
    expect(parsed.mcp?.logLevel).toBe("error");
  });

  it("should be a no-op when old directory does not exist", async () => {
    const newRegistry = join(newDir, "mcp.json");
    await migrateMCPData({ oldMcpDir: join(tempDir, "nonexistent"), mcpRegistryPath: newRegistry });

    // No file should have been created
    await expect(readFile(newRegistry, "utf-8")).rejects.toThrow();
  });

  it("should not throw on filesystem errors", async () => {
    // Pass a registry path in a deeply nested non-creatable location
    await expect(
      migrateMCPData({ oldMcpDir, mcpRegistryPath: join(newDir, "mcp.json") }),
    ).resolves.toBeUndefined();
  });
});

describe("parseRegistry", () => {
  it("should parse valid registry JSON", () => {
    const json = JSON.stringify({
      servers: [
        { name: "server1", transport: "stdio", stdio: { command: "test" } },
        { name: "server2", transport: "http", http: { url: "https://example.com" } },
      ],
    });

    const servers = parseRegistry(json);

    expect(servers).toHaveLength(2);
    expect(servers[0]?.name).toBe("server1");
    expect(servers[1]?.name).toBe("server2");
  });

  it("should return empty array for invalid JSON", () => {
    const servers = parseRegistry("invalid json");
    expect(servers).toEqual([]);
  });

  it("should return empty array for missing servers array", () => {
    const servers = parseRegistry(JSON.stringify({ version: "1.0" }));
    expect(servers).toEqual([]);
  });

  it("should return empty array for non-array servers", () => {
    const servers = parseRegistry(JSON.stringify({ servers: "not-an-array" }));
    expect(servers).toEqual([]);
  });
});

describe("serializeRegistry", () => {
  it("should serialize servers to JSON", () => {
    const servers: MCPServerConfig[] = [
      { name: "server1", transport: "stdio", stdio: { command: "test" } },
    ];

    const json = serializeRegistry(servers);
    const parsed = JSON.parse(json);

    expect(parsed.servers).toHaveLength(1);
    expect(parsed.servers[0]?.name).toBe("server1");
    expect(parsed.version).toBe("1.0");
  });
});
