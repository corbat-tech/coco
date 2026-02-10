import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ─── Mock all external modules ───────────────────────────────────────

vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  isCancel: vi.fn(),
}));

vi.mock("chalk", () => {
  const handler: ProxyHandler<object> = {
    get() {
      return new Proxy((...args: unknown[]) => args.join(""), handler);
    },
    apply(_target, _thisArg, argsList: unknown[]) {
      return argsList.join("");
    },
  };
  return {
    default: new Proxy((...args: unknown[]) => args.join(""), handler),
  };
});

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(""),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../providers/index.js", () => ({
  createProvider: vi.fn(),
}));

vi.mock("../../version.js", () => ({
  VERSION: "1.0.0-test",
}));

vi.mock("./providers-config.js", () => ({
  getAllProviders: vi.fn(),
  getProviderDefinition: vi.fn(),
  getRecommendedModel: vi.fn(),
  getConfiguredProviders: vi.fn(),
  formatModelInfo: vi.fn(),
}));

vi.mock("../../auth/index.js", () => ({
  runOAuthFlow: vi.fn(),
  supportsOAuth: vi.fn(),
  isADCConfigured: vi.fn(),
  isGcloudInstalled: vi.fn(),
  getADCAccessToken: vi.fn(),
  isOAuthConfigured: vi.fn(),
  getOrRefreshOAuthToken: vi.fn(),
}));

vi.mock("../../config/paths.js", () => ({
  CONFIG_PATHS: {
    home: "/tmp/.coco",
    config: "/tmp/.coco/config.json",
    env: "/tmp/.coco/.env",
    tokens: "/tmp/.coco/tokens",
  },
}));

vi.mock("../../config/env.js", () => ({
  saveProviderPreference: vi.fn().mockResolvedValue(undefined),
  getAuthMethod: vi.fn().mockReturnValue(undefined),
}));

// ─── Imports ─────────────────────────────────────────────────────────

import * as p from "@clack/prompts";
import * as fs from "node:fs/promises";
import { runOnboardingV2, saveConfiguration, setupLMStudioProvider } from "./onboarding-v2.js";
import {
  getAllProviders,
  getProviderDefinition,
  getConfiguredProviders,
  formatModelInfo,
} from "./providers-config.js";
import {
  supportsOAuth,
  runOAuthFlow,
  isGcloudInstalled,
  isADCConfigured,
  getADCAccessToken,
} from "../../auth/index.js";
import { createProvider } from "../../providers/index.js";
import { saveProviderPreference } from "../../config/env.js";
import type { ProviderDefinition } from "./providers-config.js";

// ─── Helpers ─────────────────────────────────────────────────────────

const mockedSelect = vi.mocked(p.select);
const mockedConfirm = vi.mocked(p.confirm);
const mockedText = vi.mocked(p.text);
const mockedPassword = vi.mocked(p.password);
const mockedIsCancel = vi.mocked(p.isCancel);
const mockedGetAllProviders = vi.mocked(getAllProviders);
const mockedGetProviderDefinition = vi.mocked(getProviderDefinition);
const mockedGetConfiguredProviders = vi.mocked(getConfiguredProviders);
const mockedFormatModelInfo = vi.mocked(formatModelInfo);
const mockedSupportsOAuth = vi.mocked(supportsOAuth);
const mockedRunOAuthFlow = vi.mocked(runOAuthFlow);
const mockedCreateProvider = vi.mocked(createProvider);
const _mockedIsGcloudInstalled = vi.mocked(isGcloudInstalled);
const _mockedIsADCConfigured = vi.mocked(isADCConfigured);
const _mockedGetADCAccessToken = vi.mocked(getADCAccessToken);

function makeProviderDef(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    id: "anthropic",
    name: "Anthropic",
    emoji: "A",
    description: "Claude AI",
    envVar: "ANTHROPIC_API_KEY",
    apiKeyUrl: "https://console.anthropic.com/keys",
    docsUrl: "https://docs.anthropic.com",
    baseUrl: "https://api.anthropic.com",
    models: [
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        description: "Fast model",
        recommended: true,
      },
    ],
    supportsCustomModels: true,
    requiresApiKey: true,
    features: { streaming: true, functionCalling: true, vision: true },
    ...overrides,
  } as ProviderDefinition;
}

describe("onboarding-v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Prevent console.clear from clearing test output
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockedIsCancel.mockReturnValue(false);
    mockedFormatModelInfo.mockImplementation((m) => m.name || m.id);
  });

  // ─── runOnboardingV2 ────────────────────────────────────────────

  describe("runOnboardingV2", () => {
    it("should return null when user selects exit on first-time flow", async () => {
      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([makeProviderDef()]);
      mockedSelect.mockResolvedValue("exit");

      const result = await runOnboardingV2();
      expect(result).toBeNull();
    });

    it("should return null when user cancels provider selection", async () => {
      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([makeProviderDef()]);
      // isCancel returns true for the cancel symbol
      mockedSelect.mockResolvedValue(Symbol.for("cancel") as any);
      mockedIsCancel.mockReturnValue(true);

      const result = await runOnboardingV2();
      expect(result).toBeNull();
    });

    it("should return null when user cancels existing provider confirmation", async () => {
      const provDef = makeProviderDef();
      mockedGetConfiguredProviders.mockReturnValue([provDef]);
      // Cancel the confirm dialog
      mockedConfirm.mockResolvedValue(Symbol.for("cancel") as any);
      mockedIsCancel.mockImplementation((val) => typeof val === "symbol");

      const result = await runOnboardingV2();
      expect(result).toBeNull();
    });

    it("should navigate to API key help and recurse on 'help' selection", async () => {
      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([makeProviderDef()]);

      // First call: help, second call: exit (to stop recursion)
      mockedSelect.mockResolvedValueOnce("help");
      // For the help flow's confirm (press Enter)
      mockedConfirm.mockResolvedValueOnce(true);
      // Second invocation: exit
      mockedSelect.mockResolvedValueOnce("exit");

      const result = await runOnboardingV2();
      expect(result).toBeNull();
      // select should have been called at least twice (help, then exit)
      expect(mockedSelect).toHaveBeenCalledTimes(2);
    });
  });

  // ─── setupProviderWithAuth (API key flow) ─────────────────────

  describe("setupProviderWithAuth (API key flow)", () => {
    it("should complete API key flow for a cloud provider", async () => {
      const provDef = makeProviderDef({ askForCustomUrl: false });
      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([provDef]);
      mockedGetProviderDefinition.mockReturnValue(provDef);
      mockedSupportsOAuth.mockReturnValue(false);

      // Select anthropic provider
      mockedSelect
        .mockResolvedValueOnce("anthropic") // provider choice
        .mockResolvedValueOnce("claude-sonnet-4-20250514"); // model choice

      // API key input
      mockedPassword.mockResolvedValueOnce("sk-ant-test-key-1234567890");

      // Test connection
      const mockProvider = { isAvailable: vi.fn().mockResolvedValue(true), id: "anthropic" };
      mockedCreateProvider.mockResolvedValue(mockProvider as any);

      const result = await runOnboardingV2();

      expect(result).not.toBeNull();
      expect(result?.type).toBe("anthropic");
      expect(result?.model).toBe("claude-sonnet-4-20250514");
      expect(result?.apiKey).toBe("sk-ant-test-key-1234567890");
    });

    it("should return null when API key input is cancelled", async () => {
      const provDef = makeProviderDef();
      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([provDef]);
      mockedGetProviderDefinition.mockReturnValue(provDef);
      mockedSupportsOAuth.mockReturnValue(false);

      mockedSelect.mockResolvedValueOnce("anthropic");
      // Cancel password input
      mockedPassword.mockResolvedValueOnce(Symbol.for("cancel") as any);
      mockedIsCancel.mockImplementation((val) => typeof val === "symbol");

      const result = await runOnboardingV2();
      expect(result).toBeNull();
    });

    it("should return null when model selection is cancelled", async () => {
      const provDef = makeProviderDef();
      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([provDef]);
      mockedGetProviderDefinition.mockReturnValue(provDef);
      mockedSupportsOAuth.mockReturnValue(false);

      mockedSelect.mockResolvedValueOnce("anthropic");
      mockedPassword.mockResolvedValueOnce("sk-ant-valid-key-1234567890");

      // Cancel model selection
      mockedSelect.mockResolvedValueOnce(Symbol.for("cancel") as any);
      mockedIsCancel.mockImplementation((val) => typeof val === "symbol");

      const result = await runOnboardingV2();
      expect(result).toBeNull();
    });

    it("should allow retry when connection test fails", async () => {
      const provDef = makeProviderDef();
      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([provDef]);
      mockedGetProviderDefinition.mockReturnValue(provDef);
      mockedSupportsOAuth.mockReturnValue(false);

      // First attempt
      mockedSelect.mockResolvedValueOnce("anthropic");
      mockedPassword.mockResolvedValueOnce("sk-ant-bad-key-12345678901");
      mockedSelect.mockResolvedValueOnce("claude-sonnet-4-20250514");

      // Connection fails
      const failingProvider = { isAvailable: vi.fn().mockResolvedValue(false), id: "anthropic" };
      mockedCreateProvider.mockResolvedValueOnce(failingProvider as any);

      // User wants to retry
      mockedConfirm.mockResolvedValueOnce(true);

      // Second attempt (retry)
      mockedPassword.mockResolvedValueOnce("sk-ant-good-key-1234567890");
      mockedSelect.mockResolvedValueOnce("claude-sonnet-4-20250514");

      // Connection succeeds
      const succeedingProvider = { isAvailable: vi.fn().mockResolvedValue(true), id: "anthropic" };
      mockedCreateProvider.mockResolvedValueOnce(succeedingProvider as any);

      const result = await runOnboardingV2();

      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("sk-ant-good-key-1234567890");
    });

    it("should return null when user declines retry after failed connection", async () => {
      const provDef = makeProviderDef();
      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([provDef]);
      mockedGetProviderDefinition.mockReturnValue(provDef);
      mockedSupportsOAuth.mockReturnValue(false);

      mockedSelect.mockResolvedValueOnce("anthropic");
      mockedPassword.mockResolvedValueOnce("sk-ant-bad-key-12345678901");
      mockedSelect.mockResolvedValueOnce("claude-sonnet-4-20250514");

      const failProvider = { isAvailable: vi.fn().mockResolvedValue(false), id: "anthropic" };
      mockedCreateProvider.mockResolvedValueOnce(failProvider as any);

      // Decline retry
      mockedConfirm.mockResolvedValueOnce(false);

      const result = await runOnboardingV2();
      expect(result).toBeNull();
    });
  });

  // ─── OAuth flow ───────────────────────────────────────────────

  describe("setupProviderWithAuth (OAuth flow)", () => {
    it("should complete OAuth flow for OpenAI", async () => {
      const openaiDef = makeProviderDef({
        id: "openai" as any,
        name: "OpenAI",
        envVar: "OPENAI_API_KEY",
      });
      const codexDef = makeProviderDef({
        id: "codex" as any,
        name: "Codex",
        envVar: "OPENAI_CODEX_TOKEN",
        models: [
          {
            id: "gpt-4o",
            name: "GPT-4o",
            contextWindow: 128000,
            maxOutputTokens: 4096,
            description: "Latest",
          },
        ],
      });

      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([openaiDef]);
      mockedGetProviderDefinition
        .mockReturnValueOnce(openaiDef) // Initial selection
        .mockReturnValueOnce(codexDef); // After OAuth, get codex provider

      mockedSupportsOAuth.mockReturnValue(true);

      // Select OpenAI
      mockedSelect.mockResolvedValueOnce("openai");

      // Auth method: OAuth
      mockedSelect.mockResolvedValueOnce("oauth");

      // OAuth succeeds
      mockedRunOAuthFlow.mockResolvedValue({
        accessToken: "oauth-token-123",
        expiresAt: Date.now() + 3600000,
      });

      // Select model for codex
      mockedSelect.mockResolvedValueOnce("gpt-4o");

      const result = await runOnboardingV2();

      expect(result).not.toBeNull();
      expect(result?.type).toBe("codex");
      expect(result?.model).toBe("gpt-4o");
      expect(result?.apiKey).toBe("oauth-token-123");
    });

    it("should return null when OAuth flow fails", async () => {
      const openaiDef = makeProviderDef({
        id: "openai" as any,
        name: "OpenAI",
        envVar: "OPENAI_API_KEY",
      });

      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([openaiDef]);
      mockedGetProviderDefinition.mockReturnValue(openaiDef);
      mockedSupportsOAuth.mockReturnValue(true);

      mockedSelect.mockResolvedValueOnce("openai");
      mockedSelect.mockResolvedValueOnce("oauth");

      // OAuth fails
      mockedRunOAuthFlow.mockResolvedValue(null);

      const result = await runOnboardingV2();
      expect(result).toBeNull();
    });
  });

  // ─── saveConfiguration ────────────────────────────────────────

  describe("saveConfiguration", () => {
    it("should handle gcloud ADC configuration (no API key saving)", async () => {
      const provDef = makeProviderDef({ id: "gemini" as any, envVar: "GEMINI_API_KEY" });
      mockedGetProviderDefinition.mockReturnValue(provDef);

      await saveConfiguration({
        type: "gemini" as any,
        model: "gemini-pro",
        apiKey: "__gcloud_adc__",
      });

      expect(saveProviderPreference).toHaveBeenCalledWith("gemini", "gemini-pro");
      // writeFile should NOT be called for ADC (no env file writing)
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("should save API key to global env file when user selects global", async () => {
      const provDef = makeProviderDef();
      mockedGetProviderDefinition.mockReturnValue(provDef);

      // User selects global save
      mockedSelect.mockResolvedValueOnce("global");

      await saveConfiguration({
        type: "anthropic",
        model: "claude-sonnet-4-20250514",
        apiKey: "sk-ant-my-key-1234567890",
      });

      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(saveProviderPreference).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-20250514");
    });

    it("should set env vars for session only when user selects session", async () => {
      const provDef = makeProviderDef();
      mockedGetProviderDefinition.mockReturnValue(provDef);

      mockedSelect.mockResolvedValueOnce("session");

      const originalEnv = { ...process.env };

      await saveConfiguration({
        type: "anthropic",
        model: "claude-sonnet-4-20250514",
        apiKey: "sk-ant-session-key-12345",
      });

      // env var should be set for the session
      expect(process.env["ANTHROPIC_API_KEY"]).toBe("sk-ant-session-key-12345");

      // No file writing for session-only
      expect(fs.writeFile).not.toHaveBeenCalled();

      // Cleanup
      process.env = originalEnv;
    });

    it("should do nothing when user cancels save dialog", async () => {
      const provDef = makeProviderDef();
      mockedGetProviderDefinition.mockReturnValue(provDef);

      mockedSelect.mockResolvedValueOnce(Symbol.for("cancel") as any);
      mockedIsCancel.mockReturnValue(true);

      await saveConfiguration({
        type: "anthropic",
        model: "claude-sonnet-4-20250514",
        apiKey: "sk-ant-cancel-key-12345",
      });

      // No file operations and no provider preference saved
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("should save LM Studio config without API key", async () => {
      const lmDef = makeProviderDef({
        id: "lmstudio" as any,
        name: "LM Studio",
        envVar: "LMSTUDIO_API_KEY",
        requiresApiKey: false,
      });
      mockedGetProviderDefinition.mockReturnValue(lmDef);

      mockedSelect.mockResolvedValueOnce("global");

      await saveConfiguration({
        type: "lmstudio" as any,
        model: "qwen2.5-coder-7b",
        apiKey: "lm-studio",
        baseUrl: "http://localhost:5678/v1",
      });

      // Should write to file
      expect(fs.writeFile).toHaveBeenCalled();

      // Verify written content includes COCO_PROVIDER and LMSTUDIO_MODEL
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenContent = writeCall?.[1] as string;
      expect(writtenContent).toContain("COCO_PROVIDER=lmstudio");
      expect(writtenContent).toContain("LMSTUDIO_MODEL=qwen2.5-coder-7b");
      expect(writtenContent).toContain("LMSTUDIO_BASE_URL=http://localhost:5678/v1");
    });

    it("should save codex/OAuth config with provider and model", async () => {
      const codexDef = makeProviderDef({
        id: "codex" as any,
        name: "Codex",
        envVar: "OPENAI_CODEX_TOKEN",
      });
      mockedGetProviderDefinition.mockReturnValue(codexDef);

      mockedSelect.mockResolvedValueOnce("global");

      await saveConfiguration({
        type: "codex" as any,
        model: "gpt-4o",
        apiKey: "oauth-token",
      });

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenContent = writeCall?.[1] as string;
      expect(writtenContent).toContain("COCO_PROVIDER=codex");
      expect(writtenContent).toContain("CODEX_MODEL=gpt-4o");
      // OAuth tokens are managed by the OAuth flow, not written as API keys
      expect(writtenContent).not.toContain("oauth-token");
    });
  });

  // ─── Model selection ──────────────────────────────────────────

  describe("model selection logic (via full flow)", () => {
    it("should allow custom model entry when supported", async () => {
      const provDef = makeProviderDef({ supportsCustomModels: true });
      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([provDef]);
      mockedGetProviderDefinition.mockReturnValue(provDef);
      mockedSupportsOAuth.mockReturnValue(false);

      mockedSelect.mockResolvedValueOnce("anthropic"); // provider
      mockedPassword.mockResolvedValueOnce("sk-ant-key-1234567890123");
      mockedSelect.mockResolvedValueOnce("__custom__"); // custom model
      mockedText.mockResolvedValueOnce("custom-model-id");

      const mockProvider = { isAvailable: vi.fn().mockResolvedValue(true), id: "anthropic" };
      mockedCreateProvider.mockResolvedValue(mockProvider as any);

      const result = await runOnboardingV2();

      expect(result?.model).toBe("custom-model-id");
    });
  });

  // ─── Custom URL ───────────────────────────────────────────────

  describe("custom URL handling", () => {
    it("should ask for custom URL when askForCustomUrl is enabled", async () => {
      const provDef = makeProviderDef({ askForCustomUrl: true });
      mockedGetConfiguredProviders.mockReturnValue([]);
      mockedGetAllProviders.mockReturnValue([provDef]);
      mockedGetProviderDefinition.mockReturnValue(provDef);
      mockedSupportsOAuth.mockReturnValue(false);

      mockedSelect.mockResolvedValueOnce("anthropic");
      mockedPassword.mockResolvedValueOnce("sk-ant-key-1234567890123");

      // Do NOT use default URL
      mockedConfirm.mockResolvedValueOnce(false);
      mockedText.mockResolvedValueOnce("https://custom-proxy.example.com/v1");

      mockedSelect.mockResolvedValueOnce("claude-sonnet-4-20250514");

      const mockProvider = { isAvailable: vi.fn().mockResolvedValue(true), id: "anthropic" };
      mockedCreateProvider.mockResolvedValue(mockProvider as any);

      const result = await runOnboardingV2();

      expect(result?.baseUrl).toBe("https://custom-proxy.example.com/v1");
    });
  });

  // ─── LM Studio provider ──────────────────────────────────────

  describe("setupLMStudioProvider", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      // Mock fetch to simulate server not running
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("should return null when user selects exit", async () => {
      const lmDef = makeProviderDef({
        id: "lmstudio" as any,
        requiresApiKey: false,
      });
      mockedGetProviderDefinition.mockReturnValue(lmDef);

      // Server not running, then user exits
      mockedSelect.mockResolvedValueOnce("exit");

      const result = await setupLMStudioProvider(1234);
      expect(result).toBeNull();
    });

    it("should return null when user cancels during retry flow", async () => {
      const lmDef = makeProviderDef({
        id: "lmstudio" as any,
        requiresApiKey: false,
      });
      mockedGetProviderDefinition.mockReturnValue(lmDef);

      // Cancel the select
      mockedSelect.mockResolvedValueOnce(Symbol.for("cancel") as any);
      mockedIsCancel.mockImplementation((val) => typeof val === "symbol");

      const result = await setupLMStudioProvider(1234);
      expect(result).toBeNull();
    });
  });

  // ─── Existing providers flow ──────────────────────────────────

  describe("existing providers flow", () => {
    it("should use existing provider when user confirms", async () => {
      const provDef = makeProviderDef();
      mockedGetConfiguredProviders.mockReturnValue([provDef]);
      mockedGetProviderDefinition.mockReturnValue(provDef);

      // Use existing? Yes
      mockedConfirm.mockResolvedValueOnce(true);
      // Select provider
      mockedSelect.mockResolvedValueOnce("anthropic");
      // Select model
      mockedSelect.mockResolvedValueOnce("claude-sonnet-4-20250514");

      // Mock env var
      const originalEnv = process.env["ANTHROPIC_API_KEY"];
      process.env["ANTHROPIC_API_KEY"] = "sk-ant-existing-key-1234";

      const mockProvider = { isAvailable: vi.fn().mockResolvedValue(true), id: "anthropic" };
      mockedCreateProvider.mockResolvedValue(mockProvider as any);

      const result = await runOnboardingV2();

      expect(result).not.toBeNull();
      expect(result?.type).toBe("anthropic");

      // Cleanup
      if (originalEnv !== undefined) {
        process.env["ANTHROPIC_API_KEY"] = originalEnv;
      } else {
        delete process.env["ANTHROPIC_API_KEY"];
      }
    });
  });
});
