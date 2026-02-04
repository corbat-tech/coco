/**
 * Tests for MCP Tools Wrapper
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  wrapMCPTool,
  wrapMCPTools,
  createToolsFromMCPServer,
  getMCPToolInfo,
  extractOriginalToolName,
} from './tools.js';
import type { MCPTool, MCPClient, MCPCallToolResult } from './types.js';
import type { ToolDefinition, ToolRegistry } from '../tools/registry.js';
import { MCPTimeoutError } from './errors.js';

describe('wrapMCPTool', () => {
  const mockClient: MCPClient = {
    initialize: vi.fn().mockResolvedValue({
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: 'test-server', version: '1.0.0' },
    }),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn(),
    listResources: vi.fn(),
    listPrompts: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should convert mcp tool to coco tool', () => {
    const mcpTool: MCPTool = {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          encoding: { type: 'string' },
        },
        required: ['path'],
      },
    };

    const { tool, wrapped } = wrapMCPTool(mcpTool, 'filesystem', mockClient);

    expect(tool.name).toBe('mcp_filesystem_read_file');
    expect(tool.description).toBe('Read a file');
    expect(tool.category).toBe('deploy');
    expect(wrapped.originalTool).toEqual(mcpTool);
    expect(wrapped.serverName).toBe('filesystem');
    expect(wrapped.wrappedName).toBe('mcp_filesystem_read_file');
  });

  it('should use custom prefix', () => {
    const mcpTool: MCPTool = {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object' },
    };

    const { tool } = wrapMCPTool(mcpTool, 'filesystem', mockClient, {
      namePrefix: 'custom',
    });

    expect(tool.name).toBe('custom_filesystem_read_file');
  });

  it('should use custom category', () => {
    const mcpTool: MCPTool = {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object' },
    };

    const { tool } = wrapMCPTool(mcpTool, 'filesystem', mockClient, {
      category: 'file',
    });

    expect(tool.category).toBe('file');
  });

  it('should handle default description', () => {
    const mcpTool: MCPTool = {
      name: 'read_file',
      inputSchema: { type: 'object' },
    };

    const { tool } = wrapMCPTool(mcpTool, 'filesystem', mockClient);

    expect(tool.description).toBe('MCP tool: read_file');
  });

  it('should execute mcp tool via wrapper', async () => {
    const mcpTool: MCPTool = {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    };

    const mockResult: MCPCallToolResult = {
      content: [{ type: 'text', text: 'file content' }],
    };

    vi.mocked(mockClient.callTool).mockResolvedValue(mockResult);

    const { tool } = wrapMCPTool(mcpTool, 'filesystem', mockClient);
    const result = await tool.execute({ path: '/test.txt' });

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'read_file',
      arguments: { path: '/test.txt' },
    });
    expect(result).toBe('file content');
  });

  it('should handle mcp tool errors', async () => {
    const mcpTool: MCPTool = {
      name: 'read_file',
      inputSchema: { type: 'object' },
    };

    const mockResult: MCPCallToolResult = {
      content: [{ type: 'text', text: 'File not found' }],
      isError: true,
    };

    vi.mocked(mockClient.callTool).mockResolvedValue(mockResult);

    const { tool } = wrapMCPTool(mcpTool, 'filesystem', mockClient);

    await expect(tool.execute({})).rejects.toThrow('File not found');
  });

  it('should handle execution errors', async () => {
    const mcpTool: MCPTool = {
      name: 'read_file',
      inputSchema: { type: 'object' },
    };

    vi.mocked(mockClient.callTool).mockRejectedValue(new Error('Connection failed'));

    const { tool } = wrapMCPTool(mcpTool, 'filesystem', mockClient);

    await expect(tool.execute({})).rejects.toThrow('Tool execution failed');
  });

  it('should timeout on slow execution', async () => {
    const mcpTool: MCPTool = {
      name: 'slow_tool',
      inputSchema: { type: 'object' },
    };

    vi.mocked(mockClient.callTool).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    );

    const { tool } = wrapMCPTool(mcpTool, 'filesystem', mockClient, {
      requestTimeout: 50,
    });

    await expect(tool.execute({})).rejects.toThrow(MCPTimeoutError);
  });

  it('should format image content', async () => {
    const mcpTool: MCPTool = {
      name: 'screenshot',
      inputSchema: { type: 'object' },
    };

    const mockResult: MCPCallToolResult = {
      content: [{ type: 'image', mimeType: 'image/png', data: 'base64data' }],
    };

    vi.mocked(mockClient.callTool).mockResolvedValue(mockResult);

    const { tool } = wrapMCPTool(mcpTool, 'filesystem', mockClient);
    const result = await tool.execute({});

    expect(result).toBe('[Image: image/png]');
  });

  it('should format resource content', async () => {
    const mcpTool: MCPTool = {
      name: 'get_resource',
      inputSchema: { type: 'object' },
    };

    const mockResult: MCPCallToolResult = {
      content: [
        {
          type: 'resource',
          resource: { uri: 'file:///test.txt', name: 'test' },
        },
      ],
    };

    vi.mocked(mockClient.callTool).mockResolvedValue(mockResult);

    const { tool } = wrapMCPTool(mcpTool, 'filesystem', mockClient);
    const result = await tool.execute({});

    expect(result).toBe('[Resource: file:///test.txt]');
  });

  it('should combine multiple content items', async () => {
    const mcpTool: MCPTool = {
      name: 'multi_content',
      inputSchema: { type: 'object' },
    };

    const mockResult: MCPCallToolResult = {
      content: [
        { type: 'text', text: 'Line 1' },
        { type: 'text', text: 'Line 2' },
      ],
    };

    vi.mocked(mockClient.callTool).mockResolvedValue(mockResult);

    const { tool } = wrapMCPTool(mcpTool, 'filesystem', mockClient);
    const result = await tool.execute({});

    expect(result).toBe('Line 1\nLine 2');
  });
});

describe('wrapMCPTools', () => {
  const mockClient: MCPClient = {
    initialize: vi.fn(),
    listTools: vi.fn(),
    callTool: vi.fn(),
    listResources: vi.fn(),
    listPrompts: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  };

  it('should wrap multiple tools', () => {
    const tools: MCPTool[] = [
      { name: 'read_file', inputSchema: { type: 'object' } },
      { name: 'write_file', inputSchema: { type: 'object' } },
    ];

    const { tools: cocoTools, wrapped } = wrapMCPTools(tools, 'filesystem', mockClient);

    expect(cocoTools).toHaveLength(2);
    expect(wrapped).toHaveLength(2);
    expect(cocoTools[0]?.name).toBe('mcp_filesystem_read_file');
    expect(cocoTools[1]?.name).toBe('mcp_filesystem_write_file');
  });
});

describe('createToolsFromMCPServer', () => {
  const mockClient: MCPClient = {
    initialize: vi.fn().mockResolvedValue({
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: 'test-server', version: '1.0.0' },
    }),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        { name: 'read_file', inputSchema: { type: 'object' } },
        { name: 'write_file', inputSchema: { type: 'object' } },
      ],
    }),
    callTool: vi.fn(),
    listResources: vi.fn(),
    listPrompts: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn().mockReturnValue(false),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create tools from mcp server', async () => {
    const { tools, wrapped } = await createToolsFromMCPServer('filesystem', mockClient);

    expect(mockClient.initialize).toHaveBeenCalled();
    expect(mockClient.listTools).toHaveBeenCalled();
    expect(tools).toHaveLength(2);
    expect(wrapped).toHaveLength(2);
  });

  it('should skip initialization if already connected', async () => {
    vi.mocked(mockClient.isConnected).mockReturnValue(true);

    await createToolsFromMCPServer('filesystem', mockClient);

    expect(mockClient.initialize).not.toHaveBeenCalled();
  });
});

describe('getMCPToolInfo', () => {
  it('should find wrapped tool by name', () => {
    const wrappedTools = [
      { originalTool: { name: 'read' } as MCPTool, serverName: 'fs', wrappedName: 'mcp_fs_read' },
      { originalTool: { name: 'write' } as MCPTool, serverName: 'fs', wrappedName: 'mcp_fs_write' },
    ];

    const info = getMCPToolInfo('mcp_fs_write', wrappedTools);

    expect(info?.originalTool.name).toBe('write');
  });

  it('should return undefined for unknown tool', () => {
    const wrappedTools: Array<{ originalTool: MCPTool; serverName: string; wrappedName: string }> = [];

    const info = getMCPToolInfo('unknown', wrappedTools);

    expect(info).toBeUndefined();
  });
});

describe('extractOriginalToolName', () => {
  it('should extract original name from wrapped name', () => {
    const original = extractOriginalToolName('mcp_filesystem_read_file', 'filesystem', 'mcp');

    expect(original).toBe('read_file');
  });

  it('should return null for non-matching name', () => {
    const original = extractOriginalToolName('other_tool', 'filesystem', 'mcp');

    expect(original).toBeNull();
  });

  it('should handle custom prefix', () => {
    const original = extractOriginalToolName('custom_server_tool', 'server', 'custom');

    expect(original).toBe('tool');
  });
});

describe('json schema to zod conversion', () => {
  const mockClient: MCPClient = {
    initialize: vi.fn(),
    listTools: vi.fn(),
    callTool: vi.fn(),
    listResources: vi.fn(),
    listPrompts: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  };

  it('should convert string schema', () => {
    const mcpTool: MCPTool = {
      name: 'test',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      },
    };

    const { tool } = wrapMCPTool(mcpTool, 'server', mockClient);

    // Valid string should pass
    expect(() => tool.parameters.parse({ name: 'test' })).not.toThrow();
    // Number should fail
    expect(() => tool.parameters.parse({ name: 123 })).toThrow();
  });

  it('should convert number schema', () => {
    const mcpTool: MCPTool = {
      name: 'test',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
      },
    };

    const { tool } = wrapMCPTool(mcpTool, 'server', mockClient);

    expect(() => tool.parameters.parse({ count: 42 })).not.toThrow();
    expect(() => tool.parameters.parse({ count: '42' })).toThrow();
  });

  it('should handle required fields', () => {
    const mcpTool: MCPTool = {
      name: 'test',
      inputSchema: {
        type: 'object',
        properties: {
          required: { type: 'string' },
          optional: { type: 'string' },
        },
        required: ['required'],
      },
    };

    const { tool } = wrapMCPTool(mcpTool, 'server', mockClient);

    // Missing required should fail
    expect(() => tool.parameters.parse({})).toThrow();
    // Missing optional should pass
    expect(() => tool.parameters.parse({ required: 'test' })).not.toThrow();
  });

  it('should handle array schema', () => {
    const mcpTool: MCPTool = {
      name: 'test',
      inputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    };

    const { tool } = wrapMCPTool(mcpTool, 'server', mockClient);

    expect(() => tool.parameters.parse({ items: ['a', 'b'] })).not.toThrow();
    expect(() => tool.parameters.parse({ items: [1, 2] })).toThrow();
  });

  it('should handle nested object schema', () => {
    const mcpTool: MCPTool = {
      name: 'test',
      inputSchema: {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
            },
          },
        },
      },
    };

    const { tool } = wrapMCPTool(mcpTool, 'server', mockClient);

    expect(() => tool.parameters.parse({ config: { enabled: true } })).not.toThrow();
    expect(() => tool.parameters.parse({ config: { enabled: 'yes' } })).toThrow();
  });
});
