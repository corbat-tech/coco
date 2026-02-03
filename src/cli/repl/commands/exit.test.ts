/**
 * Tests for /exit command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exitCommand } from "./exit.js";
import type { ReplSession } from "../types.js";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => s,
  },
}));

describe("exitCommand", () => {
  let mockSession: ReplSession;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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
    it("should have correct name", () => {
      expect(exitCommand.name).toBe("exit");
    });

    it("should have quit and q aliases", () => {
      expect(exitCommand.aliases).toContain("quit");
      expect(exitCommand.aliases).toContain("q");
    });

    it("should have description", () => {
      expect(exitCommand.description).toBe("Exit the REPL");
    });

    it("should have usage", () => {
      expect(exitCommand.usage).toBe("/exit");
    });
  });

  describe("execute", () => {
    it("should return true (signal to exit)", async () => {
      const result = await exitCommand.execute([], mockSession);

      expect(result).toBe(true);
    });

    it("should log goodbye message", async () => {
      await exitCommand.execute([], mockSession);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Goodbye"));
    });

    it("should work without session parameter", async () => {
      const result = await exitCommand.execute([], mockSession);

      expect(result).toBe(true);
    });
  });
});
