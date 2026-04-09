import { describe, expect, it, vi } from "vitest";

vi.mock("./quality-loop.js", () => ({
  isQualityLoop: vi.fn(() => false),
}));

vi.mock("./full-access-mode.js", () => ({
  isFullAccessMode: vi.fn(() => false),
}));

describe("formatStatusBar", () => {
  it("shows the effective model instead of placeholder default", async () => {
    const { formatStatusBar } = await import("./status-bar.js");

    const line = formatStatusBar("/tmp/project", {
      provider: {
        type: "copilot",
        model: "default",
        maxTokens: 8192,
      },
      ui: {
        theme: "auto",
        showTimestamps: false,
        maxHistorySize: 100,
        showDiff: "on_request",
      },
      agent: {
        systemPrompt: "",
        maxToolIterations: 25,
        confirmDestructive: true,
        enableAutoSwitchProvider: false,
      },
    });

    expect(line).toContain("copilot/");
    expect(line).toContain("claude-sonnet-4.6");
    expect(line).not.toContain("copilot/default");
  });
});
