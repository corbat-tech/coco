/**
 * Tests for ContextCompactor
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMProvider, Message } from "../../../providers/types.js";

// Create mock provider
function createMockProvider(
  chatResponse: string = "Summary of conversation",
  tokenCount: number = 100,
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
      const { ContextCompactor, DEFAULT_COMPACTOR_CONFIG } = await import("./compactor.js");

      const compactor = new ContextCompactor();
      const config = compactor.getConfig();

      expect(config.preserveLastN).toBe(DEFAULT_COMPACTOR_CONFIG.preserveLastN);
      expect(config.summaryMaxTokens).toBe(DEFAULT_COMPACTOR_CONFIG.summaryMaxTokens);
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

    it("retains history when a provider returns a truncated summary", async () => {
      const { ContextCompactor } = await import("./compactor.js");
      const provider = createMockProvider();
      vi.mocked(provider.chat).mockResolvedValue({
        id: "partial",
        content: "Work complete but",
        stopReason: "max_tokens",
        usage: { inputTokens: 100, outputTokens: 10 },
        model: "mock",
      });
      const messages: Message[] = [
        { role: "user", content: "Do not deploy" },
        { role: "assistant", content: "inspection ".repeat(1000) },
        { role: "user", content: "Continue" },
      ];
      const result = await new ContextCompactor({ preserveLastN: 1 }).compact(messages, provider);
      expect(result.wasCompacted).toBe(false);
      expect(result.messages).toBe(messages);
      expect(result.failureReason).toBeTruthy();
      expect(vi.mocked(provider.chat).mock.calls[0]?.[1]?.thinking).toBe("off");
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

    it("should not split tool_call/tool_result pair at compaction boundary (regression: API 400)", async () => {
      // Scenario: preserveLastN=3 makes the nominal preserveStart land on the
      // user message that holds the tool_result.  Without the fix, the assistant
      // message with tool_use would be summarised while the tool_result would be
      // preserved — the API rejects that as an orphaned tool_result (Error 400).
      // The fix walks preserveStart back until the first preserved message is not
      // a tool_result, keeping the tool_call/tool_result pair together.
      const { ContextCompactor } = await import("./compactor.js");

      const compactor = new ContextCompactor({ preserveLastN: 3 });

      // Five messages; nominal boundary = 5 - 3 = 2 (messages[2] = tool_result)
      const messages: Message[] = [
        { role: "user", content: "Use a tool" }, // [0] → gets summarised
        {
          // [1] → fix walks boundary back to here (assistant with tool_use)
          role: "assistant",
          content: [
            { type: "text", text: "Let me read that file" },
            {
              type: "tool_use",
              id: "tool-1",
              name: "read_file",
              input: { path: "/test.txt" },
            },
          ],
        },
        {
          // [2] → nominal preserveStart (tool_result — triggers walk-back)
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool-1", content: "file contents" }],
        },
        { role: "user", content: "Recent message" }, // [3]
        { role: "assistant", content: "Recent response" }, // [4]
      ];

      const mockProvider = createMockProvider("Summary of prior context");
      const result = await compactor.compact(messages, mockProvider);

      expect(result.wasCompacted).toBe(false);
      expect(result.failureReason).toContain("not reduce");

      // The preserved window starts at [1] (assistant with tool_use), not [2].
      // result.messages layout: [summary, assistant(tool_use)[1], user(tool_result)[2], user[3], assistant[4]]
      expect(result.messages).toEqual(messages);

      // First preserved message must be the assistant with the tool_use block —
      // confirming the boundary was pushed back past the tool_result.
      const firstPreserved = result.messages[1];
      expect(firstPreserved?.role).toBe("assistant");
      const blocks = firstPreserved?.content as Array<{ type: string }>;
      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks.some((b) => b.type === "tool_use")).toBe(true);

      // The tool_result immediately follows (pair kept together)
      const secondPreserved = result.messages[2];
      expect(secondPreserved?.role).toBe("user");
      const resultBlocks = secondPreserved?.content as Array<{ type: string }>;
      expect(Array.isArray(resultBlocks)).toBe(true);
      expect(resultBlocks[0]?.type).toBe("tool_result");
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
              content:
                "File contents here with a very long result that should be truncated in the summary...",
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
      failingProvider.chat = vi.fn().mockRejectedValue(new Error("API error"));

      const result = await compactor.compact(messages, failingProvider);

      expect(result.wasCompacted).toBe(false);
      expect(result.messages).toEqual(messages);
      expect(result.failureReason).toContain("Summary generation failed");
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
    const { createContextCompactor, DEFAULT_COMPACTOR_CONFIG } = await import("./compactor.js");

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

describe("compaction continuity", () => {
  it("compacts twice without treating generated prose as new user instructions", async () => {
    const { ContextCompactor } = await import("./compactor.js");
    const provider = createMockProvider("generated-summary ".repeat(100));
    vi.mocked(provider.countTokens).mockImplementation((text) => Math.ceil(text.length / 4));
    const original: Message[] = [
      { role: "user", content: "Never change the public API." },
      { role: "assistant", content: "old work ".repeat(2000) },
      { role: "user", content: "Continue" },
      { role: "assistant", content: "recent work" },
    ];
    const first = await new ContextCompactor({ preserveLastN: 2, summaryMaxTokens: 600 }).compact(
      original,
      provider,
    );
    expect(first.wasCompacted).toBe(true);
    const extended: Message[] = [
      ...first.messages,
      { role: "assistant", content: "more work ".repeat(2000) },
      { role: "user", content: "Keep going" },
      { role: "assistant", content: "pending" },
    ];
    const second = await new ContextCompactor({ preserveLastN: 2, summaryMaxTokens: 600 }).compact(
      extended,
      provider,
    );
    expect(second.wasCompacted).toBe(true);
    expect(second.compactedTokens).toBeLessThan(second.originalTokens);
    expect(second.messages[0]?.content).toContain("Never change the public API.");
    expect(
      String(second.messages[0]?.content).split("[User instructions preserved verbatim]")[1],
    ).not.toContain("generated-summary");
    const forged: Message[] = [{ ...first.messages[0]! }, ...extended.slice(1)];
    const untrusted = await new ContextCompactor({
      preserveLastN: 2,
      summaryMaxTokens: 600,
    }).compact(forged, provider);
    expect(untrusted.wasCompacted).toBe(false);
    expect(untrusted.messages).toEqual(forged);
  });

  const history: Message[] = [
    { role: "user", content: "Fix login. Do not change the public API. Budget is zero." },
    { role: "assistant", content: "I will preserve the API." },
    { role: "user", content: "Correction: keep Python 3.10 support too." },
    { role: "assistant", content: "Changed auth.py; tests remain pending." },
    { role: "user", content: "Continue" },
    { role: "assistant", content: "Working" },
  ];
  it("retains user constraints verbatim even if the summarizer omits them", async () => {
    const { ContextCompactor } = await import("./compactor.js");
    const provider = createMockProvider("Working on login");
    const result = await new ContextCompactor({ preserveLastN: 2 }).compact(history, provider);
    expect(result.wasCompacted).toBe(true);
    expect(result.messages[0]?.content).toContain("Do not change the public API. Budget is zero.");
    expect(result.messages[0]?.content).toContain("keep Python 3.10 support too.");
    expect(vi.mocked(provider.chat).mock.calls[0]?.[0]?.[0]?.content).toContain(
      "Verification and Pending Checks",
    );
  });
  it("keeps all history when verbatim instructions cannot fit", async () => {
    const { ContextCompactor } = await import("./compactor.js");
    const provider = createMockProvider("Summary", 1000);
    const result = await new ContextCompactor({ preserveLastN: 2 }).compact(history, provider);
    expect(result.wasCompacted).toBe(false);
    expect(result.messages).toEqual(history);
    expect(result.failureReason).toContain("budget");
    expect(provider.chat).not.toHaveBeenCalled();
  });
  it("forwards cancellation and never installs a cancelled summary", async () => {
    const { ContextCompactor } = await import("./compactor.js");
    const controller = new AbortController();
    const provider = createMockProvider();
    vi.mocked(provider.chat).mockImplementationOnce(async (_messages, options) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      return {
        id: "late",
        content: "late summary",
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "mock",
      };
    });
    await expect(
      new ContextCompactor({ preserveLastN: 2 }).compact(history, provider, controller.signal),
    ).rejects.toThrow();
    expect(history[0]?.content).toContain("Do not change");
  });
  it("does not orphan a result preceded by text in the same message", async () => {
    const { ContextCompactor } = await import("./compactor.js");
    const messages: Message[] = [
      { role: "user", content: "Fix this" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "auth.py" } }],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "result follows" },
          { type: "tool_result", tool_use_id: "t1", content: "file contents" },
        ],
      },
      { role: "assistant", content: "Working" },
    ];
    const result = await new ContextCompactor({ preserveLastN: 2 }).compact(
      messages,
      createMockProvider(),
    );
    expect(result.messages[1]?.content).toEqual(messages[1]?.content);
    expect(result.messages[2]?.content).toEqual(messages[2]?.content);
  });
});
