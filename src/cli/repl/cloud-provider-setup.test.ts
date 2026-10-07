import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({
  text: vi.fn(),
  select: vi.fn(),
  password: vi.fn(),
  create: vi.fn(),
  available: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  text: io.text,
  select: io.select,
  password: io.password,
  isCancel: (value: unknown) => typeof value === "symbol",
}));
vi.mock("../../providers/index.js", () => ({ createProvider: io.create }));
vi.mock("../../config/env.js", () => ({ getApiKey: () => undefined, getBaseUrl: () => undefined }));
import { setupCloudProvider } from "./cloud-provider-setup.js";

beforeEach(() => {
  vi.resetAllMocks();
  io.available.mockResolvedValue(true);
  io.create.mockResolvedValue({ isAvailable: io.available });
});
describe("cloud onboarding", () => {
  it("carries Azure deployment and explicit identity selection into the tested adapter", async () => {
    io.text
      .mockResolvedValueOnce("https://resource.openai.azure.com")
      .mockResolvedValueOnce("deployment");
    io.select.mockResolvedValueOnce("chain").mockResolvedValueOnce("gpt-6.1-sol");
    const result = await setupCloudProvider("azure-openai");
    expect(io.create).toHaveBeenCalledWith(
      "azure-openai",
      expect.objectContaining({ deployment: "deployment", cloudAuth: "identity", apiKey: "" }),
    );
    expect(result).toMatchObject({ cloudAuth: "identity", model: "gpt-6.1-sol" });
  });
  it("explicit API authentication overrides previous ambient identity preferences", async () => {
    io.text.mockResolvedValue("us-east-1");
    io.select.mockResolvedValueOnce("key").mockResolvedValueOnce("anthropic.claude-sonnet-5-5");
    io.password.mockResolvedValue("fixture");
    await setupCloudProvider("bedrock");
    expect(io.create).toHaveBeenCalledWith(
      "bedrock",
      expect.objectContaining({ region: "us-east-1", cloudAuth: "api-key", apiKey: "fixture" }),
    );
  });
  it("does not construct an adapter after cancellation", async () => {
    io.text.mockResolvedValue(Symbol("cancel"));
    expect(await setupCloudProvider("bedrock")).toBeNull();
    expect(io.create).not.toHaveBeenCalled();
  });
  it("rejects unavailable models before committing the configuration", async () => {
    io.text.mockResolvedValue("us-east-1");
    io.select.mockResolvedValueOnce("chain").mockResolvedValueOnce("anthropic.claude-sonnet-5-5");
    io.available.mockResolvedValue(false);
    await expect(setupCloudProvider("bedrock")).rejects.toThrow(/unavailable/);
  });
});
