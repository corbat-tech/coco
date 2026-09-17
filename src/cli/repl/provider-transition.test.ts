import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReplSession, ReplConfig } from "./types.js";
import type { LLMProvider } from "../../providers/types.js";
const io = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn() }));
vi.mock("../../providers/index.js", () => ({ createProvider: io.create }));
vi.mock("../../config/env.js", async (original) => ({
  ...(await original<typeof import("../../config/env.js")>()),
  saveProviderPreference: io.save,
}));
import { activateSessionProvider } from "./provider-transition.js";
import { getInternalProviderId } from "../../config/env.js";

const adapter = () => ({ isAvailable: vi.fn(async () => true) }) as unknown as LLMProvider;
const previous: ReplConfig["provider"] = {
  type: "vertex",
  model: "old",
  project: "project",
  location: "region",
  maxTokens: 8192,
  authMethod: "gcloud",
};
function fixture() {
  const updateProvider = vi.fn();
  const session = {
    config: { provider: { type: "openai", model: "new", maxTokens: 4096, authMethod: "apikey" } },
    runtime: { updateProvider },
  } as unknown as ReplSession;
  return { session, updateProvider };
}
describe("provider host transition", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("OPENAI_CODEX_TOKEN", "ambient-test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("reuses the validated API-key adapter despite ambient OAuth and consumes handoff", async () => {
    const { session, updateProvider } = fixture(),
      validated = adapter();
    session.pendingProvider = {
      instance: validated,
      internalType: "openai",
      userFacingType: "openai",
      model: "new",
    };
    expect(await activateSessionProvider(session, previous, adapter())).toBe(validated);
    expect(io.create).not.toHaveBeenCalled();
    expect(updateProvider).toHaveBeenCalledWith("openai", "new", validated);
    expect(session.pendingProvider).toBeUndefined();
  });
  it("rolls back full previous configuration and persisted choice on model validation failure", async () => {
    const { session, updateProvider } = fixture(),
      old = adapter();
    io.create.mockRejectedValue(new Error("bad model"));
    await expect(activateSessionProvider(session, previous, old)).rejects.toThrow("bad model");
    expect(session.config.provider).toEqual(previous);
    expect(updateProvider).toHaveBeenCalledWith("vertex", "old", old);
    expect(io.save).toHaveBeenCalledWith("vertex", "old", {
      project: "project",
      location: "region",
      authMethod: "gcloud",
    });
  });
  it("rejects unavailable unvalidated models without updating runtime to them", async () => {
    const { session, updateProvider } = fixture();
    io.create.mockResolvedValue({ isAvailable: vi.fn(async () => false) });
    await expect(activateSessionProvider(session, previous, adapter())).rejects.toThrow(
      /unavailable/,
    );
    expect(updateProvider).toHaveBeenCalledTimes(1);
    expect(session.config.provider).toEqual(previous);
  });
  it("reports failed persistence rollback honestly", async () => {
    const { session } = fixture();
    io.create.mockRejectedValue(new Error("bad model"));
    io.save.mockRejectedValue(new Error("disk full"));
    await expect(activateSessionProvider(session, previous, adapter())).rejects.toThrow(
      /saving the previous preference failed/,
    );
    expect(session.config.provider).toEqual(previous);
  });
  it("legacy detection applies only when no explicit authentication method exists", () => {
    expect(getInternalProviderId("openai", "apikey")).toBe("openai");
    expect(getInternalProviderId("openai", "oauth")).toBe("codex");
    expect(getInternalProviderId("openai")).toBe("codex");
  });
});
