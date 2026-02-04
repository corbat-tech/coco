/**
 * Tests for ContextCompactor
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMProvider, Message } from "../../../providers/types.js";

// Create mock provider
function createMockProvider(
  chatResponse: string = "Summary of conversation",
  tokenCount: number = 100
): LLMProvider {
  return {
    id: "mock",
    name: "Mock Provider",
    initialize: vi.fn().mockResolvedValue(undefined),
    chat: vi.fn().mockResolvedValue({
      id: "msg-1",
      content: chatResponse,
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "mock-model",
    }),
    chatWithTools: vi.fn(),
    stream: vi.fn(),
    streamWithTools: vi.fn(),
    countTokens: vi.fn().mockReturnValue(tokenCount),
    getContextWindow: vi.fn().mockReturnValue(100000),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

describe("ContextCompactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create with default config", async () => {
      const { ContextCompactor, DEFAULT_COMPACTOR_CONFIG } = await import(
        "./compactor.js"
      );

      const compactor = new ContextCompactor();
      const config = compactor.getConfig();

      expect(config.preserveLastN).toBe(DEFAULT_COMPACTOR_CONFIG.preserveLastN);
      expect(config.summaryMaxTokens).toBe(
        DEFAULT_COMPACTOR_CONFIG.summaryMaxTokens
      );
    });

    it("should create with custom config", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({
        preserveLastN: 6,
        summaryMaxTokens: 2000,
      });

      const config = compactor.getConfig();
      expect(config.preserveLastN).toBe(6);
      expect(config.summaryMaxTokens).toBe(2000);
    });
  });

  describe("compact", () => {
    it("should compact messages when over threshold", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({
        preserveLastN: 2,
      });

      const messages: Message[] = [
        { role: "user", content: "First message" },
        { role: "assistant", content: "First response" },
        { role: "user", content: "Second message" },
        { role: "assistant", content: "Second response" },
        { role: "user", content: "Third message" },
        { role: "assistant", content: "Third response" },
      ];

      const mockProvider = createMockProvider("Conversation summary here");
      const result = await compactor.compact(messages, mockProvider);

      expect(result.wasCompacted).toBe(true);
      // Should have: summary message + 2 preserved messages
      expect(result.messages.length).toBe(3);
      // First message should be the summary
      expect(result.messages[0].content).toContain("Previous conversation summary");
    });

    it("should preserve recent messages", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({
        preserveLastN: 2,
      });

      const messages: Message[] = [
        { role: "user", content: "Old message 1" },
        { role: "assistant", content: "Old response 1" },
        { role: "user", content: "Recent message" },
        { role: "assistant", content: "Recent response" },
      ];

      const mockProvider = createMockProvider();
      const result = await compactor.compact(messages, mockProvider);

      expect(result.wasCompacted).toBe(true);
      // Last 2 messages should be preserved
      const lastTwo = result.messages.slice(-2);
      expect(lastTwo[0].content).toBe("Recent message");
      expect(lastTwo[1].content).toBe("Recent response");
    });

    it("should handle empty message arrays", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor();
      const mockProvider = createMockProvider();

      const result = await compactor.compact([], mockProvider);

      expect(result.wasCompacted).toBe(false);
      expect(result.messages.length).toBe(0);
    });

    it("should not compact when messages are below threshold", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({
        preserveLastN: 4,
      });

      const messages: Message[] = [
        { role: "user", content: "Message 1" },
        { role: "assistant", content: "Response 1" },
      ];

      const mockProvider = createMockProvider();
      const result = await compactor.compact(messages, mockProvider);

      expect(result.wasCompacted).toBe(false);
      expect(result.messages.length).toBe(2);
    });

    it("should preserve system messages", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({
        preserveLastN: 2,
      });

      const messages: Message[] = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Old message" },
        { role: "assistant", content: "Old response" },
        { role: "user", content: "Recent message" },
        { role: "assistant", content: "Recent response" },
      ];

      const mockProvider = createMockProvider();
      const result = await compactor.compact(messages, mockProvider);

      expect(result.wasCompacted).toBe(true);
      // System message should be first
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[0].content).toBe("System prompt");
    });

    it("should handle tool_use content blocks", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({
        preserveLastN: 2,
      });

      const messages: Message[] = [
        { role: "user", content: "Use a tool" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me use a tool" },
            {
              type: "tool_use",
              id: "tool-1",
              name: "read_file",
              input: { path: "/test.txt" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "File contents here with a very long result that should be truncated in the summary...",
            },
          ],
        },
        { role: "user", content: "Recent message" },
        { role: "assistant", content: "Recent response" },
      ];

      const mockProvider = createMockProvider();
      const result = await compactor.compact(messages, mockProvider);

      expect(result.wasCompacted).toBe(true);
      // Should not throw and should include summary
      expect(result.messages[0].content).toContain("summary");
    });

    it("should handle summarization failure gracefully", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({
        preserveLastN: 2,
      });

      const messages: Message[] = [
        { role: "user", content: "Old message 1" },
        { role: "assistant", content: "Old response 1" },
        { role: "user", content: "Old message 2" },
        { role: "assistant", content: "Old response 2" },
        { role: "user", content: "Recent message" },
        { role: "assistant", content: "Recent response" },
      ];

      const failingProvider = createMockProvider();
      failingProvider.chat = vi
        .fn()
        .mockRejectedValue(new Error("API error"));

      const result = await compactor.compact(messages, failingProvider);

      expect(result.wasCompacted).toBe(true);
      // Summary should contain error message
      expect(result.messages[0].content).toContain("Summary generation failed");
    });

    it("should return token estimates", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({
        preserveLastN: 2,
      });

      const messages: Message[] = [
        { role: "user", content: "Old message" },
        { role: "assistant", content: "Old response" },
        { role: "user", content: "Recent message" },
        { role: "assistant", content: "Recent response" },
      ];

      const mockProvider = createMockProvider("Summary", 50);
      const result = await compactor.compact(messages, mockProvider);

      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.compactedTokens).toBeGreaterThan(0);
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({
        preserveLastN: 4,
      });

      compactor.updateConfig({
        preserveLastN: 6,
        summaryMaxTokens: 1500,
      });

      const config = compactor.getConfig();
      expect(config.preserveLastN).toBe(6);
      expect(config.summaryMaxTokens).toBe(1500);
    });
  });

  describe("getConfig", () => {
    it("should return a copy of the config", async () => {
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({
        preserveLastN: 4,
      });

      const config1 = compactor.getConfig();
      config1.preserveLastN = 10; // Modify the returned config

      const config2 = compactor.getConfig();
      expect(config2.preserveLastN).toBe(4); // Original should be unchanged
    });
  });
});

describe("createContextCompactor", () => {
  it("should create compactor with default config", async () => {
    const { createContextCompactor, DEFAULT_COMPACTOR_CONFIG } = await import(
      "./compactor.js"
    );

    const compactor = createContextCompactor();
    const config = compactor.getConfig();

    expect(config.preserveLastN).toBe(DEFAULT_COMPACTOR_CONFIG.preserveLastN);
  });

  it("should create compactor with custom config", async () => {
    const { createContextCompactor } = await import("./compactor.js");

    const compactor = createContextCompactor({
      preserveLastN: 8,
      summaryMaxTokens: 500,
    });

    const config = compactor.getConfig();
    expect(config.preserveLastN).toBe(8);
    expect(config.summaryMaxTokens).toBe(500);
  });
});
