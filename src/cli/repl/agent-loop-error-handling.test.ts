/**
 * Tests for error handling in agent-loop
 * Ensures the flow never stops even when errors occur
 */
import { describe, it, expect, vi } from "vitest";
import { executeAgentTurn } from "./agent-loop.js";
import type { ReplSession } from "./types.js";
import type { LLMProvider, ToolCall } from "../../providers/types.js";
import type { ToolRegistry } from "../../tools/registry.js";

describe("agent-loop error handling", () => {
  const createMockSession = (): ReplSession =>
    ({
      id: "test-session",
      messages: [],
      projectPath: "/test",
      config: {
        provider: { type: "openai", model: "gpt-4", maxTokens: 4000 },
        ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100 },
        agent: { systemPrompt: "Test", maxToolIterations: 10, confirmDestructive: true },
      },
      trustedTools: new Set(),
      planMode: false,
    }) as ReplSession;

  describe("Provider streaming errors", () => {
    it("should handle AbortError gracefully", async () => {
      const session = createMockSession();
      const mockProvider = {
        streamWithTools: vi.fn().mockImplementation(async function* () {
          const error = new Error("Request was aborted.");
          error.name = "AbortError";
          throw error;
        }),
        countTokens: vi.fn().mockReturnValue(100),
      } as unknown as LLMProvider;

      const mockToolRegistry = {
        getToolDefinitionsForLLM: vi.fn().mockReturnValue([]),
      } as unknown as ToolRegistry;

      const result = await executeAgentTurn(
        session,
        "Test message",
        mockProvider,
        mockToolRegistry,
      );

      expect(result.aborted).toBe(true);
      expect(result.abortReason).toBe("user_cancel");
    });

    it("should handle APIUserAbortError gracefully", async () => {
      const session = createMockSession();
      const mockProvider = {
        streamWithTools: vi.fn().mockImplementation(async function* () {
          const error = new Error("Request was aborted.");
          error.name = "APIUserAbortError";
          throw error;
        }),
        countTokens: vi.fn().mockReturnValue(100),
      } as unknown as LLMProvider;

      const mockToolRegistry = {
        getToolDefinitionsForLLM: vi.fn().mockReturnValue([]),
      } as unknown as ToolRegistry;

      const result = await executeAgentTurn(
        session,
        "Test message",
        mockProvider,
        mockToolRegistry,
      );

      expect(result.aborted).toBe(true);
    });

    it("should handle provider errors with error field in result", async () => {
      const session = createMockSession();
      const mockProvider = {
        streamWithTools: vi.fn().mockImplementation(async function* () {
          throw new Error("Network error: Connection refused");
        }),
        countTokens: vi.fn().mockReturnValue(100),
      } as unknown as LLMProvider;

      const mockToolRegistry = {
        getToolDefinitionsForLLM: vi.fn().mockReturnValue([]),
      } as unknown as ToolRegistry;

      const result = await executeAgentTurn(
        session,
        "Test message",
        mockProvider,
        mockToolRegistry,
      );

      expect(result.aborted).toBe(false);
      expect(result.error).toBe("Network error: Connection refused");
      expect(result.content).toContain("Error");
    });

    it("should preserve partial content when error occurs mid-stream", async () => {
      const session = createMockSession();
      const mockProvider = {
        streamWithTools: vi.fn().mockImplementation(async function* () {
          yield { type: "text", text: "Partial response" };
          throw new Error("Connection lost");
        }),
        countTokens: vi.fn().mockReturnValue(100),
      } as unknown as LLMProvider;

      const mockToolRegistry = {
        getToolDefinitionsForLLM: vi.fn().mockReturnValue([]),
      } as unknown as ToolRegistry;

      const result = await executeAgentTurn(
        session,
        "Test message",
        mockProvider,
        mockToolRegistry,
      );

      expect(result.partialContent).toBe("Partial response");
      expect(result.error).toBe("Connection lost");
    });

    it("should continue processing when a single chunk is malformed", async () => {
      const session = createMockSession();
      const chunks: Array<{ type: string; text?: string; toolCall?: unknown }> = [
        { type: "text", text: "First part" },
        { type: "tool_use_start", toolCall: null }, // Malformed - null toolCall
        { type: "text", text: "Second part" },
        { type: "text", text: "Final part" },
        { type: "done" },
      ];

      const mockProvider = {
        streamWithTools: vi.fn().mockImplementation(async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        }),
        countTokens: vi.fn().mockReturnValue(100),
      } as unknown as LLMProvider;

      const mockToolRegistry = {
        getToolDefinitionsForLLM: vi.fn().mockReturnValue([]),
        execute: vi.fn().mockResolvedValue({ success: true, data: "test", duration: 100 }),
      } as unknown as ToolRegistry;

      const result = await executeAgentTurn(
        session,
        "Test message",
        mockProvider,
        mockToolRegistry,
      );

      // Should complete successfully despite malformed chunks
      expect(result.aborted).toBe(false);
      expect(result.error).toBeUndefined();
      expect(result.content).toBe("First partSecond partFinal part");
    });
  });

  describe("Flow continuity", () => {
    it("should never throw - always return a result", async () => {
      const session = createMockSession();
      const mockProvider = {
        streamWithTools: vi.fn().mockImplementation(async function* () {
          throw new Error("Unexpected catastrophic error");
        }),
        countTokens: vi.fn().mockReturnValue(100),
      } as unknown as LLMProvider;

      const mockToolRegistry = {
        getToolDefinitionsForLLM: vi.fn().mockReturnValue([]),
      } as unknown as ToolRegistry;

      // Should not throw
      const result = await executeAgentTurn(
        session,
        "Test message",
        mockProvider,
        mockToolRegistry,
      );

      // Should return a valid result
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.toolCalls).toBeDefined();
      expect(result.usage).toBeDefined();
    });
  });
});
