import { describe, expect, it } from "vitest";
import { getProviderDefinition, getRecommendedModel } from "./providers-config.js";

describe("providers-config (vertex)", () => {
  it("uses a stable Vertex model as recommended", () => {
    const recommended = getRecommendedModel("vertex");
    expect(recommended?.id).toBe("gemini-2.5-pro");
  });

  it("keeps preview Vertex models available but not default", () => {
    const vertex = getProviderDefinition("vertex");
    const previewIds = vertex.models
      .filter((model) => model.id.includes("preview"))
      .map((model) => model.id);

    expect(previewIds).toContain("gemini-3-pro-preview");
    expect(previewIds).toContain("gemini-3-flash-preview");
    expect(getRecommendedModel("vertex")?.id).not.toContain("preview");
  });
});
