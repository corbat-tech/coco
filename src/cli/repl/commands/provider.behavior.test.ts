import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplSession } from "../types.js";
import type { LLMProvider } from "../../../providers/types.js";
const io = vi.hoisted(() => ({
  select: vi.fn(),
  password: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  setupOllama: vi.fn(),
  setupLMStudio: vi.fn(),
  save: vi.fn(),
  preference: vi.fn(),
  remembered: vi.fn(),
  create: vi.fn(),
  oauth: vi.fn(),
  configured: vi.fn(),
  refresh: vi.fn(),
  adc: vi.fn(),
  installed: vi.fn(),
  login: vi.fn(),
  revoke: vi.fn(),
  clear: vi.fn(),
  deleteTokens: vi.fn(),
  deleteCopilot: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  select: io.select,
  password: io.password,
  text: io.text,
  confirm: io.confirm,
  isCancel: (value: unknown) => typeof value === "symbol",
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { error: vi.fn(), step: vi.fn() },
}));
vi.mock("../../../providers/index.js", () => ({ createProvider: io.create }));
vi.mock("../onboarding-v2.js", () => ({
  setupOllamaProvider: io.setupOllama,
  setupLMStudioProvider: io.setupLMStudio,
  saveConfiguration: io.save,
}));
vi.mock("../../../auth/index.js", () => ({
  runOAuthFlow: io.oauth,
  supportsOAuth: (provider: string) => ["openai", "gemini", "copilot"].includes(provider),
  isOAuthConfigured: io.configured,
  getOrRefreshOAuthToken: io.refresh,
  inspectADC: io.adc,
  isGcloudInstalled: io.installed,
  runGcloudADCLogin: io.login,
  runGcloudADCRevoke: io.revoke,
  deleteTokens: io.deleteTokens,
  deleteCopilotCredentials: io.deleteCopilot,
}));
vi.mock("../../../config/env.js", async (original) => ({
  ...(await original<typeof import("../../../config/env.js")>()),
  saveProviderPreference: io.preference,
  clearAuthMethod: io.clear,
  getLastUsedModel: io.remembered,
}));
import { providerCommand } from "./provider.js";

function session(): ReplSession {
  return {
    id: "session",
    projectPath: process.cwd(),
    startedAt: new Date(),
    messages: [],
    trustedTools: new Set(),
    config: {
      provider: { type: "anthropic", model: "current", maxTokens: 4096 },
      ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100, showDiff: "never" },
      agent: { systemPrompt: "", maxToolIterations: 10, confirmDestructive: true },
    },
  };
}
describe("provider command behavioral transitions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    io.select.mockResolvedValue("apikey");
    io.password.mockResolvedValue("test-key-not-a-secret");
    io.remembered.mockResolvedValue("remembered-model");
    io.create.mockResolvedValue({ isAvailable: vi.fn(async () => true) } as unknown as LLMProvider);
    io.configured.mockResolvedValue(false);
    io.adc.mockResolvedValue({ status: "missing", token: null });
    io.installed.mockResolvedValue(true);
    for (const name of [
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "GROQ_API_KEY",
      "OPENAI_CODEX_TOKEN",
      "OPENAI_ACCESS_TOKEN",
      "GEMINI_OAUTH_TOKEN",
      "VERTEX_PROJECT",
      "VERTEX_LOCATION",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_CLOUD_LOCATION",
      "GCLOUD_PROJECT",
    ])
      vi.stubEnv(name, "");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  it("rejects unknown provider and keeps current provider without side effects", async () => {
    const current = session();
    await providerCommand.execute(["not-a-provider"], current);
    await providerCommand.execute(["anthropic"], current);
    expect(current.config.provider.model).toBe("current");
    expect(io.create).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
  });
  it.each(["ollama", "lmstudio"])(
    "commits validated local %s setup after persistence",
    async (type) => {
      const setup = type === "ollama" ? io.setupOllama : io.setupLMStudio;
      setup.mockResolvedValue({ type, model: "local-model" });
      const current = session();
      await providerCommand.execute([type], current);
      expect(io.save).toHaveBeenCalledWith({ type, model: "local-model", authMethod: "none" });
      expect(current.config.provider).toMatchObject({ type, model: "local-model" });
    },
  );
  it.each(["ollama", "lmstudio"])(
    "cancelling %s leaves session and persistence untouched",
    async (type) => {
      (type === "ollama" ? io.setupOllama : io.setupLMStudio).mockResolvedValue(null);
      const current = session(),
        before = structuredClone(current.config);
      await providerCommand.execute([type], current);
      expect(current.config).toEqual(before);
      expect(io.save).not.toHaveBeenCalled();
    },
  );
  it("does not commit local state when persistence fails", async () => {
    io.setupOllama.mockResolvedValue({ type: "ollama", model: "local-model" });
    io.save.mockRejectedValue(new Error("disk unavailable"));
    const current = session(),
      before = structuredClone(current.config);
    await expect(providerCommand.execute(["ollama"], current)).rejects.toThrow("disk unavailable");
    expect(current.config).toEqual(before);
  });
  it("cancelling cloud auth leaves state and credentials untouched", async () => {
    io.select.mockResolvedValue("cancel");
    const current = session(),
      before = structuredClone(current.config);
    await providerCommand.execute(["openai"], current);
    expect(current.config).toEqual(before);
    expect(io.create).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
  });
  it("uses existing API key and remembered model, removing stale Vertex settings", async () => {
    vi.stubEnv("OPENAI_API_KEY", "existing-test-key");
    const current = session();
    current.config.provider.project = "old-project";
    current.config.provider.location = "old-region";
    await providerCommand.execute(["openai"], current);
    expect(io.password).not.toHaveBeenCalled();
    expect(io.create).toHaveBeenCalledWith(
      "openai",
      expect.objectContaining({ model: "remembered-model" }),
    );
    expect(io.preference).toHaveBeenCalledWith("openai", "remembered-model", expect.any(Object));
    expect(current.config.provider).toMatchObject({ type: "openai", model: "remembered-model" });
    expect(current.config.provider.project).toBeUndefined();
    expect(current.config.provider.location).toBeUndefined();
  });
  it("persists a newly entered API key only after successful validation", async () => {
    const current = session();
    await providerCommand.execute(["groq"], current);
    expect(io.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "groq",
        apiKey: "test-key-not-a-secret",
        model: "remembered-model",
      }),
    );
    expect(current.config.provider.type).toBe("groq");
  });
  it.each([false, new Error("provider unavailable")])(
    "failed connection does not commit session or preference: %s",
    async (failure) => {
      const available = vi.fn();
      if (failure instanceof Error) available.mockRejectedValue(failure);
      else available.mockResolvedValue(false);
      io.create.mockResolvedValue({ isAvailable: available });
      const current = session(),
        before = structuredClone(current.config);
      await providerCommand.execute(["openai"], current);
      expect(current.config).toEqual(before);
      expect(io.save).not.toHaveBeenCalled();
      expect(io.preference).not.toHaveBeenCalled();
    },
  );
  it("persistence failure cannot report a changed active provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "existing-test-key");
    io.preference.mockRejectedValue(new Error("disk unavailable"));
    const current = session(),
      before = structuredClone(current.config);
    await providerCommand.execute(["openai"], current);
    expect(current.config).toEqual(before);
  });
  it("refreshes existing OpenAI OAuth and validates the Codex adapter", async () => {
    io.select.mockResolvedValue("oauth");
    io.configured.mockResolvedValue(true);
    io.refresh.mockResolvedValue({ accessToken: "test-oauth-token" });
    const current = session();
    await providerCommand.execute(["openai"], current);
    expect(io.refresh).toHaveBeenCalledWith("openai");
    expect(io.oauth).not.toHaveBeenCalled();
    expect(io.create).toHaveBeenCalledWith("codex", expect.any(Object));
    expect(current.config.provider.type).toBe("openai");
  });
  it("recovers an expired OAuth session through explicit sign-in", async () => {
    io.select.mockResolvedValue("oauth");
    io.configured.mockResolvedValue(true);
    io.refresh.mockRejectedValue(new Error("expired"));
    io.oauth.mockResolvedValue({ accessToken: "renewed-test-token" });
    const current = session();
    await providerCommand.execute(["gemini"], current);
    expect(io.oauth).toHaveBeenCalledWith("gemini");
    expect(io.create).toHaveBeenCalledWith("gemini", expect.any(Object));
    expect(current.config.provider.type).toBe("gemini");
  });
  it("cancelled OAuth sign-in never probes or persists a provider", async () => {
    io.select.mockResolvedValue("oauth");
    io.oauth.mockResolvedValue(null);
    const current = session();
    await providerCommand.execute(["openai"], current);
    expect(io.create).not.toHaveBeenCalled();
    expect(io.preference).not.toHaveBeenCalled();
    expect(current.config.provider.type).toBe("anthropic");
  });
  it("keeps Copilot identity when using its existing OAuth session", async () => {
    io.select.mockResolvedValue("oauth");
    io.configured.mockResolvedValue(true);
    const current = session();
    await providerCommand.execute(["copilot"], current);
    expect(io.create).toHaveBeenCalledWith("copilot", expect.any(Object));
    expect(io.refresh).not.toHaveBeenCalled();
    expect(current.config.provider.type).toBe("copilot");
  });
  it("credential removal performs only the explicitly selected removal", async () => {
    vi.stubEnv("OPENAI_API_KEY", "existing-test-key");
    io.configured.mockResolvedValue(true);
    io.select.mockResolvedValueOnce("remove").mockResolvedValueOnce("apikey");
    const current = session();
    await providerCommand.execute(["openai"], current);
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(io.deleteTokens).not.toHaveBeenCalled();
    expect(io.create).not.toHaveBeenCalled();
    expect(current.config.provider.type).toBe("anthropic");
  });
  it("static probing does not make an API call or change the session", async () => {
    const current = session(),
      before = structuredClone(current.config);
    await providerCommand.execute(["probe", "openai", "gpt-4o"], current);
    expect(io.create).not.toHaveBeenCalled();
    expect(current.config).toEqual(before);
  });
  it("explicit live probe checks availability without switching", async () => {
    const current = session();
    await providerCommand.execute(["probe", "openai", "gpt-4o", "--live"], current);
    expect(io.create).toHaveBeenCalledWith("openai", { model: "gpt-4o" });
    expect(current.config.provider.type).toBe("anthropic");
    expect(io.preference).not.toHaveBeenCalled();
  });
  it("interactive cancellation releases its input listener and changes nothing", async () => {
    vi.spyOn(process.stdin, "resume").mockReturnThis();
    const current = session(),
      before = process.stdin.listenerCount("data");
    const pending = providerCommand.execute([], current);
    process.stdin.emit("data", Buffer.from("\x1b[B"));
    process.stdin.emit("data", Buffer.from("\x1b[A"));
    process.stdin.emit("data", Buffer.from("\x1b"));
    await pending;
    expect(process.stdin.listenerCount("data")).toBe(before);
    expect(current.config.provider.type).toBe("anthropic");
    expect(io.create).not.toHaveBeenCalled();
  });
  it("removes all selected OpenAI credentials without changing active provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "existing-test-key");
    io.configured.mockResolvedValue(true);
    io.select.mockResolvedValueOnce("remove").mockResolvedValueOnce("all");
    const current = session();
    await providerCommand.execute(["openai"], current);
    expect(io.deleteTokens).toHaveBeenCalledWith("openai");
    expect(io.clear).toHaveBeenCalledWith("openai");
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(current.config.provider.type).toBe("anthropic");
  });
  it("uses existing Vertex ADC and preserves explicitly selected project/location", async () => {
    io.adc.mockResolvedValue({ status: "ok", token: "test-adc-token" });
    io.select.mockResolvedValueOnce("gcloud").mockResolvedValueOnce("use");
    io.text.mockResolvedValueOnce("project-one").mockResolvedValueOnce("europe-west1");
    const current = session();
    await providerCommand.execute(["vertex"], current);
    expect(io.login).not.toHaveBeenCalled();
    expect(io.create).toHaveBeenCalledWith("vertex", {
      model: "remembered-model",
      project: "project-one",
      location: "europe-west1",
    });
    expect(current.config.provider).toMatchObject({
      type: "vertex",
      project: "project-one",
      location: "europe-west1",
      authMethod: "gcloud",
    });
  });
  it("does not switch Vertex when gcloud is unavailable", async () => {
    io.select.mockResolvedValue("gcloud");
    io.installed.mockResolvedValue(false);
    const current = session();
    await providerCommand.execute(["vertex"], current);
    expect(current.config.provider.type).toBe("anthropic");
    expect(io.create).not.toHaveBeenCalled();
  });
  it("validates Vertex fallback before using and persisting its model", async () => {
    io.adc.mockResolvedValue({ status: "ok", token: "test-adc-token" });
    io.select.mockResolvedValueOnce("gcloud").mockResolvedValueOnce("use");
    io.text.mockResolvedValueOnce("project-one").mockResolvedValueOnce("global");
    io.create
      .mockResolvedValueOnce({ isAvailable: vi.fn(async () => false) })
      .mockResolvedValueOnce({ isAvailable: vi.fn(async () => true) });
    const current = session();
    await providerCommand.execute(["vertex"], current);
    expect(current.config.provider.model).toBe("gemini-2.5-pro");
    expect(current.pendingProvider?.instance).toBe(await io.create.mock.results[1]!.value);
    expect(io.preference).toHaveBeenCalledWith(
      "vertex",
      "gemini-2.5-pro",
      expect.objectContaining({ project: "project-one" }),
    );
  });
  it("cancelled Vertex project prompt never commits configuration", async () => {
    io.adc.mockResolvedValue({ status: "ok", token: "test-adc-token" });
    io.select.mockResolvedValueOnce("gcloud").mockResolvedValueOnce("use");
    io.text.mockResolvedValue(Symbol("cancel"));
    const current = session();
    await providerCommand.execute(["vertex"], current);
    expect(current.config.provider.type).toBe("anthropic");
    expect(io.preference).not.toHaveBeenCalled();
    expect(io.create).not.toHaveBeenCalled();
  });
  it("failed ADC account revocation stops the switch before login", async () => {
    io.adc.mockResolvedValue({ status: "ok", token: "test-adc-token" });
    io.select.mockResolvedValueOnce("gcloud").mockResolvedValueOnce("switch");
    io.revoke.mockResolvedValue(false);
    const current = session();
    await providerCommand.execute(["vertex"], current);
    expect(io.revoke).toHaveBeenCalledOnce();
    expect(io.login).not.toHaveBeenCalled();
    expect(current.config.provider.type).toBe("anthropic");
  });
  it("completes explicit ADC login only after verifying refreshed credentials", async () => {
    io.select.mockResolvedValue("gcloud");
    io.adc
      .mockResolvedValueOnce({ status: "missing", token: null })
      .mockResolvedValueOnce({ status: "missing", token: null })
      .mockResolvedValueOnce({ status: "ok", token: "test-adc-token" });
    io.confirm.mockResolvedValue(true);
    io.login.mockResolvedValue(true);
    io.text.mockResolvedValueOnce("project-one").mockResolvedValueOnce("global");
    const current = session();
    await providerCommand.execute(["vertex"], current);
    expect(io.login).toHaveBeenCalledOnce();
    expect(io.adc).toHaveBeenCalledTimes(3);
    expect(current.config.provider.type).toBe("vertex");
  });
  it("cancelled credential persistence leaves active provider and process credentials untouched", async () => {
    io.save.mockResolvedValue(false);
    const current = session(),
      before = structuredClone(current.config);
    await providerCommand.execute(["groq"], current);
    expect(current.config).toEqual(before);
    expect(current.pendingProvider).toBeUndefined();
    expect(process.env.GROQ_API_KEY).toBe("");
    expect(io.create).toHaveBeenCalledWith(
      "groq",
      expect.objectContaining({ apiKey: "test-key-not-a-secret" }),
    );
  });
  it("failed credential validation does not install the candidate key in process.env", async () => {
    io.create.mockResolvedValue({ isAvailable: vi.fn(async () => false) });
    const current = session();
    await providerCommand.execute(["groq"], current);
    expect(process.env.GROQ_API_KEY).toBe("");
    expect(io.save).not.toHaveBeenCalled();
  });
});
