/**
 * Tests for MCP Config Loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadMCPConfigFile,
  mergeMCPConfigs,
  loadMCPServersFromCOCOConfig,
} from './config-loader.js';
import { MCPError } from './errors.js';
import type { MCPServerConfig } from './types.js';

describe('loadMCPConfigFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should load valid config file', async () => {
    const configPath = join(tempDir, 'mcp.json');
    const config = {
      version: '1.0',
      servers: [
        {
          name: 'filesystem',
          transport: 'stdio',
          description: 'Filesystem access',
          stdio: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
          },
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const servers = await loadMCPConfigFile(configPath);

    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('filesystem');
    expect(servers[0]?.transport).toBe('stdio');
    expect(servers[0]?.stdio?.command).toBe('npx');
  });

  it('should load http server config', async () => {
    const configPath = join(tempDir, 'mcp.json');
    const config = {
      servers: [
        {
          name: 'remote-api',
          transport: 'http',
          description: 'Remote API',
          http: {
            url: 'https://api.example.com/mcp',
            auth: {
              type: 'bearer',
              tokenEnv: 'API_TOKEN',
            },
          },
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const servers = await loadMCPConfigFile(configPath);

    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('remote-api');
    expect(servers[0]?.transport).toBe('http');
    expect(servers[0]?.http?.url).toBe('https://api.example.com/mcp');
  });

  it('should throw for missing file', async () => {
    const configPath = join(tempDir, 'nonexistent.json');

    await expect(loadMCPConfigFile(configPath)).rejects.toThrow(MCPError);
  });

  it('should throw for invalid JSON', async () => {
    const configPath = join(tempDir, 'invalid.json');
    await writeFile(configPath, 'not valid json', 'utf-8');

    await expect(loadMCPConfigFile(configPath)).rejects.toThrow(/Invalid JSON/);
  });

  it('should throw for missing servers array', async () => {
    const configPath = join(tempDir, 'invalid.json');
    await writeFile(configPath, JSON.stringify({ version: '1.0' }), 'utf-8');

    await expect(loadMCPConfigFile(configPath)).rejects.toThrow(/servers.*array/);
  });

  it('should skip invalid servers and load valid ones', async () => {
    const configPath = join(tempDir, 'mcp.json');
    const config = {
      servers: [
        {
          name: 'valid-server',
          transport: 'stdio',
          stdio: { command: 'test' },
        },
        {
          name: 'invalid-server',
          transport: 'stdio',
          // Missing stdio.command
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const servers = await loadMCPConfigFile(configPath);

    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('valid-server');
  });

  it('should handle servers with metadata', async () => {
    const configPath = join(tempDir, 'mcp.json');
    const config = {
      servers: [
        {
          name: 'server-with-meta',
          transport: 'stdio',
          stdio: { command: 'test' },
          metadata: {
            customField: 'value',
            numberField: 42,
          },
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const servers = await loadMCPConfigFile(configPath);

    expect(servers[0]?.metadata).toEqual({
      customField: 'value',
      numberField: 42,
    });
  });
});

describe('mergeMCPConfigs', () => {
  it('should merge multiple configs', () => {
    const base: MCPServerConfig[] = [
      { name: 'server1', transport: 'stdio', stdio: { command: 'cmd1' } },
      { name: 'server2', transport: 'stdio', stdio: { command: 'cmd2' } },
    ];

    const override: MCPServerConfig[] = [
      { name: 'server2', transport: 'stdio', stdio: { command: 'cmd2-updated' } },
      { name: 'server3', transport: 'stdio', stdio: { command: 'cmd3' } },
    ];

    const merged = mergeMCPConfigs(base, override);

    expect(merged).toHaveLength(3);
    const server2 = merged.find((s) => s.name === 'server2');
    expect(server2?.stdio?.command).toBe('cmd2-updated');
  });

  it('should handle empty configs', () => {
    const base: MCPServerConfig[] = [
      { name: 'server1', transport: 'stdio', stdio: { command: 'cmd1' } },
    ];

    const merged = mergeMCPConfigs(base);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe('server1');
  });

  it('should override all fields when merging', () => {
    const base: MCPServerConfig[] = [
      {
        name: 'server1',
        transport: 'stdio',
        stdio: { command: 'cmd1', args: ['arg1'] },
        description: 'Original description',
      },
    ];

    const override: MCPServerConfig[] = [
      {
        name: 'server1',
        transport: 'http',
        http: { url: 'https://example.com' },
        description: 'Updated description',
      },
    ];

    const merged = mergeMCPConfigs(base, override);

    expect(merged[0]?.transport).toBe('http');
    expect(merged[0]?.description).toBe('Updated description');
  });
});

describe('loadMCPServersFromCOCOConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coco-mcp-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return empty array when no mcp config', async () => {
    const configPath = join(tempDir, 'coco.config.json');
    const config = {
      project: { name: 'test-project' },
    };

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const servers = await loadMCPServersFromCOCOConfig(configPath);

    expect(servers).toEqual([]);
  });

  it('should load servers from coco config', async () => {
    const projectDir = join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });

    const configPath = join(projectDir, 'coco.config.json');
    const config = {
      project: { name: 'test-project' },
      mcp: {
        enabled: true,
        servers: [
          {
            name: 'filesystem',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
            description: 'Filesystem access',
          },
        ],
      },
    };

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const servers = await loadMCPServersFromCOCOConfig(configPath);

    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('filesystem');
    expect(servers[0]?.transport).toBe('stdio');
  });

  it('should load http servers from coco config', async () => {
    const projectDir = join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });

    const configPath = join(projectDir, 'coco.config.json');
    const config = {
      project: { name: 'test-project' },
      mcp: {
        servers: [
          {
            name: 'remote-api',
            transport: 'http',
            url: 'https://api.example.com/mcp',
            auth: {
              type: 'bearer',
              tokenEnv: 'API_TOKEN',
            },
          },
        ],
      },
    };

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const servers = await loadMCPServersFromCOCOConfig(configPath);

    expect(servers).toHaveLength(1);
    expect(servers[0]?.transport).toBe('http');
    expect(servers[0]?.http?.auth?.type).toBe('bearer');
  });

  it('should skip invalid servers in coco config', async () => {
    const projectDir = join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });

    const configPath = join(projectDir, 'coco.config.json');
    const config = {
      project: { name: 'test-project' },
      mcp: {
        servers: [
          {
            name: 'valid-server',
            transport: 'stdio',
            command: 'test',
          },
          {
            name: 'invalid-server',
            transport: 'stdio',
            // Missing command
          },
        ],
      },
    };

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const servers = await loadMCPServersFromCOCOConfig(configPath);

    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('valid-server');
  });
});
