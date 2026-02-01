/**
 * Tests for tool registry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("../utils/logger.js", () => ({
  getLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("ToolRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("register", () => {
    it("should register a tool", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      const tool = {
        name: "test_tool",
        description: "A test tool",
        category: "test" as const,
        parameters: z.object({ input: z.string() }),
        execute: vi.fn().mockResolvedValue({ output: "result" }),
      };

      registry.register(tool);

      expect(registry.has("test_tool")).toBe(true);
    });

    it("should warn when overwriting existing tool", async () => {
      const { getLogger } = await import("../utils/logger.js");
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      const tool = {
        name: "duplicate_tool",
        description: "First tool",
        category: "test" as const,
        parameters: z.object({}),
        execute: vi.fn(),
      };

      registry.register(tool);
      registry.register({ ...tool, description: "Second tool" });

      const logger = getLogger();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("already registered")
      );
    });
  });

  describe("unregister", () => {
    it("should unregister a tool", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      const tool = {
        name: "removable_tool",
        description: "Tool to remove",
        category: "test" as const,
        parameters: z.object({}),
        execute: vi.fn(),
      };

      registry.register(tool);
      expect(registry.has("removable_tool")).toBe(true);

      const removed = registry.unregister("removable_tool");

      expect(removed).toBe(true);
      expect(registry.has("removable_tool")).toBe(false);
    });

    it("should return false for non-existing tool", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      const removed = registry.unregister("nonexistent");

      expect(removed).toBe(false);
    });
  });

  describe("get", () => {
    it("should get a registered tool", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      const tool = {
        name: "get_tool",
        description: "Tool to get",
        category: "file" as const,
        parameters: z.object({ path: z.string() }),
        execute: vi.fn(),
      };

      registry.register(tool);
      const retrieved = registry.get("get_tool");

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("get_tool");
    });

    it("should return undefined for non-existing tool", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      const retrieved = registry.get("nonexistent");

      expect(retrieved).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return all registered tools", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      registry.register({
        name: "tool1",
        description: "Tool 1",
        category: "file" as const,
        parameters: z.object({}),
        execute: vi.fn(),
      });
      registry.register({
        name: "tool2",
        description: "Tool 2",
        category: "bash" as const,
        parameters: z.object({}),
        execute: vi.fn(),
      });

      const tools = registry.getAll();

      expect(tools.length).toBe(2);
    });
  });

  describe("getByCategory", () => {
    it("should filter tools by category", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      registry.register({
        name: "file_tool",
        description: "File tool",
        category: "file" as const,
        parameters: z.object({}),
        execute: vi.fn(),
      });
      registry.register({
        name: "bash_tool",
        description: "Bash tool",
        category: "bash" as const,
        parameters: z.object({}),
        execute: vi.fn(),
      });
      registry.register({
        name: "another_file_tool",
        description: "Another file tool",
        category: "file" as const,
        parameters: z.object({}),
        execute: vi.fn(),
      });

      const fileTools = registry.getByCategory("file");

      expect(fileTools.length).toBe(2);
      expect(fileTools.every((t) => t.category === "file")).toBe(true);
    });
  });

  describe("execute", () => {
    it("should execute a tool with valid parameters", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      const executeFn = vi.fn().mockResolvedValue({ result: "success" });

      registry.register({
        name: "exec_tool",
        description: "Executable tool",
        category: "test" as const,
        parameters: z.object({ input: z.string() }),
        execute: executeFn,
      });

      const result = await registry.execute("exec_tool", { input: "test" });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ result: "success" });
      expect(executeFn).toHaveBeenCalledWith({ input: "test" });
    });

    it("should return error for non-existing tool", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      const result = await registry.execute("nonexistent", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return error for invalid parameters", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      registry.register({
        name: "param_tool",
        description: "Tool with params",
        category: "test" as const,
        parameters: z.object({ required: z.string() }),
        execute: vi.fn(),
      });

      const result = await registry.execute("param_tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle tool execution errors", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      registry.register({
        name: "error_tool",
        description: "Tool that throws",
        category: "test" as const,
        parameters: z.object({}),
        execute: vi.fn().mockRejectedValue(new Error("Execution failed")),
      });

      const result = await registry.execute("error_tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Execution failed");
    });

    it("should track execution duration", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      registry.register({
        name: "duration_tool",
        description: "Tool to measure",
        category: "test" as const,
        parameters: z.object({}),
        execute: vi.fn().mockResolvedValue({}),
      });

      const result = await registry.execute("duration_tool", {});

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getToolDefinitionsForLLM", () => {
    it("should return tool definitions in LLM format", async () => {
      const { ToolRegistry } = await import("./registry.js");

      const registry = new ToolRegistry();
      registry.register({
        name: "llm_tool",
        description: "Tool for LLM",
        category: "test" as const,
        parameters: z.object({
          input: z.string().describe("Input value"),
          optional: z.number().optional(),
        }),
        execute: vi.fn(),
      });

      const definitions = registry.getToolDefinitionsForLLM();

      expect(definitions.length).toBe(1);
      expect(definitions[0]).toHaveProperty("name", "llm_tool");
      expect(definitions[0]).toHaveProperty("description", "Tool for LLM");
      expect(definitions[0]).toHaveProperty("input_schema");
    });
  });
});

describe("getToolRegistry", () => {
  it("should return global registry instance", async () => {
    const { getToolRegistry } = await import("./registry.js");

    const registry1 = getToolRegistry();
    const registry2 = getToolRegistry();

    expect(registry1).toBe(registry2);
  });
});

describe("createToolRegistry", () => {
  it("should create a new registry instance", async () => {
    const { createToolRegistry, getToolRegistry } = await import("./registry.js");

    const newRegistry = createToolRegistry();
    const globalRegistry = getToolRegistry();

    expect(newRegistry).not.toBe(globalRegistry);
  });
});

describe("defineTool", () => {
  it("should return the tool definition", async () => {
    const { defineTool } = await import("./registry.js");

    const tool = defineTool({
      name: "defined_tool",
      description: "A defined tool",
      category: "test" as const,
      parameters: z.object({ value: z.string() }),
      execute: async ({ value }) => ({ result: value }),
    });

    expect(tool.name).toBe("defined_tool");
    expect(tool.description).toBe("A defined tool");
    expect(tool.category).toBe("test");
  });
});
