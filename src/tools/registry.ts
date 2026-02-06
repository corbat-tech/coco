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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: z.ZodType<TInput, any, any>;
  execute: (params: TInput) => Promise<TOutput>;
}

/**
 * Tool categories
 */
export type ToolCategory =
  | "file" // File operations
  | "bash" // Shell commands
  | "git" // Version control
  | "test" // Testing
  | "quality" // Code quality
  | "build" // Build tools
  | "deploy" // Deployment
  | "config" // Configuration & permissions
  | "web" // Web search and fetch
  | "search" // Semantic and code search
  | "memory" // Memory and checkpoint
  | "document"; // Document processing (PDF, images)

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
 * Progress callback for long-running operations
 */
export type ProgressCallback = (progress: ProgressInfo) => void;

/**
 * Progress information
 */
export interface ProgressInfo {
  /** Current step or phase name */
  phase: string;
  /** Progress percentage (0-100), null if indeterminate */
  percent: number | null;
  /** Human-readable message */
  message?: string;
  /** Estimated time remaining in ms, null if unknown */
  estimatedTimeRemaining?: number | null;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for tool execution
 */
export interface ExecuteOptions {
  /** Progress callback for long operations */
  onProgress?: ProgressCallback;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
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
    name: string,
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
    params: TInput,
    options?: ExecuteOptions,
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

    // Check if already aborted
    if (options?.signal?.aborted) {
      return {
        success: false,
        error: "Operation cancelled",
        duration: performance.now() - startTime,
      };
    }

    try {
      // Validate parameters
      const validatedParams = tool.parameters.parse(params);

      // Report progress: starting
      options?.onProgress?.({
        phase: "executing",
        percent: 0,
        message: `Starting ${name}...`,
      });

      // Execute tool
      this.logger.debug(`Executing tool: ${name}`, { params: validatedParams });
      const result = await tool.execute(validatedParams);

      const duration = performance.now() - startTime;
      this.logger.debug(`Tool '${name}' completed`, { duration: `${duration.toFixed(2)}ms` });

      // Report progress: completed
      options?.onProgress?.({
        phase: "completed",
        percent: 100,
        message: `Completed ${name}`,
      });

      return {
        success: true,
        data: result,
        duration,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Tool '${name}' failed`, { error: errorMessage, duration });

      // Report progress: failed
      options?.onProgress?.({
        phase: "failed",
        percent: null,
        message: `Failed: ${errorMessage}`,
      });

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
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
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
  if (field instanceof z.ZodString) return { type: "string" };
  if (field instanceof z.ZodNumber) return { type: "number" };
  if (field instanceof z.ZodBoolean) return { type: "boolean" };
  if (field instanceof z.ZodArray) {
    return { type: "array", items: zodFieldToJsonSchema(field.element as z.ZodTypeAny) };
  }
  if (field instanceof z.ZodOptional) return zodFieldToJsonSchema(field.unwrap() as z.ZodTypeAny);
  if (field instanceof z.ZodDefault)
    return zodFieldToJsonSchema(field.removeDefault() as z.ZodTypeAny);
  if (field instanceof z.ZodEnum) {
    return { type: "string", enum: field.options };
  }
  return {};
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
  definition: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  return definition;
}
