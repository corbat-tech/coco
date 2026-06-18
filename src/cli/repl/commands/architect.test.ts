import { beforeEach, describe, expect, it, vi } from "vitest";
import { architectCommand } from "./architect.js";
import { buildFromPlanCommand } from "./build-from-plan.js";
import type { ReplSession } from "../types.js";

vi.mock("chalk", () => ({
  default: {
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
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

describe("architect workflow commands", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("starts architect mode as read-only plan mode", async () => {
    const session = makeSession();
    await architectCommand.execute(["modernize", "providers"], session);

    expect(session.agentMode).toBe("architect");
    expect(session.planMode).toBe(true);
    expect(session.messages[0]?.content).toContain("[ARCHITECT MODE]");
  });

  it("builds from a pending plan", async () => {
    const session = makeSession();
    session.pendingPlan = "1. Edit provider\n2. Run tests";
    session.planMode = true;
    session.agentMode = "architect";

    await buildFromPlanCommand.execute([], session);

    expect(session.pendingPlan).toBeNull();
    expect(session.planMode).toBe(false);
    expect(session.agentMode).toBe("build");
    expect(session.messages[0]?.content).toContain("[EDITOR MODE]");
  });
});
