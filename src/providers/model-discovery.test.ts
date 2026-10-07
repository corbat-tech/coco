import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverAggregatorModels } from "./model-discovery.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("live aggregator model discovery", () => {
  it("selects tool-capable text models, deduplicates IDs, and tolerates malformed entries", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "vendor/new",
            name: "New",
            context_length: 100000,
            supported_parameters: ["tools"],
            architecture: { output_modalities: ["text"] },
          },
          {
            id: "image-only",
            supported_parameters: ["tools"],
            architecture: { output_modalities: ["image"] },
          },
          { id: "no-tools", supported_parameters: [] },
          null,
          { id: 123 },
          {
            id: "vendor/new",
            name: "New",
            context_length: 100000,
            supported_parameters: ["tools"],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("OPENROUTER_API_KEY", "fixture");
    expect(await discoverAggregatorModels("openrouter")).toEqual([
      { id: "vendor/new", name: "New", contextWindow: 100000 },
    ]);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/models");
  });
  it("fails back to the static catalog on unavailable or malformed discovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await discoverAggregatorModels("huggingface")).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: "invalid" }) }),
    );
    expect(await discoverAggregatorModels("openrouter")).toEqual([]);
  });
  it("does not send requests for providers without a supported discovery contract", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await discoverAggregatorModels("bedrock")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
