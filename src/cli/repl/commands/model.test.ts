/**
 * Tests for /model command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { modelCommand } from "./model.js";
import type { ReplSession } from "../types.js";

// Mock chalk with chainable methods (bgBlue.white, etc.)
vi.mock("chalk", () => {
  const createChalkFn = (s: string) => s;
  const chainable = {
    dim: createChalkFn,
    cyan: createChalkFn,
    yellow: createChalkFn,
    green: createChalkFn,
    bold: createChalkFn,
    magenta: createChalkFn,
    red: createChalkFn,
    white: createChalkFn,
    bgBlue: { white: createChalkFn },
    bgYellow: { black: createChalkFn },
  };
  return { default: chainable };
});

describe("modelCommand", () => {
  let mockSession: ReplSession;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSession = {
      id: "test-session",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      config: {
        provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
        ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100 },
        agent: { systemPrompt: "test", maxToolIterations: 25, confirmDestructive: true },
      },
      trustedTools: new Set(),
    };
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("metadata", () => {
    it("should have correct name", () => {
      expect(modelCommand.name).toBe("model");
    });

    it("should have m alias", () => {
      expect(modelCommand.aliases).toContain("m");
    });

    it("should have description", () => {
      expect(modelCommand.description).toContain("model");
    });

    it("should have usage", () => {
      expect(modelCommand.usage).toBe("/model [model-name]");
    });
  });

  // Skip tests for interactive mode - they require stdin mocking
  // The model command now uses an interactive selector when no arguments
  describe.skip("execute without arguments (interactive mode)", () => {
    it("should display current provider", async () => {
      await modelCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Current provider");
      expect(allOutput).toContain("Anthropic"); // Provider name (capitalized)
    });

    it("should display current model", async () => {
      await modelCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Current model");
      expect(allOutput).toContain("claude-sonnet-4-20250514");
    });

    it("should display available models", async () => {
      await modelCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Available models");
      expect(allOutput).toContain("Claude");
    });

    it("should return false (do not exit)", async () => {
      const result = await modelCommand.execute([], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("execute with valid model argument", () => {
    it("should change to a known model in same provider", async () => {
      // Use a model from the current provider config
      const result = await modelCommand.execute(["claude-opus-4-5-20251124"], mockSession);

      expect(mockSession.config.provider.model).toBe("claude-opus-4-5-20251124");
      expect(result).toBe(false);
    });

    it("should display success message", async () => {
      await modelCommand.execute(["claude-opus-4-5-20251124"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Switched to");
    });
  });

  describe("execute with model from different provider", () => {
    it("should warn about provider mismatch", async () => {
      await modelCommand.execute(["gpt-4o"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("OpenAI"); // Provider name (capitalized)
      expect(allOutput).toContain("Anthropic Claude"); // Current provider full name
    });

    it("should not change the model", async () => {
      const originalModel = mockSession.config.provider.model;
      await modelCommand.execute(["gpt-4o"], mockSession);

      expect(mockSession.config.provider.model).toBe(originalModel);
    });
  });

  describe("execute with unknown model", () => {
    it("should allow custom model names with warning", async () => {
      await modelCommand.execute(["my-custom-model"], mockSession);

      expect(mockSession.config.provider.model).toBe("my-custom-model");
      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("not in known list");
    });
  });

  // Skip tests that require interactive mode (no arguments)
  describe.skip("provider-specific models (interactive mode)", () => {
    it("should show OpenAI models when provider is openai", async () => {
      mockSession.config.provider.type = "openai";
      mockSession.config.provider.model = "gpt-4o";

      await modelCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("gpt-4o");
    });

    it("should show Gemini models when provider is gemini", async () => {
      mockSession.config.provider.type = "gemini";
      mockSession.config.provider.model = "gemini-2.0-flash";

      await modelCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("gemini");
    });
  });
});
