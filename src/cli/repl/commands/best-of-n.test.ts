import { beforeEach, describe, expect, it, vi } from "vitest";
import { bestOfNCommand } from "./best-of-n.js";
import type { ReplSession } from "../types.js";

vi.mock("chalk", () => ({
  default: {
    magenta: Object.assign((s: string) => s, { bold: (s: string) => s }),
    yellow: Object.assign((s: string) => s, { dim: (s: string) => s }),
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

describe("bestOfNCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("queues a directive instead of running placeholder execution", async () => {
    const session = makeSession();
    const result = await bestOfNCommand.execute(["3", "fix", "providers"], session);

    expect(result).toBe(false);
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]?.content).toContain("[best-of-n directive]");
    expect(session.messages[0]?.content).toContain("Do not claim attempts were executed");
  });

  it("shows usage for missing task", async () => {
    const session = makeSession();
    const result = await bestOfNCommand.execute([], session);

    expect(result).toBe(false);
    expect(session.messages).toHaveLength(0);
  });
});
