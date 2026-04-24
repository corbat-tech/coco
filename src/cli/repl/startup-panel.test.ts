import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./trust-store.js", () => ({
  createTrustStore: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    getLevel: vi.fn().mockReturnValue("write"),
  })),
}));

vi.mock("../../config/env.js", () => ({
  getDefaultModel: vi.fn().mockReturnValue("claude-opus-4-6"),
}));

vi.mock("./quality-loop.js", () => ({
  isQualityLoop: vi.fn().mockReturnValue(false),
}));

vi.mock("./git-context.js", () => ({
  formatGitLine: vi.fn().mockReturnValue("main"),
}));

vi.mock("../../version.js", () => ({
  VERSION: "0.0.0-test",
}));

function makeSession(providerType: string, model: string, thinking?: unknown) {
  return {
    projectPath: "/test/project",
    config: {
      provider: {
        type: providerType,
        model,
        maxTokens: 8192,
        thinking,
      },
    } as any,
  };
}

describe("renderStartupPanel — reasoning hint", () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
  });

  it("shows reasoning hint for a thinking-capable Anthropic model", async () => {
    const { renderStartupPanel } = await import("./startup-panel.js");
    await renderStartupPanel(makeSession("anthropic", "claude-opus-4-6", undefined), null);

    const combined = output.join("\n");
    expect(combined).toContain("🧠 reasoning:");
    expect(combined).toContain("/thinking to change");
  });

  it("shows 'off' when thinking is undefined on a capable model", async () => {
    const { renderStartupPanel } = await import("./startup-panel.js");
    await renderStartupPanel(makeSession("anthropic", "claude-opus-4-6", undefined), null);

    const combined = output.join("\n");
    expect(combined).toContain("off");
  });

  it("shows the active thinking mode when set to 'high'", async () => {
    const { renderStartupPanel } = await import("./startup-panel.js");
    await renderStartupPanel(makeSession("anthropic", "claude-opus-4-6", "high"), null);

    const combined = output.join("\n");
    expect(combined).toContain("high");
  });

  it("does NOT show reasoning hint for an unsupported model (gpt-4o)", async () => {
    const { renderStartupPanel } = await import("./startup-panel.js");
    await renderStartupPanel(makeSession("openai", "gpt-4o", undefined), null);

    const combined = output.join("\n");
    expect(combined).not.toContain("🧠 reasoning:");
  });

  it("does NOT show reasoning hint for legacy claude-3-5-sonnet", async () => {
    const { renderStartupPanel } = await import("./startup-panel.js");
    await renderStartupPanel(
      makeSession("anthropic", "claude-3-5-sonnet-20241022", undefined),
      null,
    );

    const combined = output.join("\n");
    expect(combined).not.toContain("🧠 reasoning:");
  });

  it("shows reasoning hint for Gemini 2.5 Pro with 'auto' mode", async () => {
    const { renderStartupPanel } = await import("./startup-panel.js");
    await renderStartupPanel(makeSession("gemini", "gemini-2.5-pro", "auto"), null);

    const combined = output.join("\n");
    expect(combined).toContain("🧠 reasoning:");
    expect(combined).toContain("auto");
  });
});
