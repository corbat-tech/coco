/**
 * Tests for providers module exports
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as ProviderExports from "./index.js";

// Mock Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        id: "msg_123",
        content: [{ type: "text", text: "Mock response" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
        model: "claude-sonnet-4-20250514",
      }),
    },
  })),
}));

// Mock OpenAI SDK
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          id: "chatcmpl_123",
          choices: [
            {
              message: { content: "Mock response", role: "assistant" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
          model: "gpt-4o",
        }),
      },
    },
    models: {
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  })),
}));

// Mock Google Generative AI SDK
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      startChat: vi.fn().mockReturnValue({
        sendMessage: vi.fn().mockResolvedValue({
          response: {
            text: () => "Mock response",
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
          },
        }),
      }),
      generateContent: vi.fn().mockResolvedValue({
        response: { text: () => "Mock response" },
      }),
    }),
  })),
  FunctionCallingMode: {
    AUTO: "AUTO",
    ANY: "ANY",
    NONE: "NONE",
  },
}));

describe("Providers module exports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("type exports", () => {
    it("should export type aliases (checked at compile time)", () => {
      // Type exports are verified at compile time
      // We just verify the module loads successfully
      expect(ProviderExports).toBeDefined();
    });
  });

  describe("AnthropicProvider", () => {
    it("should export AnthropicProvider class", () => {
      expect(ProviderExports.AnthropicProvider).toBeDefined();
    });

    it("should be able to instantiate AnthropicProvider", () => {
      const provider = new ProviderExports.AnthropicProvider();
      expect(provider).toBeInstanceOf(ProviderExports.AnthropicProvider);
    });
  });

  describe("OpenAIProvider", () => {
    it("should export OpenAIProvider class", () => {
      expect(ProviderExports.OpenAIProvider).toBeDefined();
    });

    it("should be able to instantiate OpenAIProvider", () => {
      const provider = new ProviderExports.OpenAIProvider();
      expect(provider).toBeInstanceOf(ProviderExports.OpenAIProvider);
    });
  });

  describe("GeminiProvider", () => {
    it("should export GeminiProvider class", () => {
      expect(ProviderExports.GeminiProvider).toBeDefined();
    });

    it("should be able to instantiate GeminiProvider", () => {
      const provider = new ProviderExports.GeminiProvider();
      expect(provider).toBeInstanceOf(ProviderExports.GeminiProvider);
    });
  });

  describe("createAnthropicProvider", () => {
    it("should export createAnthropicProvider function", () => {
      expect(ProviderExports.createAnthropicProvider).toBeDefined();
      expect(typeof ProviderExports.createAnthropicProvider).toBe("function");
    });

    it("should create an AnthropicProvider instance", () => {
      const provider = ProviderExports.createAnthropicProvider();
      expect(provider).toBeInstanceOf(ProviderExports.AnthropicProvider);
    });
  });

  describe("createProvider", () => {
    it("should export createProvider function", () => {
      expect(ProviderExports.createProvider).toBeDefined();
      expect(typeof ProviderExports.createProvider).toBe("function");
    });

    it("should create anthropic provider", async () => {
      const provider = await ProviderExports.createProvider("anthropic", {
        apiKey: "test-key",
      });

      expect(provider).toBeDefined();
      expect(typeof provider.chat).toBe("function");
    });

    it("should create openai provider", async () => {
      const provider = await ProviderExports.createProvider("openai", {
        apiKey: "test-key",
      });

      expect(provider).toBeDefined();
      expect(typeof provider.chat).toBe("function");
    });

    it("should create gemini provider", async () => {
      const provider = await ProviderExports.createProvider("gemini", {
        apiKey: "test-key",
      });

      expect(provider).toBeDefined();
      expect(typeof provider.chat).toBe("function");
    });

    it("should create kimi provider", async () => {
      const provider = await ProviderExports.createProvider("kimi", {
        apiKey: "test-key",
      });

      expect(provider).toBeDefined();
      expect(typeof provider.chat).toBe("function");
    });

    it("should throw for unknown provider type", async () => {
      // @ts-expect-error Testing invalid provider type
      await expect(ProviderExports.createProvider("unknown")).rejects.toThrow(
        "Unknown provider type",
      );
    });
  });

  describe("getDefaultProvider", () => {
    it("should export getDefaultProvider function", () => {
      expect(ProviderExports.getDefaultProvider).toBeDefined();
      expect(typeof ProviderExports.getDefaultProvider).toBe("function");
    });

    it("should create anthropic provider by default", async () => {
      const provider = await ProviderExports.getDefaultProvider({
        apiKey: "test-key",
      });

      expect(provider).toBeDefined();
      expect(typeof provider.chat).toBe("function");
    });
  });

  describe("listProviders", () => {
    it("should export listProviders function", () => {
      expect(ProviderExports.listProviders).toBeDefined();
      expect(typeof ProviderExports.listProviders).toBe("function");
    });

    it("should return list of providers", () => {
      const providers = ProviderExports.listProviders();
      expect(providers).toHaveLength(5);
      expect(providers.map((p) => p.id)).toEqual([
        "anthropic",
        "openai",
        "codex",
        "gemini",
        "kimi",
      ]);
    });
  });

  describe("ProviderType", () => {
    it("should define valid provider types", () => {
      // Test that the type constraints work by using valid values
      const validTypes: ProviderExports.ProviderType[] = [
        "anthropic",
        "openai",
        "codex",
        "gemini",
        "kimi",
        "lmstudio",
      ];
      expect(validTypes).toHaveLength(6);
    });
  });
});
