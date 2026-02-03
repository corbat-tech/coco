/**
 * Tests for LLM Adapter
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLLMAdapter, type TokenTracker, type TrackingLLMProvider } from "./llm-adapter.js";
import type { PhaseContext } from "../types.js";

/**
 * Create a mock phase context for testing
 */
function createMockContext(overrides: Partial<PhaseContext["llm"]> = {}): PhaseContext {
  const mockLlm: PhaseContext["llm"] = {
    chat: vi.fn().mockResolvedValue({
      content: "Test response",
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
    chatWithTools: vi.fn().mockResolvedValue({
      content: "Tool response",
      usage: { inputTokens: 200, outputTokens: 100 },
      toolCalls: [{ name: "test_tool", arguments: { arg: "value" } }],
    }),
    ...overrides,
  };

  return {
    projectPath: "/test",
    config: {
      quality: {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        convergenceThreshold: 2,
      },
      timeouts: {
        phaseTimeout: 3600000,
        taskTimeout: 600000,
        llmTimeout: 120000,
      },
    },
    state: {
      artifacts: [],
      progress: 0,
      checkpoint: null,
    },
    tools: {} as PhaseContext["tools"],
    llm: mockLlm,
  };
}

describe("createLLMAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic properties", () => {
    it("should create an adapter with correct id and name", () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      expect(adapter.id).toBe("phase-adapter");
      expect(adapter.name).toBe("Phase LLM Adapter");
    });

    it("should have an initialize method that resolves", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      await expect(adapter.initialize()).resolves.toBeUndefined();
    });

    it("should report as always available", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      const available = await adapter.isAvailable();
      expect(available).toBe(true);
    });

    it("should return correct context window size", () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      expect(adapter.getContextWindow()).toBe(200000);
    });

    it("should estimate token count from text length", () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      // Token estimation is length / 4, rounded up
      expect(adapter.countTokens("12345678")).toBe(2);
      expect(adapter.countTokens("1234567")).toBe(2);
      expect(adapter.countTokens("1234")).toBe(1);
      expect(adapter.countTokens("123")).toBe(1);
    });
  });

  describe("chat method", () => {
    it("should call underlying chat method with adapted messages", async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: "Response",
        usage: { inputTokens: 50, outputTokens: 25 },
      });
      const context = createMockContext({ chat: mockChat });
      const adapter = createLLMAdapter(context);

      await adapter.chat([
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ]);

      expect(mockChat).toHaveBeenCalledWith([
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ]);
    });

    it("should convert non-string content to JSON string", async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: "Response",
        usage: { inputTokens: 50, outputTokens: 25 },
      });
      const context = createMockContext({ chat: mockChat });
      const adapter = createLLMAdapter(context);

      await adapter.chat([
        { role: "user", content: { type: "complex", data: [1, 2, 3] } as unknown as string },
      ]);

      expect(mockChat).toHaveBeenCalledWith([
        { role: "user", content: '{"type":"complex","data":[1,2,3]}' },
      ]);
    });

    it("should return properly formatted response", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      const response = await adapter.chat([{ role: "user", content: "Hello" }]);

      expect(response.id).toMatch(/^chat-\d+$/);
      expect(response.content).toBe("Test response");
      expect(response.stopReason).toBe("end_turn");
      expect(response.model).toBe("phase-adapter");
      expect(response.usage.inputTokens).toBe(100);
      expect(response.usage.outputTokens).toBe(50);
    });

    it("should track token usage", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      await adapter.chat([{ role: "user", content: "Hello" }]);

      const usage = adapter.getTokenUsage();
      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(50);
      expect(usage.totalTokens).toBe(150);
      expect(usage.callCount).toBe(1);
    });
  });

  describe("chatWithTools method", () => {
    it("should call underlying chatWithTools method with adapted messages and tools", async () => {
      const mockChatWithTools = vi.fn().mockResolvedValue({
        content: "Tool response",
        usage: { inputTokens: 150, outputTokens: 75 },
        toolCalls: [],
      });
      const context = createMockContext({ chatWithTools: mockChatWithTools });
      const adapter = createLLMAdapter(context);

      const tools = [
        {
          name: "file_read",
          description: "Read a file",
          input_schema: { type: "object", properties: { path: { type: "string" } } },
        },
      ];

      await adapter.chatWithTools(
        [{ role: "user", content: "Read the file" }],
        { tools }
      );

      expect(mockChatWithTools).toHaveBeenCalledWith(
        [{ role: "user", content: "Read the file" }],
        [{ name: "file_read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } }]
      );
    });

    it("should convert non-string content to JSON string in chatWithTools", async () => {
      const mockChatWithTools = vi.fn().mockResolvedValue({
        content: "Response",
        usage: { inputTokens: 50, outputTokens: 25 },
        toolCalls: [],
      });
      const context = createMockContext({ chatWithTools: mockChatWithTools });
      const adapter = createLLMAdapter(context);

      await adapter.chatWithTools(
        [{ role: "user", content: { nested: "object" } as unknown as string }],
        { tools: [] }
      );

      expect(mockChatWithTools).toHaveBeenCalledWith(
        [{ role: "user", content: '{"nested":"object"}' }],
        []
      );
    });

    it("should return properly formatted response with tool calls", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      const response = await adapter.chatWithTools(
        [{ role: "user", content: "Call the tool" }],
        { tools: [{ name: "test", description: "Test", input_schema: {} }] }
      );

      expect(response.id).toMatch(/^chat-\d+$/);
      expect(response.content).toBe("Tool response");
      expect(response.stopReason).toBe("end_turn");
      expect(response.model).toBe("phase-adapter");
      expect(response.usage.inputTokens).toBe(200);
      expect(response.usage.outputTokens).toBe(100);
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]).toEqual({
        id: "test_tool",
        name: "test_tool",
        input: { arg: "value" },
      });
    });

    it("should handle empty tool calls array", async () => {
      const mockChatWithTools = vi.fn().mockResolvedValue({
        content: "No tools needed",
        usage: { inputTokens: 50, outputTokens: 25 },
        toolCalls: [],
      });
      const context = createMockContext({ chatWithTools: mockChatWithTools });
      const adapter = createLLMAdapter(context);

      const response = await adapter.chatWithTools(
        [{ role: "user", content: "Hello" }],
        { tools: [] }
      );

      expect(response.toolCalls).toEqual([]);
    });

    it("should handle undefined tool calls", async () => {
      const mockChatWithTools = vi.fn().mockResolvedValue({
        content: "No tools",
        usage: { inputTokens: 50, outputTokens: 25 },
        // toolCalls is undefined
      });
      const context = createMockContext({ chatWithTools: mockChatWithTools });
      const adapter = createLLMAdapter(context);

      const response = await adapter.chatWithTools(
        [{ role: "user", content: "Hello" }],
        { tools: [] }
      );

      expect(response.toolCalls).toEqual([]);
    });

    it("should track token usage for chatWithTools", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      await adapter.chatWithTools(
        [{ role: "user", content: "Call tool" }],
        { tools: [] }
      );

      const usage = adapter.getTokenUsage();
      expect(usage.inputTokens).toBe(200);
      expect(usage.outputTokens).toBe(100);
      expect(usage.totalTokens).toBe(300);
      expect(usage.callCount).toBe(1);
    });
  });

  describe("stream method", () => {
    it("should yield text and done events", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      const events: Array<{ type: string; text?: string }> = [];

      for await (const event of adapter.stream([{ role: "user", content: "Hello" }])) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text", text: "Test response" });
      expect(events[1]).toEqual({ type: "done" });
    });

    it("should convert non-string content to JSON string in stream", async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: "Streamed response",
        usage: { inputTokens: 30, outputTokens: 15 },
      });
      const context = createMockContext({ chat: mockChat });
      const adapter = createLLMAdapter(context);

      const events: Array<{ type: string; text?: string }> = [];

      for await (const event of adapter.stream([
        { role: "user", content: { streaming: true } as unknown as string },
      ])) {
        events.push(event);
      }

      expect(mockChat).toHaveBeenCalledWith([
        { role: "user", content: '{"streaming":true}' },
      ]);
      expect(events[0]).toEqual({ type: "text", text: "Streamed response" });
    });

    it("should track token usage for stream", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      // Consume the stream
      for await (const _ of adapter.stream([{ role: "user", content: "Hello" }])) {
        // consume events
      }

      const usage = adapter.getTokenUsage();
      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(50);
      expect(usage.totalTokens).toBe(150);
      expect(usage.callCount).toBe(1);
    });
  });

  describe("token tracking", () => {
    it("should accumulate tokens across multiple calls", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      // Make multiple calls
      await adapter.chat([{ role: "user", content: "Hello" }]);
      await adapter.chat([{ role: "user", content: "World" }]);
      await adapter.chatWithTools([{ role: "user", content: "Tool" }], { tools: [] });

      const usage = adapter.getTokenUsage();
      expect(usage.inputTokens).toBe(400); // 100 + 100 + 200
      expect(usage.outputTokens).toBe(200); // 50 + 50 + 100
      expect(usage.totalTokens).toBe(600);
      expect(usage.callCount).toBe(3);
    });

    it("should return a copy of token usage", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      await adapter.chat([{ role: "user", content: "Hello" }]);

      const usage1 = adapter.getTokenUsage();
      const usage2 = adapter.getTokenUsage();

      expect(usage1).toEqual(usage2);
      expect(usage1).not.toBe(usage2); // Should be different objects
    });

    it("should reset token usage", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      // Make a call
      await adapter.chat([{ role: "user", content: "Hello" }]);

      // Verify tokens are tracked
      let usage = adapter.getTokenUsage();
      expect(usage.callCount).toBe(1);
      expect(usage.totalTokens).toBeGreaterThan(0);

      // Reset
      adapter.resetTokenUsage();

      // Verify reset
      usage = adapter.getTokenUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.callCount).toBe(0);
    });

    it("should start with zero token usage", () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      const usage = adapter.getTokenUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.callCount).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle empty messages array", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      const response = await adapter.chat([]);

      expect(response.content).toBe("Test response");
    });

    it("should handle messages with empty content", async () => {
      const context = createMockContext();
      const adapter = createLLMAdapter(context);

      const response = await adapter.chat([{ role: "user", content: "" }]);

      expect(response.content).toBe("Test response");
    });

    it("should handle zero token usage in response", async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: "Free response",
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      const context = createMockContext({ chat: mockChat });
      const adapter = createLLMAdapter(context);

      await adapter.chat([{ role: "user", content: "Hello" }]);

      const usage = adapter.getTokenUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.callCount).toBe(1);
    });
  });
});
