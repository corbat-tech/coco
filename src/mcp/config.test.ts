/**
 * Tests for MCP Config
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateServerConfig,
  loadMCPConfig,
  saveMCPConfig,
  parseRegistry,
  serializeRegistry,
  DEFAULT_MCP_CONFIG,
} from './config.js';
import { MCPError } from './errors.js';
import type { MCPServerConfig } from './types.js';

describe('validateServerConfig', () => {
  it('should validate valid stdio server config', () => {
    const config: MCPServerConfig = {
      name: 'test-server',
      transport: 'stdio',
      stdio: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    };

    expect(() => validateServerConfig(config)).not.toThrow();
  });

  it('should validate valid http server config', () => {
    const config: MCPServerConfig = {
      name: 'test-server',
      transport: 'http',
      http: { url: 'https://api.example.com/mcp' },
    };

    expect(() => validateServerConfig(config)).not.toThrow();
  });

  it('should throw for missing name', () => {
    const config = {
      transport: 'stdio',
      stdio: { command: 'test' },
    };

    expect(() => validateServerConfig(config)).toThrow(MCPError);
  });

  it('should throw for invalid name characters', () => {
    const config = {
      name: 'test server!',
      transport: 'stdio',
      stdio: { command: 'test' },
    };

    expect(() => validateServerConfig(config)).toThrow(/letters, numbers, underscores, and hyphens/);
  });

  it('should throw for name too long', () => {
    const config = {
      name: 'a'.repeat(65),
      transport: 'stdio',
      stdio: { command: 'test' },
    };

    expect(() => validateServerConfig(config)).toThrow(/between 1 and 64 characters/);
  });

  it('should throw for invalid transport', () => {
    const config = {
      name: 'test',
      transport: 'invalid',
    };

    expect(() => validateServerConfig(config)).toThrow(/"stdio" or "http"/);
  });

  it('should throw for missing stdio config', () => {
    const config = {
      name: 'test',
      transport: 'stdio',
    };

    expect(() => validateServerConfig(config)).toThrow(/stdio configuration/);
  });

  it('should throw for missing stdio.command', () => {
    const config = {
      name: 'test',
      transport: 'stdio',
      stdio: {},
    };

    expect(() => validateServerConfig(config)).toThrow(/stdio.command is required/);
  });

  it('should throw for missing http config', () => {
    const config = {
      name: 'test',
      transport: 'http',
    };

    expect(() => validateServerConfig(config)).toThrow(/http configuration/);
  });

  it('should throw for invalid http URL', () => {
    const config = {
      name: 'test',
      transport: 'http',
      http: { url: 'not-a-url' },
    };

    expect(() => validateServerConfig(config)).toThrow(/valid URL/);
  });

  it('should throw for non-object config', () => {
    expect(() => validateServerConfig(null)).toThrow(/must be an object/);
    expect(() => validateServerConfig('string')).toThrow(/must be an object/);
    expect(() => validateServerConfig(123)).toThrow(/must be an object/);
  });
});

describe('loadMCPConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return default config when file does not exist', async () => {
    const config = await loadMCPConfig(join(tempDir, 'nonexistent.json'));

    expect(config.defaultTimeout).toBe(DEFAULT_MCP_CONFIG.defaultTimeout);
    expect(config.autoDiscover).toBe(DEFAULT_MCP_CONFIG.autoDiscover);
    expect(config.logLevel).toBe(DEFAULT_MCP_CONFIG.logLevel);
  });

  it('should load and merge config from file', async () => {
    const configPath = join(tempDir, 'config.json');
    await writeFile(configPath, JSON.stringify({ logLevel: 'debug', defaultTimeout: 30000 }), 'utf-8');

    const config = await loadMCPConfig(configPath);

    expect(config.logLevel).toBe('debug');
    expect(config.defaultTimeout).toBe(30000);
    expect(config.autoDiscover).toBe(DEFAULT_MCP_CONFIG.autoDiscover);
  });
});

describe('saveMCPConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should save config to file', async () => {
    const configPath = join(tempDir, 'subdir', 'config.json');
    const config = { ...DEFAULT_MCP_CONFIG, logLevel: 'error' as const };

    await saveMCPConfig(config, configPath);

    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.logLevel).toBe('error');
    expect(parsed.defaultTimeout).toBe(DEFAULT_MCP_CONFIG.defaultTimeout);
  });
});

describe('parseRegistry', () => {
  it('should parse valid registry JSON', () => {
    const json = JSON.stringify({
      servers: [
        { name: 'server1', transport: 'stdio', stdio: { command: 'test' } },
        { name: 'server2', transport: 'http', http: { url: 'https://example.com' } },
      ],
    });

    const servers = parseRegistry(json);

    expect(servers).toHaveLength(2);
    expect(servers[0]?.name).toBe('server1');
    expect(servers[1]?.name).toBe('server2');
  });

  it('should return empty array for invalid JSON', () => {
    const servers = parseRegistry('invalid json');
    expect(servers).toEqual([]);
  });

  it('should return empty array for missing servers array', () => {
    const servers = parseRegistry(JSON.stringify({ version: '1.0' }));
    expect(servers).toEqual([]);
  });

  it('should return empty array for non-array servers', () => {
    const servers = parseRegistry(JSON.stringify({ servers: 'not-an-array' }));
    expect(servers).toEqual([]);
  });
});

describe('serializeRegistry', () => {
  it('should serialize servers to JSON', () => {
    const servers: MCPServerConfig[] = [
      { name: 'server1', transport: 'stdio', stdio: { command: 'test' } },
    ];

    const json = serializeRegistry(servers);
    const parsed = JSON.parse(json);

    expect(parsed.servers).toHaveLength(1);
    expect(parsed.servers[0]?.name).toBe('server1');
    expect(parsed.version).toBe('1.0');
  });
});
