/**
 * MCP Tools Wrapper
 *
 * Converts MCP tools to COCO tool format.
 */

import { z } from "zod";
import type {
  MCPTool,
  MCPWrappedTool,
  MCPClient,
  MCPToolWrapperOptions,
  MCPCallToolResult,
} from "./types.js";
import type { ToolDefinition, ToolCategory } from "../tools/registry.js";
import { MCPError, MCPTimeoutError } from "./errors.js";

/**
 * Default wrapper options
 */
const DEFAULT_OPTIONS: Required<MCPToolWrapperOptions> = {
  namePrefix: "mcp",
  category: "deploy",
  requestTimeout: 60000,
};

/**
 * Convert JSON schema type to Zod schema
 * Enhanced to support: enum, oneOf, anyOf, allOf, const, nullable,
 * string formats (uri, email, datetime), number constraints (min, max)
 */
export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  // Handle enum at any level
  if (schema.enum && Array.isArray(schema.enum)) {
    const values = schema.enum as [string, ...string[]];
    if (values.length > 0 && values.every((v) => typeof v === "string")) {
      return z.enum(values as [string, ...string[]]);
    }
    // Mixed-type enum: use union of literals
    const literals = values.map((v) => z.literal(v));
    if (literals.length < 2) {
      return literals[0] ?? z.any();
    }
    return z.union(
      literals as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]],
    );
  }

  // Handle const
  if (schema.const !== undefined) {
    return z.literal(schema.const as string | number | boolean);
  }

  // Handle oneOf (union)
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const schemas = (schema.oneOf as Record<string, unknown>[]).map(jsonSchemaToZod);
    if (schemas.length >= 2) {
      return z.union(schemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    }
    return schemas[0] ?? z.unknown();
  }

  // Handle anyOf (union)
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const schemas = (schema.anyOf as Record<string, unknown>[]).map(jsonSchemaToZod);
    if (schemas.length >= 2) {
      return z.union(schemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    }
    return schemas[0] ?? z.unknown();
  }

  // Handle allOf (intersection)
  if (schema.allOf && Array.isArray(schema.allOf)) {
    const schemas = (schema.allOf as Record<string, unknown>[]).map(jsonSchemaToZod);
    return schemas.reduce((acc, s) => z.intersection(acc, s));
  }

  const type = schema.type as string;

  // Handle nullable
  const makeNullable = (s: z.ZodType): z.ZodType => {
    if (schema.nullable === true) return s.nullable();
    return s;
  };

  switch (type) {
    case "string": {
      let s = z.string();
      // String format support
      if (schema.format) {
        switch (schema.format) {
          case "uri":
          case "url":
            s = z.string().url();
            break;
          case "email":
            s = z.string().email();
            break;
          case "date-time":
          case "datetime":
            s = z.string().datetime();
            break;
          // Other formats: keep as plain string
        }
      }
      // String length constraints
      if (typeof schema.minLength === "number") s = s.min(schema.minLength as number);
      if (typeof schema.maxLength === "number") s = s.max(schema.maxLength as number);
      return makeNullable(s);
    }
    case "number": {
      let n = z.number();
      if (typeof schema.minimum === "number") n = n.min(schema.minimum as number);
      if (typeof schema.maximum === "number") n = n.max(schema.maximum as number);
      if (typeof schema.exclusiveMinimum === "number") n = n.gt(schema.exclusiveMinimum as number);
      if (typeof schema.exclusiveMaximum === "number") n = n.lt(schema.exclusiveMaximum as number);
      return makeNullable(n);
    }
    case "integer": {
      let n = z.number().int();
      if (typeof schema.minimum === "number") n = n.min(schema.minimum as number);
      if (typeof schema.maximum === "number") n = n.max(schema.maximum as number);
      return makeNullable(n);
    }
    case "boolean":
      return makeNullable(z.boolean());
    case "null":
      return z.null();
    case "array":
      if (schema.items) {
        const itemSchema = jsonSchemaToZod(schema.items as Record<string, unknown>);
        let arr = z.array(itemSchema);
        if (typeof schema.minItems === "number") arr = arr.min(schema.minItems as number);
        if (typeof schema.maxItems === "number") arr = arr.max(schema.maxItems as number);
        return makeNullable(arr);
      }
      return makeNullable(z.array(z.unknown()));
    case "object": {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = schema.required as string[] | undefined;

      if (!properties) {
        return makeNullable(z.record(z.string(), z.unknown()));
      }

      const shape: Record<string, z.ZodType> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        let fieldSchema = jsonSchemaToZod(propSchema);

        // Make optional if not in required
        if (!required?.includes(key)) {
          fieldSchema = fieldSchema.optional();
        }

        // Add description if present
        if (propSchema.description && typeof propSchema.description === "string") {
          fieldSchema = fieldSchema.describe(propSchema.description);
        }

        shape[key] = fieldSchema;
      }

      return makeNullable(z.object(shape));
    }
    default:
      // If type is an array (e.g., ["string", "null"]), handle as union
      if (Array.isArray(schema.type)) {
        const types = schema.type as string[];
        if (types.includes("null")) {
          const nonNullType = types.find((t) => t !== "null");
          if (nonNullType) {
            return jsonSchemaToZod({ ...schema, type: nonNullType }).nullable();
          }
        }
      }
      return z.unknown();
  }
}

/**
 * Create Zod schema from MCP tool input schema
 */
function createToolParametersSchema(tool: MCPTool): z.ZodSchema {
  const schema = tool.inputSchema;

  if (!schema || schema.type !== "object") {
    return z.object({});
  }

  return jsonSchemaToZod(schema as Record<string, unknown>);
}

/**
 * Format MCP tool result for COCO
 */
function formatToolResult(result: MCPCallToolResult): string {
  if (result.isError) {
    throw new Error(result.content.map((c) => c.text || "").join("\n"));
  }

  return result.content
    .map((item) => {
      switch (item.type) {
        case "text":
          return item.text || "";
        case "image":
          return `[Image: ${item.mimeType || "unknown"}]`;
        case "resource":
          return `[Resource: ${item.resource?.uri || "unknown"}]`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Create prefixed tool name
 */
function createToolName(serverName: string, toolName: string, prefix: string): string {
  return `${prefix}_${serverName}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Wrap a single MCP tool to COCO format
 */
export function wrapMCPTool(
  tool: MCPTool,
  serverName: string,
  client: MCPClient,
  options: MCPToolWrapperOptions = {},
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
        throw new MCPError(
          -32603,
          `Tool execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
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
  options: MCPToolWrapperOptions = {},
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
  options: MCPToolWrapperOptions = {},
): Promise<{ tools: ToolDefinition[]; wrapped: MCPWrappedTool[] }> {
  // Initialize client if needed
  if (!client.isConnected()) {
    await client.initialize({
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "coco-mcp-client", version: "0.2.0" },
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
  options: MCPToolWrapperOptions = {},
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
export function getMCPToolInfo(
  wrappedName: string,
  wrappedTools: MCPWrappedTool[],
): MCPWrappedTool | undefined {
  return wrappedTools.find((t) => t.wrappedName === wrappedName);
}

/**
 * Extract original MCP tool name from wrapped name
 */
export function extractOriginalToolName(
  wrappedName: string,
  serverName: string,
  prefix: string = "mcp",
): string | null {
  const prefix_pattern = `${prefix}_${serverName}_`;
  if (wrappedName.startsWith(prefix_pattern)) {
    return wrappedName.slice(prefix_pattern.length);
  }
  return null;
}
