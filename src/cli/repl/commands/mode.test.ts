import { beforeEach, describe, expect, it, vi } from "vitest";
import { modeCommand } from "./mode.js";
import type { ReplSession } from "../types.js";

vi.mock("chalk", () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: (s: string) => s,
    yellow: (s: string) => s,
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

describe("modeCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("lists modes when no args are provided", async () => {
    const session = makeSession();
    const result = await modeCommand.execute([], session);

    expect(result).toBe(false);
    expect(session.agentMode).toBeUndefined();
  });

  it("switches to plan mode and preserves legacy planMode flag", async () => {
    const session = makeSession();
    await modeCommand.execute(["plan"], session);

    expect(session.agentMode).toBe("plan");
    expect(session.planMode).toBe(true);
  });

  it("switches to review mode without enabling legacy plan mode", async () => {
    const session = makeSession();
    await modeCommand.execute(["review"], session);

    expect(session.agentMode).toBe("review");
    expect(session.planMode).toBe(false);
  });

  it("rejects unknown modes", async () => {
    const session = makeSession();
    const result = await modeCommand.execute(["ship"], session);

    expect(result).toBe(false);
    expect(session.agentMode).toBeUndefined();
  });
});
