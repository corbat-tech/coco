/**
 * Tests for MCP Registry
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCPRegistryImpl, createMCPRegistry } from "./registry.js";
import { MCPError } from "./errors.js";
import type { MCPServerConfig } from "./types.js";

describe("MCPRegistryImpl", () => {
  let tempDir: string;
  let registry: MCPRegistryImpl;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp-registry-test-"));
    registry = new MCPRegistryImpl(join(tempDir, "registry.json"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("addServer", () => {
    it("should add server to registry", async () => {
      const config: MCPServerConfig = {
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx", args: ["test"] },
      };

      await registry.addServer(config);

      expect(registry.hasServer("test-server")).toBe(true);
      expect(registry.getServer("test-server")).toEqual(config);
    });

    it("should update existing server", async () => {
      const config1: MCPServerConfig = {
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx", args: ["test"] },
        description: "Original description",
      };

      const config2: MCPServerConfig = {
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx", args: ["test"] },
        description: "Updated description",
      };

      await registry.addServer(config1);
      await registry.addServer(config2);

      const server = registry.getServer("test-server");
      expect(server?.description).toBe("Updated description");
    });

    it("should persist after add", async () => {
      const config: MCPServerConfig = {
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx", args: ["test"] },
      };

      await registry.addServer(config);

      // Create new registry instance pointing to same file
      const registry2 = new MCPRegistryImpl(registry.getRegistryPath());
      await registry2.load();

      expect(registry2.hasServer("test-server")).toBe(true);
    });

    it("should throw for invalid config", async () => {
      const config = {
        name: "invalid name!",
        transport: "stdio",
      } as MCPServerConfig;

      await expect(registry.addServer(config)).rejects.toThrow(MCPError);
    });
  });

  describe("removeServer", () => {
    it("should remove server from registry", async () => {
      const config: MCPServerConfig = {
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx", args: ["test"] },
      };

      await registry.addServer(config);
      const removed = await registry.removeServer("test-server");

      expect(removed).toBe(true);
      expect(registry.hasServer("test-server")).toBe(false);
    });

    it("should return false for non-existent server", async () => {
      const removed = await registry.removeServer("non-existent");
      expect(removed).toBe(false);
    });

    it("should persist after remove", async () => {
      const config: MCPServerConfig = {
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx", args: ["test"] },
      };

      await registry.addServer(config);
      await registry.removeServer("test-server");

      const registry2 = new MCPRegistryImpl(registry.getRegistryPath());
      await registry2.load();

      expect(registry2.hasServer("test-server")).toBe(false);
    });
  });

  describe("getServer", () => {
    it("should return server config", async () => {
      const config: MCPServerConfig = {
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx", args: ["test"] },
      };

      await registry.addServer(config);
      const server = registry.getServer("test-server");

      expect(server).toEqual(config);
    });

    it("should return undefined for non-existent server", () => {
      const server = registry.getServer("non-existent");
      expect(server).toBeUndefined();
    });
  });

  describe("listServers", () => {
    it("should list all servers", async () => {
      const config1: MCPServerConfig = {
        name: "server1",
        transport: "stdio",
        stdio: { command: "test1" },
      };
      const config2: MCPServerConfig = {
        name: "server2",
        transport: "stdio",
        stdio: { command: "test2" },
      };

      await registry.addServer(config1);
      await registry.addServer(config2);

      const servers = registry.listServers();

      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.name)).toContain("server1");
      expect(servers.map((s) => s.name)).toContain("server2");
    });

    it("should return empty array when no servers", () => {
      const servers = registry.listServers();
      expect(servers).toEqual([]);
    });
  });

  describe("listEnabledServers", () => {
    it("should list only enabled servers", async () => {
      const enabled: MCPServerConfig = {
        name: "enabled-server",
        transport: "stdio",
        stdio: { command: "test" },
        enabled: true,
      };
      const disabled: MCPServerConfig = {
        name: "disabled-server",
        transport: "stdio",
        stdio: { command: "test" },
        enabled: false,
      };
      const defaultEnabled: MCPServerConfig = {
        name: "default-server",
        transport: "stdio",
        stdio: { command: "test" },
        // enabled is undefined, defaults to true
      };

      await registry.addServer(enabled);
      await registry.addServer(disabled);
      await registry.addServer(defaultEnabled);

      const servers = registry.listEnabledServers();

      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.name)).toContain("enabled-server");
      expect(servers.map((s) => s.name)).toContain("default-server");
      expect(servers.map((s) => s.name)).not.toContain("disabled-server");
    });
  });

  describe("hasServer", () => {
    it("should return true for existing server", async () => {
      const config: MCPServerConfig = {
        name: "test-server",
        transport: "stdio",
        stdio: { command: "test" },
      };

      await registry.addServer(config);

      expect(registry.hasServer("test-server")).toBe(true);
    });

    it("should return false for non-existent server", () => {
      expect(registry.hasServer("non-existent")).toBe(false);
    });
  });

  describe("save and load", () => {
    it("should save and load registry", async () => {
      const config: MCPServerConfig = {
        name: "test-server",
        transport: "stdio",
        stdio: { command: "npx", args: ["test"] },
        description: "Test server",
        enabled: true,
      };

      await registry.addServer(config);
      await registry.save();

      const registry2 = new MCPRegistryImpl(registry.getRegistryPath());
      await registry2.load();

      const loaded = registry2.getServer("test-server");
      expect(loaded).toEqual(config);
    });

    it("should create file on save", async () => {
      const config: MCPServerConfig = {
        name: "test-server",
        transport: "stdio",
        stdio: { command: "test" },
      };

      await registry.addServer(config);

      const path = registry.getRegistryPath();
      await expect(access(path)).resolves.toBeUndefined();
    });

    it("should start empty when file does not exist", async () => {
      const registry2 = new MCPRegistryImpl(join(tempDir, "nonexistent", "registry.json"));
      await registry2.load();

      expect(registry2.listServers()).toEqual([]);
    });

    it("should skip invalid configs on load", async () => {
      const path = join(tempDir, "registry.json");
      const invalidContent = JSON.stringify({
        servers: [
          { name: "valid", transport: "stdio", stdio: { command: "test" } },
          { name: "invalid" }, // Missing required fields
          { name: "also-valid", transport: "http", http: { url: "https://example.com" } },
        ],
      });

      // Write invalid file manually
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, invalidContent, "utf-8");

      const registry2 = new MCPRegistryImpl(path);
      await registry2.load();

      // Should only have valid servers
      const servers = registry2.listServers();
      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.name)).toContain("valid");
      expect(servers.map((s) => s.name)).toContain("also-valid");
    });
  });

  describe("getRegistryPath", () => {
    it("should return custom path", () => {
      const customPath = "/custom/path/registry.json";
      const customRegistry = new MCPRegistryImpl(customPath);
      expect(customRegistry.getRegistryPath()).toBe(customPath);
    });
  });
});

describe("createMCPRegistry", () => {
  it("should create registry instance", () => {
    const registry = createMCPRegistry("/test/registry.json");

    expect(registry).toBeDefined();
    expect(typeof registry.addServer).toBe("function");
    expect(typeof registry.removeServer).toBe("function");
    expect(typeof registry.listServers).toBe("function");
  });

  it("should use default path when not specified", () => {
    const registry = createMCPRegistry();

    expect(registry.getRegistryPath()).toContain(".config");
    expect(registry.getRegistryPath()).toContain("registry.json");
  });
});
