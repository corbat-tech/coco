import { beforeEach, describe, expect, it, vi } from "vitest";
import { evalsCommand } from "./evals.js";
import type { ReplSession } from "../types.js";

vi.mock("chalk", () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
  },
}));

function makeSession(): ReplSession {
  return {
    id: "test",
    startedAt: new Date(),
    messages: [],
    projectPath: "/tmp/project",
    config: {
      provider: { type: "anthropic", model: "claude-sonnet-4-6", maxTokens: 8192 },
      ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100, showDiff: "on_request" },
      agent: { systemPrompt: "test", maxToolIterations: 10, confirmDestructive: true },
    },
    trustedTools: new Set(),
  };
}

describe("evalsCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("runs default evals", async () => {
    const result = await evalsCommand.execute(["run"], makeSession());

    expect(result).toBe(false);
  });

  it("rejects unknown subcommands", async () => {
    const result = await evalsCommand.execute(["bad"], makeSession());

    expect(result).toBe(false);
  });
});
