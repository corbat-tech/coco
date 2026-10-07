import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("./loader.js", () => ({ loadConfig: io.load, saveConfig: io.save }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: () => false,
    promises: {
      ...actual.promises,
      readFile: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }),
    },
  };
});
import { getInternalProviderId, getLastUsedAuthMethod, saveProviderPreference } from "./env.js";
import { CocoConfigSchema, type CocoConfig } from "./schema.js";

describe("persisted explicit provider authentication", () => {
  let stored: CocoConfig;
  beforeEach(() => {
    vi.resetAllMocks();
    stored = CocoConfigSchema.parse({ project: { name: "fixture" } });
    io.load.mockImplementation(async () => structuredClone(stored));
    io.save.mockImplementation(async (next: CocoConfig) => {
      stored = structuredClone(next);
    });
    vi.stubEnv("OPENAI_CODEX_TOKEN", "ambient-test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("retains explicit API-key choice across config reload despite ambient OAuth", async () => {
    await saveProviderPreference("openai", "gpt-4o", { authMethod: "apikey" });
    const reloaded = await getLastUsedAuthMethod("openai");
    expect(reloaded).toBe("apikey");
    expect(getInternalProviderId("openai", reloaded)).toBe("openai");
    expect(stored.providerModels?.openai).toBe("gpt-4o");
  });
  it("keeps authentication choices isolated between providers and later model-only updates", async () => {
    await saveProviderPreference("openai", "gpt-4o", { authMethod: "oauth" });
    await saveProviderPreference("vertex", "gemini-2.5-pro", {
      authMethod: "gcloud",
      project: "fixture-project",
      location: "global",
    });
    await saveProviderPreference("openai", "gpt-4.1");
    expect(await getLastUsedAuthMethod("openai")).toBe("oauth");
    expect(await getLastUsedAuthMethod("vertex")).toBe("gcloud");
    expect(getInternalProviderId("openai", await getLastUsedAuthMethod("openai"))).toBe("codex");
  });
  it("does not invent an explicit preference for legacy configuration", async () => {
    expect(await getLastUsedAuthMethod("openai")).toBeUndefined();
    expect(getInternalProviderId("openai")).toBe("codex");
  });
  it("rejects failed persistence without changing saved authentication", async () => {
    io.save.mockRejectedValue(new Error("storage unavailable"));
    await expect(
      saveProviderPreference("openai", "gpt-4o", { authMethod: "apikey" }),
    ).rejects.toThrow("storage unavailable");
    expect(await getLastUsedAuthMethod("openai")).toBeUndefined();
  });
});
