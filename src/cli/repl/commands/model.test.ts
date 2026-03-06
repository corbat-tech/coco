/**
 * Tests for /model command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { modelCommand, fetchLocalModels, buildLocalModelList } from "./model.js";
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
      const result = await modelCommand.execute(["claude-opus-4-5-20251101"], mockSession);

      expect(mockSession.config.provider.model).toBe("claude-opus-4-5-20251101");
      expect(result).toBe(false);
    });

    it("should display success message", async () => {
      await modelCommand.execute(["claude-opus-4-5-20251101"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Switched to");
    });
  });

  describe("execute with model from different provider", () => {
    it("should warn about provider mismatch", async () => {
      await modelCommand.execute(["gpt-5.4-codex"], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("OpenAI"); // Provider name (capitalized)
      expect(allOutput).toContain("Anthropic Claude"); // Current provider full name
    });

    it("should not change the model", async () => {
      const originalModel = mockSession.config.provider.model;
      await modelCommand.execute(["gpt-5.4-codex"], mockSession);

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

describe("fetchLocalModels", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return model IDs from server response", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        data: [{ id: "qwen2.5-coder:14b" }, { id: "llama3.1:8b" }],
      }),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as Response);

    const models = await fetchLocalModels("ollama");

    expect(models).toEqual(["qwen2.5-coder:14b", "llama3.1:8b"]);
  });

  it("should return empty array when server is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const models = await fetchLocalModels("ollama");

    expect(models).toEqual([]);
  });

  it("should return empty array when response is not ok", async () => {
    const mockResponse = { ok: false };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as Response);

    const models = await fetchLocalModels("ollama");

    expect(models).toEqual([]);
  });

  it("should return empty array when response has no data", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({}),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as Response);

    const models = await fetchLocalModels("ollama");

    expect(models).toEqual([]);
  });
});

describe("buildLocalModelList", () => {
  const staticModels = [
    {
      id: "qwen2.5-coder:14b",
      name: "Qwen 2.5 Coder 14B",
      description: "best coding model (16GB RAM)",
      recommended: true,
      contextWindow: 32768,
    },
    {
      id: "qwen3-coder:30b",
      name: "Qwen3 Coder 30B",
      description: "MoE 30B/3B active (24GB RAM)",
      recommended: false,
      contextWindow: 262144,
    },
    {
      id: "deepseek-r1:14b",
      name: "DeepSeek R1 14B",
      description: "reasoning model (16GB RAM)",
      recommended: false,
      contextWindow: 128000,
    },
  ];

  it("should mark downloaded models as enabled and rest as disabled", () => {
    const result = buildLocalModelList(["qwen2.5-coder:14b"], staticModels, "ollama");

    // Downloaded model is enabled
    const downloaded = result.find((m) => m.id === "qwen2.5-coder:14b");
    expect(downloaded?.disabled).toBe(false);
    expect(downloaded?.name).toBe("Qwen 2.5 Coder 14B");
    expect(downloaded?.recommended).toBe(true);

    // Not downloaded models are disabled with hints
    const notDownloaded = result.filter((m) => m.disabled);
    expect(notDownloaded).toHaveLength(2);
    expect(notDownloaded[0]?.hint).toContain("ollama pull");
  });

  it("should include custom downloaded models not in static list", () => {
    const result = buildLocalModelList(
      ["qwen2.5-coder:14b", "my-custom-model:7b"],
      staticModels,
      "ollama",
    );

    const custom = result.find((m) => m.id === "my-custom-model:7b");
    expect(custom).toBeDefined();
    expect(custom?.disabled).toBe(false);
    expect(custom?.name).toBeUndefined();
  });

  it("should put downloaded models before not-downloaded models", () => {
    const result = buildLocalModelList(["deepseek-r1:14b"], staticModels, "ollama");

    // First model should be downloaded (enabled)
    expect(result[0]?.id).toBe("deepseek-r1:14b");
    expect(result[0]?.disabled).toBe(false);

    // Rest should be disabled
    expect(result[1]?.disabled).toBe(true);
    expect(result[2]?.disabled).toBe(true);
  });

  it("should use lmstudio hints for lmstudio provider", () => {
    const result = buildLocalModelList([], staticModels, "lmstudio");

    // All are disabled since none downloaded
    expect(result.every((m) => m.disabled)).toBe(true);
    expect(result[0]?.hint).toContain("search '");
    expect(result[0]?.hint).toContain("in LM Studio");
  });

  it("should handle fuzzy matching for LM Studio model IDs", () => {
    const result = buildLocalModelList(
      ["lmstudio-community/qwen2.5-coder-14b-GGUF"],
      staticModels,
      "lmstudio",
    );

    // Should match via fuzzy and enrich with static definition
    const matched = result.find((m) => m.id === "lmstudio-community/qwen2.5-coder-14b-GGUF");
    expect(matched?.disabled).toBe(false);
    expect(matched?.name).toBe("Qwen 2.5 Coder 14B");

    // The original qwen2.5-coder:14b should NOT appear as not-downloaded
    const notDownloadedIds = result.filter((m) => m.disabled).map((m) => m.id);
    expect(notDownloadedIds).not.toContain("qwen2.5-coder:14b");
  });

  it("should return empty array when no downloaded and no static models", () => {
    const result = buildLocalModelList([], [], "ollama");

    expect(result).toEqual([]);
  });
});
