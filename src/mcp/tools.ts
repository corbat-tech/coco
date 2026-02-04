/**
 * MCP Tools Wrapper
 *
 * Converts MCP tools to COCO tool format.
 */

import { z } from 'zod';
import type {
  MCPTool,
  MCPWrappedTool,
  MCPClient,
  MCPToolWrapperOptions,
  MCPCallToolResult,
} from './types.js';
import type { ToolDefinition, ToolCategory } from '../tools/registry.js';
import { MCPError, MCPTimeoutError } from './errors.js';

/**
 * Default wrapper options
 */
const DEFAULT_OPTIONS: Required<MCPToolWrapperOptions> = {
  namePrefix: 'mcp',
  category: 'deploy',
  requestTimeout: 60000,
};

/**
 * Convert JSON schema type to Zod schema
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const type = schema.type as string;

  switch (type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'array':
      if (schema.items) {
        return z.array(jsonSchemaToZod(schema.items as Record<string, unknown>));
      }
      return z.array(z.unknown());
    case 'object': {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = schema.required as string[] | undefined;

      if (!properties) {
        return z.record(z.unknown());
      }

      const shape: Record<string, z.ZodType> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        let fieldSchema = jsonSchemaToZod(propSchema);

        // Make optional if not in required
        if (!required?.includes(key)) {
          fieldSchema = fieldSchema.optional();
        }

        shape[key] = fieldSchema;
      }

      return z.object(shape);
    }
    default:
      return z.unknown();
  }
}

/**
 * Create Zod schema from MCP tool input schema
 */
function createToolParametersSchema(tool: MCPTool): z.ZodSchema {
  const schema = tool.inputSchema;

  if (!schema || schema.type !== 'object') {
    return z.object({});
  }

  return jsonSchemaToZod(schema as Record<string, unknown>);
}

/**
 * Format MCP tool result for COCO
 */
function formatToolResult(result: MCPCallToolResult): string {
  if (result.isError) {
    throw new Error(result.content.map((c) => c.text || '').join('\n'));
  }

  return result.content
    .map((item) => {
      switch (item.type) {
        case 'text':
          return item.text || '';
        case 'image':
          return `[Image: ${item.mimeType || 'unknown'}]`;
        case 'resource':
          return `[Resource: ${item.resource?.uri || 'unknown'}]`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Create prefixed tool name
 */
function createToolName(serverName: string, toolName: string, prefix: string): string {
  return `${prefix}_${serverName}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Wrap a single MCP tool to COCO format
 */
export function wrapMCPTool(
  tool: MCPTool,
  serverName: string,
  client: MCPClient,
  options: MCPToolWrapperOptions = {}
): { tool: ToolDefinition; wrapped: MCPWrappedTool } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const wrappedName = createToolName(serverName, tool.name, opts.namePrefix);

  // Create Zod schema from MCP input schema
  const parametersSchema = createToolParametersSchema(tool);

  // Create COCO tool definition
  const cocoTool: ToolDefinition = {
    name: wrappedName,
    description: tool.description || `MCP tool: ${tool.name}`,
    category: opts.category as ToolCategory,
    parameters: parametersSchema,
    execute: async (params: unknown) => {
      const timeout = opts.requestTimeout;

      try {
        // Call the MCP tool
        const result = await Promise.race([
          client.callTool({
            name: tool.name,
            arguments: params as Record<string, unknown>,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new MCPTimeoutError(`Tool '${tool.name}' timed out after ${timeout}ms`));
            }, timeout);
          }),
        ]);

        return formatToolResult(result);
      } catch (error) {
        if (error instanceof MCPError) {
          throw error;
        }
        throw new MCPError(-32603, `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
  };

  const wrapped: MCPWrappedTool = {
    originalTool: tool,
    serverName,
    wrappedName,
  };

  return { tool: cocoTool, wrapped };
}

/**
 * Wrap multiple MCP tools to COCO format
 */
export function wrapMCPTools(
  tools: MCPTool[],
  serverName: string,
  client: MCPClient,
  options: MCPToolWrapperOptions = {}
): { tools: ToolDefinition[]; wrapped: MCPWrappedTool[] } {
  const cocoTools: ToolDefinition[] = [];
  const wrappedTools: MCPWrappedTool[] = [];

  for (const tool of tools) {
    const { tool: cocoTool, wrapped } = wrapMCPTool(tool, serverName, client, options);
    cocoTools.push(cocoTool);
    wrappedTools.push(wrapped);
  }

  return { tools: cocoTools, wrapped: wrappedTools };
}

/**
 * Create tool definitions from MCP server
 */
export async function createToolsFromMCPServer(
  serverName: string,
  client: MCPClient,
  options: MCPToolWrapperOptions = {}
): Promise<{ tools: ToolDefinition[]; wrapped: MCPWrappedTool[] }> {
  // Initialize client if needed
  if (!client.isConnected()) {
    await client.initialize({
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'coco-mcp-client', version: '0.2.0' },
    });
  }

  // List available tools from MCP server
  const { tools } = await client.listTools();

  // Wrap all tools
  return wrapMCPTools(tools, serverName, client, options);
}

/**
 * Register MCP tools with a COCO tool registry
 */
export async function registerMCPTools(
  registry: { register: (tool: ToolDefinition) => void },
  serverName: string,
  client: MCPClient,
  options: MCPToolWrapperOptions = {}
): Promise<MCPWrappedTool[]> {
  const { tools, wrapped } = await createToolsFromMCPServer(serverName, client, options);

  for (const tool of tools) {
    registry.register(tool);
  }

  return wrapped;
}

/**
 * Get wrapped tool info from registry
 */
export function getMCPToolInfo(wrappedName: string, wrappedTools: MCPWrappedTool[]): MCPWrappedTool | undefined {
  return wrappedTools.find((t) => t.wrappedName === wrappedName);
}

/**
 * Extract original MCP tool name from wrapped name
 */
export function extractOriginalToolName(
  wrappedName: string,
  serverName: string,
  prefix: string = 'mcp'
): string | null {
  const prefix_pattern = `${prefix}_${serverName}_`;
  if (wrappedName.startsWith(prefix_pattern)) {
    return wrappedName.slice(prefix_pattern.length);
  }
  return null;
}
