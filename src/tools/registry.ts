/**
 * Tool Registry for Corbat-Coco
 * Central management of all available tools
 */

import { z } from "zod";
// ToolError reserved for future error handling
import { getLogger } from "../utils/logger.js";

/**
 * Tool definition
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: z.ZodSchema<TInput>;
  execute: (params: TInput) => Promise<TOutput>;
}

/**
 * Tool categories
 */
export type ToolCategory =
  | "file"      // File operations
  | "bash"      // Shell commands
  | "git"       // Version control
  | "test"      // Testing
  | "quality"   // Code quality
  | "build"     // Build tools
  | "deploy";   // Deployment

/**
 * Tool execution result
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}

/**
 * Tool registry
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private logger = getLogger();

  /**
   * Register a tool
   */
  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool '${tool.name}' already registered, overwriting`);
    }
    this.tools.set(tool.name, tool as ToolDefinition);
    this.logger.debug(`Registered tool: ${tool.name}`);
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) {
      this.logger.debug(`Unregistered tool: ${name}`);
    }
    return removed;
  }

  /**
   * Get a tool by name
   */
  get<TInput = unknown, TOutput = unknown>(
    name: string
  ): ToolDefinition<TInput, TOutput> | undefined {
    return this.tools.get(name) as ToolDefinition<TInput, TOutput> | undefined;
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tools
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   */
  getByCategory(category: ToolCategory): ToolDefinition[] {
    return this.getAll().filter((tool) => tool.category === category);
  }

  /**
   * Execute a tool
   */
  async execute<TInput, TOutput>(
    name: string,
    params: TInput
  ): Promise<ToolResult<TOutput>> {
    const startTime = performance.now();
    const tool = this.get<TInput, TOutput>(name);

    if (!tool) {
      return {
        success: false,
        error: `Tool '${name}' not found`,
        duration: performance.now() - startTime,
      };
    }

    try {
      // Validate parameters
      const validatedParams = tool.parameters.parse(params);

      // Execute tool
      this.logger.debug(`Executing tool: ${name}`, { params: validatedParams });
      const result = await tool.execute(validatedParams);

      const duration = performance.now() - startTime;
      this.logger.debug(`Tool '${name}' completed`, { duration: `${duration.toFixed(2)}ms` });

      return {
        success: true,
        data: result,
        duration,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Tool '${name}' failed`, { error: errorMessage, duration });

      return {
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Get tool definitions for LLM (simplified format)
   */
  getToolDefinitionsForLLM(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      // Convert Zod schema to JSON schema
      input_schema: zodToJsonSchema(tool.parameters),
    }));
  }
}

/**
 * Convert Zod schema to JSON schema (simplified)
 */
function zodToJsonSchema(schema: z.ZodSchema): Record<string, unknown> {
  // For now, use a basic conversion
  // In production, use a library like zod-to-json-schema
  try {
    const jsonSchema = (schema as z.ZodObject<z.ZodRawShape>)._def;

    if (jsonSchema.typeName === "ZodObject") {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const fieldSchema = value as z.ZodTypeAny;
        properties[key] = zodFieldToJsonSchema(fieldSchema);

        // Check if required (not optional)
        if (!fieldSchema.isOptional()) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
      };
    }

    return { type: "object" };
  } catch {
    return { type: "object" };
  }
}

/**
 * Convert a Zod field to JSON schema
 */
function zodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  const def = field._def;

  switch (def.typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodArray":
      return {
        type: "array",
        items: zodFieldToJsonSchema(def.type),
      };
    case "ZodOptional":
      return zodFieldToJsonSchema(def.innerType);
    case "ZodDefault":
      return zodFieldToJsonSchema(def.innerType);
    case "ZodEnum":
      return {
        type: "string",
        enum: def.values,
      };
    default:
      return {};
  }
}

/**
 * Global tool registry instance
 */
let globalRegistry: ToolRegistry | null = null;

/**
 * Get the global tool registry
 */
export function getToolRegistry(): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = new ToolRegistry();
  }
  return globalRegistry;
}

/**
 * Create a new tool registry
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}

/**
 * Helper to create a tool definition with type safety
 */
export function defineTool<TInput, TOutput>(
  definition: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return definition;
}
