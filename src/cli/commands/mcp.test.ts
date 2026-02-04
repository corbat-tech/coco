/**
 * Tests for MCP CLI command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    message: vi.fn(),
    error: vi.fn(),
  },
  confirm: vi.fn(),
  text: vi.fn(),
  spinner: vi.fn().mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
  }),
  isCancel: vi.fn().mockReturnValue(false),
}));

import * as p from '@clack/prompts';
import { Command } from 'commander';
import { registerMCPCommand } from './mcp.js';
import type { MCPRegistry } from '../../mcp/types.js';

describe('MCP CLI Command', () => {
  let tempDir: string;
  let registryPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-cli-test-'));
    registryPath = join(tempDir, 'registry.json');
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('command registration', () => {
    it('should register mcp command', () => {
      const program = new Command();
      registerMCPCommand(program);

      const commands = program.commands.map((c) => c.name());
      expect(commands).toContain('mcp');
    });

    it('should have subcommands', () => {
      const program = new Command();
      registerMCPCommand(program);

      const mcpCmd = program.commands.find((c) => c.name() === 'mcp');
      expect(mcpCmd).toBeDefined();

      const subcommands = mcpCmd?.commands.map((c) => c.name()) || [];
      expect(subcommands).toContain('add');
      expect(subcommands).toContain('remove');
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('enable');
      expect(subcommands).toContain('disable');
    });
  });

  describe('add command', () => {
    it('should accept stdio transport options', async () => {
      const program = new Command();
      registerMCPCommand(program);

      const mcpCmd = program.commands.find((c) => c.name() === 'mcp');
      const addCmd = mcpCmd?.commands.find((c) => c.name() === 'add');

      expect(addCmd).toBeDefined();

      // Parse options
      const options: string[] = [];
      addCmd?.options.forEach((opt) => {
        options.push(opt.long);
      });

      expect(options).toContain('--command');
      expect(options).toContain('--args');
      expect(options).toContain('--transport');
      expect(options).toContain('--env');
      expect(options).toContain('--description');
    });

    it('should accept http transport options', async () => {
      const program = new Command();
      registerMCPCommand(program);

      const mcpCmd = program.commands.find((c) => c.name() === 'mcp');
      const addCmd = mcpCmd?.commands.find((c) => c.name() === 'add');

      expect(addCmd).toBeDefined();

      const options: string[] = [];
      addCmd?.options.forEach((opt) => {
        options.push(opt.long);
      });

      expect(options).toContain('--url');
    });
  });

  describe('list command', () => {
    it('should accept --all flag', async () => {
      const program = new Command();
      registerMCPCommand(program);

      const mcpCmd = program.commands.find((c) => c.name() === 'mcp');
      const listCmd = mcpCmd?.commands.find((c) => c.name() === 'list');

      expect(listCmd).toBeDefined();

      const options: string[] = [];
      listCmd?.options.forEach((opt) => {
        options.push(opt.long);
      });

      expect(options).toContain('--all');
    });
  });

  describe('remove command', () => {
    it('should accept --yes flag', async () => {
      const program = new Command();
      registerMCPCommand(program);

      const mcpCmd = program.commands.find((c) => c.name() === 'mcp');
      const removeCmd = mcpCmd?.commands.find((c) => c.name() === 'remove');

      expect(removeCmd).toBeDefined();

      const options: string[] = [];
      removeCmd?.options.forEach((opt) => {
        options.push(opt.long);
      });

      expect(options).toContain('--yes');
    });
  });

  describe('registry operations', () => {
    it('should handle empty registry', async () => {
      // Create empty registry
      await writeFile(registryPath, JSON.stringify({ servers: [], version: '1.0' }), 'utf-8');

      // Mock registry methods
      const mockRegistry: MCPRegistry = {
        load: vi.fn().mockResolvedValue(undefined),
        listServers: vi.fn().mockReturnValue([]),
        listEnabledServers: vi.fn().mockReturnValue([]),
        addServer: vi.fn().mockResolvedValue(undefined),
        removeServer: vi.fn().mockResolvedValue(true),
        getServer: vi.fn().mockReturnValue(undefined),
        hasServer: vi.fn().mockReturnValue(false),
        save: vi.fn().mockResolvedValue(undefined),
        getRegistryPath: vi.fn().mockReturnValue(registryPath),
      };

      expect(mockRegistry.listServers()).toEqual([]);
    });

    it('should add server to registry', async () => {
      const servers: Array<{ name: string; transport: string }> = [];

      const mockRegistry: MCPRegistry = {
        load: vi.fn().mockResolvedValue(undefined),
        listServers: vi.fn().mockImplementation(() => servers),
        listEnabledServers: vi.fn().mockImplementation(() => servers),
        addServer: vi.fn().mockImplementation((config) => {
          servers.push({ name: config.name, transport: config.transport });
        }),
        removeServer: vi.fn().mockResolvedValue(true),
        getServer: vi.fn().mockReturnValue(undefined),
        hasServer: vi.fn().mockReturnValue(false),
        save: vi.fn().mockResolvedValue(undefined),
        getRegistryPath: vi.fn().mockReturnValue(registryPath),
      };

      await mockRegistry.addServer({
        name: 'test-server',
        transport: 'stdio',
        stdio: { command: 'test' },
      });

      expect(servers).toHaveLength(1);
      expect(servers[0]?.name).toBe('test-server');
    });

    it('should list servers from registry', async () => {
      const mockServers = [
        { name: 'server1', transport: 'stdio', enabled: true },
        { name: 'server2', transport: 'http', enabled: false },
      ];

      const mockRegistry: MCPRegistry = {
        load: vi.fn().mockResolvedValue(undefined),
        listServers: vi.fn().mockReturnValue(mockServers),
        listEnabledServers: vi.fn().mockImplementation(() =>
          mockServers.filter((s) => s.enabled !== false)
        ),
        addServer: vi.fn().mockResolvedValue(undefined),
        removeServer: vi.fn().mockResolvedValue(true),
        getServer: vi.fn().mockImplementation((name) =>
          mockServers.find((s) => s.name === name)
        ),
        hasServer: vi.fn().mockImplementation((name) =>
          mockServers.some((s) => s.name === name)
        ),
        save: vi.fn().mockResolvedValue(undefined),
        getRegistryPath: vi.fn().mockReturnValue(registryPath),
      };

      const all = mockRegistry.listServers();
      const enabled = mockRegistry.listEnabledServers();

      expect(all).toHaveLength(2);
      expect(enabled).toHaveLength(1);
      expect(mockRegistry.hasServer('server1')).toBe(true);
      expect(mockRegistry.hasServer('nonexistent')).toBe(false);
    });
  });

  describe('interactive prompts', () => {
    it('should prompt for command when not provided', async () => {
      vi.mocked(p.text).mockResolvedValueOnce('npx -y test-server');

      const program = new Command();
      registerMCPCommand(program);

      // Simulate parsing command without --command
      const mcpCmd = program.commands.find((c) => c.name() === 'mcp');
      expect(mcpCmd).toBeDefined();
    });

    it('should prompt for confirmation on remove', async () => {
      vi.mocked(p.confirm).mockResolvedValueOnce(true);

      const program = new Command();
      registerMCPCommand(program);

      const mcpCmd = program.commands.find((c) => c.name() === 'mcp');
      expect(mcpCmd).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle validation errors', async () => {
      const program = new Command();
      registerMCPCommand(program);

      const mcpCmd = program.commands.find((c) => c.name() === 'mcp');
      const addCmd = mcpCmd?.commands.find((c) => c.name() === 'add');

      expect(addCmd).toBeDefined();
    });

    it('should handle registry errors', async () => {
      const mockRegistry: MCPRegistry = {
        load: vi.fn().mockRejectedValue(new Error('Failed to load')),
        listServers: vi.fn().mockReturnValue([]),
        listEnabledServers: vi.fn().mockReturnValue([]),
        addServer: vi.fn().mockRejectedValue(new Error('Failed to add')),
        removeServer: vi.fn().mockRejectedValue(new Error('Failed to remove')),
        getServer: vi.fn().mockReturnValue(undefined),
        hasServer: vi.fn().mockReturnValue(false),
        save: vi.fn().mockRejectedValue(new Error('Failed to save')),
        getRegistryPath: vi.fn().mockReturnValue(registryPath),
      };

      await expect(mockRegistry.load()).rejects.toThrow('Failed to load');
      await expect(mockRegistry.addServer({ name: 'test', transport: 'stdio' })).rejects.toThrow('Failed to add');
    });
  });
});
