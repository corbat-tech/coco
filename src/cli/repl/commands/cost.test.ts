/**
 * Tests for /cost command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReplSession } from "../types.js";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => s,
    cyan: { bold: (s: string) => s },
    bold: (s: string) => s,
  },
}));

describe("costCommand", () => {
  let mockSession: ReplSession;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Reset module to reset token tracking state
    vi.resetModules();

    mockSession = {
      id: "test-session",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      config: {
        provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
        ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100 },
        agent: { systemPrompt: "test", maxToolIterations: 25, confirmDestructive: true },
      },
      trustedTools: new Set(),
    };
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("metadata", () => {
    it("should have correct name", async () => {
      const { costCommand } = await import("./cost.js");
      expect(costCommand.name).toBe("cost");
    });

    it("should have tokens and usage aliases", async () => {
      const { costCommand } = await import("./cost.js");
      expect(costCommand.aliases).toContain("tokens");
      expect(costCommand.aliases).toContain("usage");
    });

    it("should have description", async () => {
      const { costCommand } = await import("./cost.js");
      expect(costCommand.description).toContain("token usage");
    });
  });

  describe("execute", () => {
    it("should display session usage header", async () => {
      const { costCommand } = await import("./cost.js");

      await costCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Session Usage");
    });

    it("should display model name", async () => {
      const { costCommand } = await import("./cost.js");

      await costCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("claude-sonnet-4-20250514");
    });

    it("should display token counts", async () => {
      const { costCommand } = await import("./cost.js");

      await costCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Input:");
      expect(allOutput).toContain("Output:");
      expect(allOutput).toContain("Total:");
    });

    it("should display estimated cost", async () => {
      const { costCommand } = await import("./cost.js");

      await costCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Estimated cost");
      expect(allOutput).toContain("$");
    });

    it("should return false (do not exit)", async () => {
      const { costCommand } = await import("./cost.js");
      const result = await costCommand.execute([], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("token tracking utilities", () => {
    it("should add token usage", async () => {
      const { addTokenUsage, getTokenUsage } = await import("./cost.js");

      addTokenUsage(100, 50);

      const usage = getTokenUsage();
      expect(usage.input).toBe(100);
      expect(usage.output).toBe(50);
    });

    it("should accumulate token usage", async () => {
      const { addTokenUsage, getTokenUsage } = await import("./cost.js");

      addTokenUsage(100, 50);
      addTokenUsage(200, 100);

      const usage = getTokenUsage();
      expect(usage.input).toBe(300);
      expect(usage.output).toBe(150);
    });

    it("should reset token usage", async () => {
      const { addTokenUsage, resetTokenUsage, getTokenUsage } = await import("./cost.js");

      addTokenUsage(100, 50);
      resetTokenUsage();

      const usage = getTokenUsage();
      expect(usage.input).toBe(0);
      expect(usage.output).toBe(0);
    });

    it("should return copy of token usage (immutable)", async () => {
      const { addTokenUsage, getTokenUsage } = await import("./cost.js");

      addTokenUsage(100, 50);
      const usage1 = getTokenUsage();
      const usage2 = getTokenUsage();

      expect(usage1).not.toBe(usage2);
      expect(usage1).toEqual(usage2);
    });
  });
});
