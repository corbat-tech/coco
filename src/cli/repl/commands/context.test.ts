import { describe, expect, it, vi, beforeEach } from "vitest";
import { contextCommand } from "./context.js";
import type { ReplSession } from "../types.js";

describe("context command", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  function createMockSession(overrides?: Partial<ReplSession>): ReplSession {
    return {
      id: "test",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test",
      config: {
        provider: { type: "openai" as any, model: "gpt-4", maxTokens: 4096 },
        ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100 },
        agent: { systemPrompt: "test", maxToolIterations: 10, confirmDestructive: true },
      },
      trustedTools: new Set(),
      ...overrides,
    };
  }

  it("should have correct metadata", () => {
    expect(contextCommand.name).toBe("context");
    expect(contextCommand.aliases).toContain("ctx");
  });

  it("should warn when context manager is not available", async () => {
    const session = createMockSession();
    await contextCommand.execute([], session);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("not initialized"));
  });

  it("should display message breakdown", async () => {
    const session = createMockSession({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "Do something" },
      ],
      contextManager: { getStats: () => ({ tokensUsed: 1000, contextLimit: 200000 }) } as any,
    });

    await contextCommand.execute([], session);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Total:"));
  });

  it("should not exit the REPL", async () => {
    const session = createMockSession();
    const result = await contextCommand.execute([], session);
    expect(result).toBe(false);
  });
});
