import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsCommand } from "./agents.js";
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

describe("agentsCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("lists available agents", async () => {
    const session = makeSession();
    const result = await agentsCommand.execute([], session);

    expect(result).toBe(false);
    expect(session.messages).toHaveLength(0);
  });

  it("routes aliases to existing agent types", async () => {
    const session = makeSession();
    await agentsCommand.execute(["run", "@researcher", "inspect providers"], session);

    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]?.content).toContain("@explore");
    expect(session.messages[0]?.content).toContain("inspect providers");
  });

  it("supports shorthand /agents <role> <task>", async () => {
    const session = makeSession();
    await agentsCommand.execute(["provider-debugger", "fix gpt tools"], session);

    expect(session.messages[0]?.content).toContain("@debug");
    expect(session.messages[0]?.content).toContain("fix gpt tools");
  });
});
