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
        content: [{ type: "text", text: "Mock response" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    },
  })),
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

    it("should throw for openai provider (not implemented)", async () => {
      await expect(ProviderExports.createProvider("openai")).rejects.toThrow(
        "OpenAI provider not yet implemented"
      );
    });

    it("should throw for local provider (not implemented)", async () => {
      await expect(ProviderExports.createProvider("local")).rejects.toThrow(
        "Local provider not yet implemented"
      );
    });

    it("should throw for unknown provider type", async () => {
      // @ts-expect-error Testing invalid provider type
      await expect(ProviderExports.createProvider("unknown")).rejects.toThrow(
        "Unknown provider type"
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

  describe("ProviderType", () => {
    it("should define valid provider types", () => {
      // Test that the type constraints work by using valid values
      const validTypes: ProviderExports.ProviderType[] = ["anthropic", "openai", "local"];
      expect(validTypes).toHaveLength(3);
    });
  });
});
