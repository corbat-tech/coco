/**
 * Tests for error handling in tool registry, specifically for provider abort errors
 */
import { describe, it, expect } from "vitest";
import { ToolRegistry, defineTool } from "./registry.js";
import { z } from "zod";

describe("ToolRegistry error handling", () => {
  describe("Provider abort error handling", () => {
    it("should handle AbortError from provider", async () => {
      const registry = new ToolRegistry();

      // Register a tool that throws an AbortError
      const abortTool = defineTool({
        name: "abort_test",
        description: "Test tool that aborts",
        category: "test",
        parameters: z.object({}),
        execute: async () => {
          const error = new Error("Request was aborted.");
          error.name = "AbortError";
          throw error;
        },
      });

      registry.register(abortTool);

      const result = await registry.execute("abort_test", {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Operation cancelled by user or provider");
    });

    it("should handle APIUserAbortError from provider", async () => {
      const registry = new ToolRegistry();

      // Register a tool that throws an APIUserAbortError
      const abortTool = defineTool({
        name: "api_abort_test",
        description: "Test tool that aborts via API",
        category: "test",
        parameters: z.object({}),
        execute: async () => {
          const error = new Error("Request was aborted.");
          error.name = "APIUserAbortError";
          throw error;
        },
      });

      registry.register(abortTool);

      const result = await registry.execute("api_abort_test", {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Operation cancelled by user or provider");
    });

    it("should handle regular errors normally", async () => {
      const registry = new ToolRegistry();

      // Register a tool that throws a regular error
      const errorTool = defineTool({
        name: "error_test",
        description: "Test tool that errors",
        category: "test",
        parameters: z.object({}),
        execute: async () => {
          throw new Error("Something went wrong");
        },
      });

      registry.register(errorTool);

      const result = await registry.execute("error_test", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Something went wrong");
      expect(result.error).not.toBe("Operation cancelled by user or provider");
    });

    it("should detect abort from signal", async () => {
      const registry = new ToolRegistry();

      // Register a tool that checks signal
      const signalTool = defineTool({
        name: "signal_test",
        description: "Test tool that checks signal",
        category: "test",
        parameters: z.object({}),
        execute: async () => {
          return "completed";
        },
      });

      registry.register(signalTool);

      // Create an already aborted signal
      const controller = new AbortController();
      controller.abort();

      const result = await registry.execute("signal_test", {}, { signal: controller.signal });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Operation cancelled");
    });
  });
});
