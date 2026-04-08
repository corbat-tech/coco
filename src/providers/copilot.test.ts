/**
 * Tests for GitHub Copilot Provider
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the copilot auth module
vi.mock("../auth/copilot.js", () => ({
  getValidCopilotToken: vi.fn(),
}));

// Mock the OpenAI SDK — must use class-like constructor
const mockCreate = vi.fn();
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
      models = {
        list: vi.fn(),
      };
      constructor() {}
    },
  };
});

import { CopilotProvider } from "./copilot.js";
import { getValidCopilotToken } from "../auth/copilot.js";

const mockedGetValidCopilotToken = vi.mocked(getValidCopilotToken);

describe("CopilotProvider", () => {
  let provider: CopilotProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CopilotProvider();
  });

  describe("constructor", () => {
    it("should have correct id and name", () => {
      expect(provider.id).toBe("copilot");
      expect(provider.name).toBe("GitHub Copilot");
    });
  });

  describe("initialize", () => {
    it("should initialize with valid Copilot token", async () => {
      mockedGetValidCopilotToken.mockResolvedValueOnce({
        token: "tid=copilot_123",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false,
      });

      await provider.initialize({ model: "claude-sonnet-4.6" });

      // Provider should be available
      mockedGetValidCopilotToken.mockResolvedValueOnce({
        token: "tid=copilot_123",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false,
      });
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    it("should fallback to apiKey config when no stored token", async () => {
      mockedGetValidCopilotToken.mockResolvedValueOnce(null);

      // Should not throw when apiKey is provided
      await expect(provider.initialize({ apiKey: "direct_token_123" })).resolves.toBeUndefined();
    });

    it("should throw when no token found", async () => {
      mockedGetValidCopilotToken.mockResolvedValueOnce(null);

      await expect(provider.initialize({})).rejects.toThrow("No Copilot token found");
    });

    it("should use custom model from config", async () => {
      mockedGetValidCopilotToken.mockResolvedValueOnce({
        token: "tid=token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false,
      });

      await provider.initialize({ model: "gpt-4o" });

      expect(provider.getContextWindow()).toBe(128000);
    });

    it("should fall back to default model when config model is empty", async () => {
      mockedGetValidCopilotToken.mockResolvedValueOnce({
        token: "tid=token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false,
      });

      await provider.initialize({ model: "   " });

      expect(provider.getContextWindow()).toBe(168000);
    });
  });

  describe("isAvailable", () => {
    it("should return true when token exists", async () => {
      mockedGetValidCopilotToken.mockResolvedValueOnce({
        token: "tid=token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false,
      });

      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });

    it("should return false when no token", async () => {
      mockedGetValidCopilotToken.mockResolvedValueOnce(null);

      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });

    it("should return false on error", async () => {
      mockedGetValidCopilotToken.mockRejectedValueOnce(new Error("network error"));

      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe("getContextWindow", () => {
    it("should return correct window for known models", async () => {
      mockedGetValidCopilotToken.mockResolvedValue({
        token: "tid=token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false,
      });

      const testCases: Array<[string, number]> = [
        ["claude-sonnet-4.6", 168000],
        ["claude-opus-4.6", 168000],
        ["gpt-4.1", 1048576],
        ["gemini-3.1-pro-preview", 1000000],
        ["gemini-2.5-pro", 1048576],
      ];

      for (const [model, expected] of testCases) {
        const p = new CopilotProvider();
        await p.initialize({ model });
        expect(p.getContextWindow()).toBe(expected);
      }
    });

    it("should return default for unknown model", async () => {
      mockedGetValidCopilotToken.mockResolvedValueOnce({
        token: "tid=token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false,
      });

      await provider.initialize({ model: "unknown-model" });
      expect(provider.getContextWindow()).toBe(128000);
    });
  });

  describe("countTokens", () => {
    it("should return 0 for empty text", () => {
      expect(provider.countTokens("")).toBe(0);
    });

    it("should estimate tokens for text", () => {
      const tokens = provider.countTokens("Hello, world!");
      expect(tokens).toBeGreaterThan(0);
      // ~3.5 chars per token: 13 chars / 3.5 ≈ 4
      expect(tokens).toBe(4);
    });
  });

  describe("token refresh", () => {
    it("should refresh token before chat calls", async () => {
      // Initialize with valid token
      mockedGetValidCopilotToken.mockResolvedValueOnce({
        token: "tid=initial_token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false,
      });
      await provider.initialize({});

      // On next call, token refresh returns new token
      mockedGetValidCopilotToken.mockResolvedValueOnce({
        token: "tid=refreshed_token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: true,
      });

      // The chat call itself will fail (mock OpenAI not fully configured)
      // but we verify the refresh was called
      try {
        await provider.chat([{ role: "user", content: "test" }]);
      } catch {
        // Expected — we just care that refresh was called
      }

      // getValidCopilotToken should have been called again (for refresh)
      expect(mockedGetValidCopilotToken).toHaveBeenCalledTimes(2);
    });

    it("should not recreate client when token is still valid", async () => {
      mockedGetValidCopilotToken.mockResolvedValueOnce({
        token: "tid=token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false,
      });
      await provider.initialize({});

      // Refresh returns not-new (still valid)
      mockedGetValidCopilotToken.mockResolvedValueOnce({
        token: "tid=token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false, // Not new — client should not be recreated
      });

      try {
        await provider.chat([{ role: "user", content: "test" }]);
      } catch {
        // Expected
      }

      // Only 2 calls: init + refresh check
      expect(mockedGetValidCopilotToken).toHaveBeenCalledTimes(2);
    });
  });

  describe("extends OpenAIProvider", () => {
    it("should be an instance of CopilotProvider", () => {
      expect(provider).toBeInstanceOf(CopilotProvider);
    });

    it("should have all required LLMProvider methods", () => {
      expect(typeof provider.initialize).toBe("function");
      expect(typeof provider.chat).toBe("function");
      expect(typeof provider.chatWithTools).toBe("function");
      expect(typeof provider.stream).toBe("function");
      expect(typeof provider.streamWithTools).toBe("function");
      expect(typeof provider.countTokens).toBe("function");
      expect(typeof provider.getContextWindow).toBe("function");
      expect(typeof provider.isAvailable).toBe("function");
    });
  });
});
