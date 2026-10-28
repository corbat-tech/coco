import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsCommand, parseLiveAgentControl } from "./agents.js";
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
  it("recognizes only bounded host controls during execution", () => {
    expect(parseLiveAgentControl("/agents status")).toEqual(["status"]);
    expect(parseLiveAgentControl("/agents cancel all")).toEqual(["cancel", "all"]);
    expect(parseLiveAgentControl("/agents mode off")).toEqual(["mode", "off"]);
    expect(parseLiveAgentControl("/agents run docs write README")).toBeUndefined();
    expect(parseLiveAgentControl("/agents mode auto")).toBeUndefined();
    expect(parseLiveAgentControl('Explain "/agents cancel all"')).toBeUndefined();
  });
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

    expect(session.messages).toHaveLength(0);
    expect(session.pendingDelegation).toEqual({ type: "explore", task: "inspect providers" });
  });

  it("supports shorthand /agents <role> <task>", async () => {
    const session = makeSession();
    await agentsCommand.execute(["provider-debugger", "fix gpt tools"], session);

    expect(session.pendingDelegation).toEqual({ type: "debug", task: "fix gpt tools" });
  });

  it("persists a mode preference and refuses explicit work when off", async () => {
    const session = makeSession();
    await agentsCommand.execute(["mode", "off"], session);
    await agentsCommand.execute(["run", "review", "Inspect the diff"], session);
    expect(session.config.agent.delegation?.mode).toBe("off");
    expect(session.pendingDelegation).toBeUndefined();
    expect(session.messages).toHaveLength(0);
  });

  it("shows actual session records without inventing active work", async () => {
    const session = makeSession();
    session.delegationHistory = [
      {
        id: "owned-run",
        type: "review",
        task: "Review API",
        status: "failed",
        startedAt: new Date().toISOString(),
        error: "Test failed",
      },
    ];
    await agentsCommand.execute(["status"], session);
    await agentsCommand.execute(["explain", "owned-run"], session);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("owned-run @review failed"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Test failed"));
  });
});
