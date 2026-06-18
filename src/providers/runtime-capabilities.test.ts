import { describe, expect, it } from "vitest";
import {
  getProviderRuntimeCapability,
  probeProviderRuntimeCapability,
} from "./runtime-capabilities.js";

describe("provider runtime capabilities", () => {
  it("routes OpenAI reasoning models through Responses API", () => {
    const cap = getProviderRuntimeCapability("openai", "gpt-5.4");

    expect(cap.endpoint).toBe("openai-responses");
    expect(cap.supportsReasoning).toBe(true);
    expect(cap.supportsToolUse).toBe(true);
    expect(cap.reasoningKinds).toContain("effort");
  });

  it("keeps Copilot GPT models on chat and documents reasoning/tool restriction", () => {
    const cap = getProviderRuntimeCapability("copilot", "gpt-5.4");

    expect(cap.endpoint).toBe("openai-chat");
    expect(cap.supportsToolUse).toBe(true);
    expect(cap.supportsReasoning).toBe(false);
    expect(cap.restrictions.join("\n")).toContain("omits reasoning_effort on tool calls");
  });

  it("marks unknown models as unverified without inventing capabilities", () => {
    const cap = getProviderRuntimeCapability("openai", "not-a-real-model");

    expect(cap.status).toBe("unverified");
    expect(cap.endpoint).toBe("openai-chat");
    expect(cap.supportsToolUse).toBe(false);
    expect(cap.contextWindow).toBe(0);
  });

  it("supports optional availability probes", async () => {
    const result = await probeProviderRuntimeCapability(
      "anthropic",
      "claude-sonnet-4-6",
      async () => true,
    );

    expect(result.available).toBe(true);
    expect(result.endpoint).toBe("anthropic-messages");
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
