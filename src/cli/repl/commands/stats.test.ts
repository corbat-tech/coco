import { beforeEach, describe, expect, it, vi } from "vitest";
import { statsCommand } from "./stats.js";
import type { ReplSession } from "../types.js";

vi.mock("chalk", () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    yellow: (s: string) => s,
    dim: (s: string) => s,
  },
}));

describe("statsCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("shows session stats", async () => {
    const session: ReplSession = {
      id: "test",
      startedAt: new Date(),
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
      projectPath: "/tmp/project",
      config: {
        provider: { type: "openai", model: "gpt-5.4", maxTokens: 8192 },
        ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100, showDiff: "on_request" },
        agent: { systemPrompt: "test", maxToolIterations: 10, confirmDestructive: true },
      },
      trustedTools: new Set(),
    };

    const result = await statsCommand.execute([], session);

    expect(result).toBe(false);
  });
});
