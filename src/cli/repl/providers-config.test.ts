import { describe, expect, it } from "vitest";
import { getProviderDefinition, getRecommendedModel } from "./providers-config.js";

describe("providers-config (vertex)", () => {
  it("uses a stable Vertex model as recommended", () => {
    const recommended = getRecommendedModel("vertex");
    expect(recommended?.id).toBe("gemini-3.5-flash");
  });

  it("keeps only models verified on the Google Cloud platform", () => {
    const vertex = getProviderDefinition("vertex");
    const previewIds = vertex.models
      .filter((model) => model.id.includes("preview"))
      .map((model) => model.id);

    expect(previewIds).toEqual([]);
    expect(vertex.models.some((model) => model.id === "gemini-3.8-flash")).toBe(true);
    expect(vertex.models.some((model) => model.id === "gemini-2.5-pro")).toBe(false);
    expect(getRecommendedModel("vertex")?.id).not.toContain("preview");
  });
});
