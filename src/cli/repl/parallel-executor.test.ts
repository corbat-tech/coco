/**
 * Tests for ParallelToolExecutor
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolRegistry, ToolResult } from "../../tools/registry.js";
import type { ToolCall } from "../../providers/types.js";
import type { ExecutedToolCall } from "./types.js";

// Mock the registry module
const mockExecute = vi.fn();
const mockRegistry = {
  execute: mockExecute,
} as unknown as ToolRegistry;

describe("ParallelToolExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("executeParallel", () => {
    it("should execute single tool", async () => {
      const { ParallelToolExecutor } = await import("./parallel-executor.js");

      mockExecute.mockResolvedValue({
        success: true,
        data: { result: "success" },
        duration: 100,
      } as ToolResult);

      const executor = new ParallelToolExecutor();
      const toolCalls: ToolCall[] = [
        { id: "call-1", name: "test_tool", input: { param: "value" } },
      ];

      const result = await executor.executeParallel(toolCalls, mockRegistry);

      expect(result.executed.length).toBe(1);
      expect(result.skipped.length).toBe(0);
      expect(result.aborted).toBe(false);
      expect(result.executed[0].id).toBe("call-1");
      expect(result.executed[0].name).toBe("test_tool");
      expect(result.executed[0].result.success).toBe(true);
    });

    it("should execute multiple tools in parallel", async () => {
      const { ParallelToolExecutor } = await import("./parallel-executor.js");

      // Track execution order
      const executionOrder: string[] = [];

      mockExecute.mockImplementation(async (name: string) => {
        executionOrder.push(name);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          success: true,
          data: { tool: name },
          duration: 10,
        } as ToolResult;
      });

      const executor = new ParallelToolExecutor();
      const toolCalls: ToolCall[] = [
        { id: "call-1", name: "tool_a", input: {} },
        { id: "call-2", name: "tool_b", input: {} },
        { id: "call-3", name: "tool_c", input: {} },
      ];

      const result = await executor.executeParallel(toolCalls, mockRegistry, {
        maxConcurrency: 5,
      });

      expect(result.executed.length).toBe(3);
      expect(result.aborted).toBe(false);
      // All tools should have been started (parallel execution)
      expect(executionOrder).toContain("tool_a");
      expect(executionOrder).toContain("tool_b");
      expect(executionOrder).toContain("tool_c");
    });

    it("should respect maxConcurrency limit", async () => {
      const { ParallelToolExecutor } = await import("./parallel-executor.js");

      let activeCount = 0;
      let maxActiveCount = 0;

      mockExecute.mockImplementation(async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 50));
        activeCount--;
        return {
          success: true,
          data: {},
          duration: 50,
        } as ToolResult;
      });

      const executor = new ParallelToolExecutor();
      const toolCalls: ToolCall[] = [
        { id: "call-1", name: "tool_1", input: {} },
        { id: "call-2", name: "tool_2", input: {} },
        { id: "call-3", name: "tool_3", input: {} },
        { id: "call-4", name: "tool_4", input: {} },
        { id: "call-5", name: "tool_5", input: {} },
      ];

      await executor.executeParallel(toolCalls, mockRegistry, {
        maxConcurrency: 2,
      });

      expect(maxActiveCount).toBeLessThanOrEqual(2);
    });

    it("should handle tool failures gracefully", async () => {
      const { ParallelToolExecutor } = await import("./parallel-executor.js");

      mockExecute.mockImplementation(async (name: string) => {
        if (name === "failing_tool") {
          return {
            success: false,
            error: "Tool execution failed",
            duration: 10,
          } as ToolResult;
        }
        return {
          success: true,
          data: { result: "ok" },
          duration: 10,
        } as ToolResult;
      });

      const executor = new ParallelToolExecutor();
      const toolCalls: ToolCall[] = [
        { id: "call-1", name: "working_tool", input: {} },
        { id: "call-2", name: "failing_tool", input: {} },
        { id: "call-3", name: "another_working_tool", input: {} },
      ];

      const result = await executor.executeParallel(toolCalls, mockRegistry);

      expect(result.executed.length).toBe(3);
      expect(result.executed[0].result.success).toBe(true);
      expect(result.executed[1].result.success).toBe(false);
      expect(result.executed[1].result.error).toBe("Tool execution failed");
      expect(result.executed[2].result.success).toBe(true);
    });

    it("should support abort signal", async () => {
      const { ParallelToolExecutor } = await import("./parallel-executor.js");

      mockExecute.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          success: true,
          data: {},
          duration: 100,
        } as ToolResult;
      });

      const executor = new ParallelToolExecutor();
      const controller = new AbortController();
      const toolCalls: ToolCall[] = [
        { id: "call-1", name: "tool_1", input: {} },
        { id: "call-2", name: "tool_2", input: {} },
        { id: "call-3", name: "tool_3", input: {} },
      ];

      // Abort after starting
      setTimeout(() => controller.abort(), 10);

      const result = await executor.executeParallel(toolCalls, mockRegistry, {
        signal: controller.signal,
        maxConcurrency: 1, // Serial execution to test abort between tasks
      });

      expect(result.aborted).toBe(true);
      expect(result.skipped.length).toBeGreaterThan(0);
    });

    it("should call callbacks (onToolStart, onToolEnd)", async () => {
      const { ParallelToolExecutor } = await import("./parallel-executor.js");

      mockExecute.mockResolvedValue({
        success: true,
        data: { result: "success" },
        duration: 10,
      } as ToolResult);

      const onToolStart = vi.fn();
      const onToolEnd = vi.fn();

      const executor = new ParallelToolExecutor();
      const toolCalls: ToolCall[] = [
        { id: "call-1", name: "tool_a", input: {} },
        { id: "call-2", name: "tool_b", input: {} },
      ];

      await executor.executeParallel(toolCalls, mockRegistry, {
        onToolStart,
        onToolEnd,
      });

      expect(onToolStart).toHaveBeenCalledTimes(2);
      expect(onToolEnd).toHaveBeenCalledTimes(2);

      // Check onToolStart was called with correct parameters
      expect(onToolStart).toHaveBeenCalledWith(
        expect.objectContaining({ id: "call-1", name: "tool_a" }),
        1, // 1-based index
        2 // total
      );
      expect(onToolStart).toHaveBeenCalledWith(
        expect.objectContaining({ id: "call-2", name: "tool_b" }),
        2,
        2
      );

      // Check onToolEnd was called with ExecutedToolCall
      expect(onToolEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "call-1",
          name: "tool_a",
          result: expect.objectContaining({ success: true }),
        })
      );
    });

    it("should return results in correct order", async () => {
      const { ParallelToolExecutor } = await import("./parallel-executor.js");

      // Simulate varying execution times
      mockExecute.mockImplementation(async (name: string) => {
        const delays: Record<string, number> = {
          tool_a: 50,
          tool_b: 10, // Fastest
          tool_c: 30,
        };
        await new Promise((resolve) =>
          setTimeout(resolve, delays[name] || 10)
        );
        return {
          success: true,
          data: { tool: name },
          duration: delays[name],
        } as ToolResult;
      });

      const executor = new ParallelToolExecutor();
      const toolCalls: ToolCall[] = [
        { id: "call-1", name: "tool_a", input: {} },
        { id: "call-2", name: "tool_b", input: {} },
        { id: "call-3", name: "tool_c", input: {} },
      ];

      const result = await executor.executeParallel(toolCalls, mockRegistry, {
        maxConcurrency: 5,
      });

      // Results should be in the original order, not execution completion order
      expect(result.executed.length).toBe(3);
      expect(result.executed[0].id).toBe("call-1");
      expect(result.executed[0].name).toBe("tool_a");
      expect(result.executed[1].id).toBe("call-2");
      expect(result.executed[1].name).toBe("tool_b");
      expect(result.executed[2].id).toBe("call-3");
      expect(result.executed[2].name).toBe("tool_c");
    });

    it("should handle empty tool calls array", async () => {
      const { ParallelToolExecutor } = await import("./parallel-executor.js");

      const executor = new ParallelToolExecutor();
      const result = await executor.executeParallel([], mockRegistry);

      expect(result.executed.length).toBe(0);
      expect(result.skipped.length).toBe(0);
      expect(result.aborted).toBe(false);
    });

    it("should skip all tools when already aborted before execution", async () => {
      const { ParallelToolExecutor } = await import("./parallel-executor.js");

      const executor = new ParallelToolExecutor();
      const controller = new AbortController();
      controller.abort(); // Abort before starting

      const onToolSkipped = vi.fn();
      const toolCalls: ToolCall[] = [
        { id: "call-1", name: "tool_a", input: {} },
        { id: "call-2", name: "tool_b", input: {} },
      ];

      const result = await executor.executeParallel(toolCalls, mockRegistry, {
        signal: controller.signal,
        onToolSkipped,
      });

      expect(result.aborted).toBe(true);
      expect(result.executed.length).toBe(0);
      expect(result.skipped.length).toBe(2);
      expect(onToolSkipped).toHaveBeenCalledTimes(2);
    });

    it("should track duration for each tool execution", async () => {
      const { ParallelToolExecutor } = await import("./parallel-executor.js");

      mockExecute.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          success: true,
          data: {},
          duration: 20,
        } as ToolResult;
      });

      const executor = new ParallelToolExecutor();
      const toolCalls: ToolCall[] = [
        { id: "call-1", name: "tool_a", input: {} },
      ];

      const result = await executor.executeParallel(toolCalls, mockRegistry);

      expect(result.executed[0].duration).toBeGreaterThan(0);
    });
  });
});

describe("createParallelExecutor", () => {
  it("should create a new executor instance", async () => {
    const { createParallelExecutor, ParallelToolExecutor } = await import(
      "./parallel-executor.js"
    );

    const executor = createParallelExecutor();

    expect(executor).toBeInstanceOf(ParallelToolExecutor);
  });
});

describe("getParallelExecutor", () => {
  it("should return singleton instance", async () => {
    const { getParallelExecutor } = await import("./parallel-executor.js");

    const executor1 = getParallelExecutor();
    const executor2 = getParallelExecutor();

    expect(executor1).toBe(executor2);
  });
});
