/**
 * Tests for the LLM Intent Classifier
 *
 * Tests:
 * - Classification with cache
 * - Fallback behavior
 * - Confidence scoring
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { LLMProvider, ChatResponse, Message } from "../../../providers/types.js";
import {
  LLMIntentClassifier,
  getLLMClassifier,
  setLLMProvider,
  hasLLMProvider,
} from "./llm-classifier.js";

/**
 * Create a mock LLM provider
 */
function createMockProvider(): LLMProvider {
  return {
    id: "mock",
    name: "Mock Provider",
    initialize: vi.fn().mockResolvedValue(undefined),
    chat: vi.fn(),
    chatWithTools: vi.fn(),
    stream: vi.fn(),
    streamWithTools: vi.fn(),
    countTokens: vi.fn(() => 10),
    getContextWindow: vi.fn(() => 200000),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

describe("LLMIntentClassifier", () => {
  let classifier: LLMIntentClassifier;
  let mockProvider: LLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    classifier = new LLMIntentClassifier(60000); // 1 minute TTL for tests
    mockProvider = createMockProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Provider Configuration", () => {
    it("should start without a provider", () => {
      expect(classifier.hasProvider()).toBe(false);
    });

    it("should set and detect provider", () => {
      classifier.setProvider(mockProvider);
      expect(classifier.hasProvider()).toBe(true);
    });

    it("should return null when no provider is set", async () => {
      const result = await classifier.classify("build the project");
      expect(result).toBeNull();
    });
  });

  describe("Intent Classification", () => {
    beforeEach(() => {
      classifier.setProvider(mockProvider);
    });

    it("should classify plan intent", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "plan", "confidence": 0.95}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("create a plan for the authentication system");

      expect(result).not.toBeNull();
      expect(result?.intent).toBe("plan");
      expect(result?.confidence).toBe(0.95);
      expect(result?.cached).toBe(false);
    });

    it("should classify build intent", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "build", "confidence": 0.9}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("compile and run the project");

      expect(result?.intent).toBe("build");
      expect(result?.confidence).toBe(0.9);
    });

    it("should classify init intent", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "init", "confidence": 0.85}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("start a new project called my-app");

      expect(result?.intent).toBe("init");
      expect(result?.confidence).toBe(0.85);
    });

    it("should classify task intent", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "task", "confidence": 0.88}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("work on task AUTH-123");

      expect(result?.intent).toBe("task");
      expect(result?.confidence).toBe(0.88);
    });

    it("should classify status intent", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "status", "confidence": 0.92}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("show me the current progress");

      expect(result?.intent).toBe("status");
      expect(result?.confidence).toBe(0.92);
    });

    it("should classify help intent", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "help", "confidence": 0.98}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("what commands are available?");

      expect(result?.intent).toBe("help");
      expect(result?.confidence).toBe(0.98);
    });

    it("should classify exit intent", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "exit", "confidence": 0.99}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("goodbye, I'm done for today");

      expect(result?.intent).toBe("exit");
      expect(result?.confidence).toBe(0.99);
    });

    it("should classify chat intent for general conversation", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "chat", "confidence": 0.7}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("what is the meaning of life?");

      expect(result?.intent).toBe("chat");
      expect(result?.confidence).toBe(0.7);
    });

    it("should classify output intent", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "output", "confidence": 0.87}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("generate documentation and CI config");

      expect(result?.intent).toBe("output");
      expect(result?.confidence).toBe(0.87);
    });

    it("should classify trust intent", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "trust", "confidence": 0.91}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("check my trust settings");

      expect(result?.intent).toBe("trust");
      expect(result?.confidence).toBe(0.91);
    });
  });

  describe("Caching", () => {
    beforeEach(() => {
      classifier.setProvider(mockProvider);
    });

    it("should cache classification results", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "build", "confidence": 0.9}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      // First call - hits LLM
      const result1 = await classifier.classify("build the project");
      expect(result1?.cached).toBe(false);
      expect(mockProvider.chat).toHaveBeenCalledTimes(1);

      // Second call - should hit cache
      const result2 = await classifier.classify("build the project");
      expect(result2?.cached).toBe(true);
      expect(mockProvider.chat).toHaveBeenCalledTimes(1); // No additional call
    });

    it("should normalize input for caching", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "build", "confidence": 0.9}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      // First call
      await classifier.classify("Build The Project");

      // These should all hit cache (case-insensitive, whitespace-trimmed)
      const result1 = await classifier.classify("build the project");
      const result2 = await classifier.classify("  BUILD THE PROJECT  ");
      const result3 = await classifier.classify("BUILD the PROJECT");

      expect(result1?.cached).toBe(true);
      expect(result2?.cached).toBe(true);
      expect(result3?.cached).toBe(true);
      expect(mockProvider.chat).toHaveBeenCalledTimes(1);
    });

    it("should expire cache entries after TTL", async () => {
      // Use very short TTL for testing
      const shortTTLClassifier = new LLMIntentClassifier(50); // 50ms TTL
      shortTTLClassifier.setProvider(mockProvider);

      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "build", "confidence": 0.9}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      // First call
      await shortTTLClassifier.classify("build the project");
      expect(mockProvider.chat).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should miss cache and call LLM again
      const result = await shortTTLClassifier.classify("build the project");
      expect(result?.cached).toBe(false);
      expect(mockProvider.chat).toHaveBeenCalledTimes(2);
    });

    it("should clear cache on demand", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "build", "confidence": 0.9}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      // Populate cache
      await classifier.classify("build the project");

      // Clear cache
      classifier.clearCache();

      // Should miss cache
      const result = await classifier.classify("build the project");
      expect(result?.cached).toBe(false);
      expect(mockProvider.chat).toHaveBeenCalledTimes(2);
    });

    it("should report cache statistics", async () => {
      const stats = classifier.getCacheStats();

      expect(stats).toHaveProperty("size");
      expect(stats).toHaveProperty("maxSize");
      expect(stats).toHaveProperty("ttlMs");
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBeGreaterThan(0);
    });

    it("should evict oldest entries when cache is full", async () => {
      // Create classifier with very small cache
      const smallCacheClassifier = new LLMIntentClassifier(60000);
      smallCacheClassifier.setProvider(mockProvider);

      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "chat", "confidence": 0.8}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      // Fill cache with many unique entries
      for (let i = 0; i < 150; i++) {
        await smallCacheClassifier.classify(`unique query ${i}`);
      }

      const stats = smallCacheClassifier.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(stats.maxSize);
    });
  });

  describe("Confidence Scoring", () => {
    beforeEach(() => {
      classifier.setProvider(mockProvider);
    });

    it("should normalize confidence to 0-1 range", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "build", "confidence": 1.5}', // Invalid > 1
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("build project");

      expect(result?.confidence).toBeLessThanOrEqual(1);
    });

    it("should handle negative confidence", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "build", "confidence": -0.5}', // Invalid < 0
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("build project");

      expect(result?.confidence).toBeGreaterThanOrEqual(0);
    });

    it("should use default confidence when not provided", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "build"}', // No confidence
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("build project");

      expect(result?.confidence).toBe(0.5); // Default
    });
  });

  describe("Fallback Behavior", () => {
    beforeEach(() => {
      classifier.setProvider(mockProvider);
    });

    it("should return null for invalid JSON response", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: "This is not valid JSON",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("some query");

      expect(result).toBeNull();
    });

    it("should return null for invalid intent type", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "invalid_intent", "confidence": 0.9}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("some query");

      expect(result).toBeNull();
    });

    it("should return null on LLM error", async () => {
      (mockProvider.chat as Mock).mockRejectedValue(new Error("API error"));

      // Should not throw, just return null
      const result = await classifier.classify("some query");

      expect(result).toBeNull();
    });

    it("should extract JSON from wrapped response", async () => {
      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: 'Based on the input, here is the classification: {"intent": "build", "confidence": 0.9} as requested.',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      const result = await classifier.classify("build the project");

      expect(result?.intent).toBe("build");
      expect(result?.confidence).toBe(0.9);
    });
  });

  describe("Global Classifier", () => {
    it("should provide global classifier instance", () => {
      const classifier1 = getLLMClassifier();
      const classifier2 = getLLMClassifier();

      expect(classifier1).toBe(classifier2);
    });

    it("should set provider via global function", () => {
      expect(hasLLMProvider()).toBe(false);

      setLLMProvider(mockProvider);

      expect(hasLLMProvider()).toBe(true);
    });
  });

  describe("System Prompt", () => {
    it("should use correct system prompt for classification", async () => {
      classifier.setProvider(mockProvider);

      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "build", "confidence": 0.9}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      await classifier.classify("build the project");

      // Verify chat was called with system prompt
      expect(mockProvider.chat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          system: expect.stringContaining("intent classifier"),
          maxTokens: 100,
          temperature: 0,
        })
      );
    });

    it("should include user input in message", async () => {
      classifier.setProvider(mockProvider);

      const mockResponse: ChatResponse = {
        id: "msg-1",
        content: '{"intent": "build", "confidence": 0.9}',
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "claude-sonnet-4-20250514",
      };

      (mockProvider.chat as Mock).mockResolvedValue(mockResponse);

      await classifier.classify("my specific query");

      const [messages] = (mockProvider.chat as Mock).mock.calls[0] as [Message[]];
      expect(messages[0].content).toContain("my specific query");
    });
  });
});
