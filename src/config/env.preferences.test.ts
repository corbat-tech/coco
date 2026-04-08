import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => {
    throw new Error("no global env file");
  }),
  promises: {},
}));

vi.mock("./paths.js", () => ({
  CONFIG_PATHS: {
    config: "/tmp/.coco/config.json",
  },
}));

vi.mock("./loader.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

describe("env preferences use global config only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getLastUsedProvider reads global config path explicitly", async () => {
    const { loadConfig } = await import("./loader.js");
    vi.mocked(loadConfig).mockResolvedValue({
      provider: { type: "openai", model: "gpt-5.4-codex" },
    } as any);

    const { getLastUsedProvider } = await import("./env.js");
    const provider = await getLastUsedProvider();

    expect(provider).toBe("openai");
    expect(loadConfig).toHaveBeenCalledWith("/tmp/.coco/config.json");
  });

  it("getLastUsedModel reads global config path explicitly", async () => {
    const { loadConfig } = await import("./loader.js");
    vi.mocked(loadConfig).mockResolvedValue({
      provider: { type: "anthropic", model: "claude-opus-4-6" },
      providerModels: { anthropic: "claude-opus-4-6" },
    } as any);

    const { getLastUsedModel } = await import("./env.js");
    const model = await getLastUsedModel("anthropic" as any);

    expect(model).toBe("claude-opus-4-6");
    expect(loadConfig).toHaveBeenCalledWith("/tmp/.coco/config.json");
  });

  it("getLastUsedModel ignores empty-string model values", async () => {
    const { loadConfig } = await import("./loader.js");
    vi.mocked(loadConfig).mockResolvedValue({
      provider: { type: "copilot", model: "   " },
      providerModels: { copilot: "   " },
    } as any);

    const { getLastUsedModel } = await import("./env.js");
    const model = await getLastUsedModel("copilot" as any);

    expect(model).toBeUndefined();
  });

  it("getLastUsedModel ignores placeholder default model values", async () => {
    const { loadConfig } = await import("./loader.js");
    vi.mocked(loadConfig).mockResolvedValue({
      provider: { type: "copilot", model: "default" },
      providerModels: { copilot: "default" },
    } as any);

    const { getLastUsedModel } = await import("./env.js");
    const model = await getLastUsedModel("copilot" as any);

    expect(model).toBeUndefined();
  });

  it("saveProviderPreference loads/saves against global config", async () => {
    const { loadConfig, saveConfig } = await import("./loader.js");
    vi.mocked(loadConfig).mockResolvedValue({
      provider: { type: "anthropic", model: "claude-opus-4-6", maxTokens: 8192 },
      providerModels: { anthropic: "claude-opus-4-6" },
      project: { name: "global", version: "0.1.0" },
      quality: {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minIterations: 2,
        convergenceThreshold: 2,
        securityThreshold: 100,
      },
      persistence: {
        checkpointInterval: 300000,
        maxCheckpoints: 50,
        retentionDays: 7,
        compressOldCheckpoints: true,
      },
    } as any);

    const { saveProviderPreference } = await import("./env.js");
    await saveProviderPreference("openai" as any, "gpt-5.4-codex");

    expect(loadConfig).toHaveBeenCalledWith("/tmp/.coco/config.json");
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          type: "openai",
          model: "gpt-5.4-codex",
        }),
        providerModels: expect.objectContaining({
          anthropic: "claude-opus-4-6",
          openai: "gpt-5.4-codex",
        }),
      }),
      undefined,
      true,
    );
  });

  it("saveProviderPreference falls back to provider default when model is empty", async () => {
    const { loadConfig, saveConfig } = await import("./loader.js");
    vi.mocked(loadConfig).mockResolvedValue({
      provider: { type: "anthropic", model: "claude-opus-4-6", maxTokens: 8192 },
      providerModels: { anthropic: "claude-opus-4-6" },
      project: { name: "global", version: "0.1.0" },
      quality: {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minIterations: 2,
        convergenceThreshold: 2,
        securityThreshold: 100,
      },
      persistence: {
        checkpointInterval: 300000,
        maxCheckpoints: 50,
        retentionDays: 7,
        compressOldCheckpoints: true,
      },
    } as any);

    const { saveProviderPreference } = await import("./env.js");
    await saveProviderPreference("copilot" as any, "   ");

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          type: "copilot",
          model: "claude-sonnet-4.6",
        }),
        providerModels: expect.objectContaining({
          anthropic: "claude-opus-4-6",
          copilot: "claude-sonnet-4.6",
        }),
      }),
      undefined,
      true,
    );
  });

  it("getLastUsedModel prefers provider-specific saved model over current provider.model", async () => {
    const { loadConfig } = await import("./loader.js");
    vi.mocked(loadConfig).mockResolvedValue({
      provider: { type: "anthropic", model: "claude-opus-4-6" },
      providerModels: { copilot: "gpt-5.4-codex", anthropic: "claude-opus-4-6" },
    } as any);

    const { getLastUsedModel } = await import("./env.js");
    const model = await getLastUsedModel("copilot" as any);

    expect(model).toBe("gpt-5.4-codex");
  });
});
