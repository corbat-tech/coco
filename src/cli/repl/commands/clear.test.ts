/**
 * Tests for /clear command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearCommand } from "./clear.js";
import type { ReplSession } from "../types.js";

// Mock chalk to avoid color codes in tests
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => s,
    cyan: (s: string) => s,
    green: (s: string) => s,
  },
}));

// Mock clearSession from session.js
vi.mock("../session.js", () => ({
  clearSession: vi.fn(),
}));

describe("clearCommand", () => {
  let mockSession: ReplSession;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSession = {
      id: "test-session",
      startedAt: new Date(),
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ],
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
      expect(clearCommand.name).toBe("clear");
    });

    it("should have aliases", () => {
      expect(clearCommand.aliases).toContain("c");
    });

    it("should have description", () => {
      expect(clearCommand.description).toBe("Clear conversation history");
    });

    it("should have usage", () => {
      expect(clearCommand.usage).toBe("/clear");
    });
  });

  describe("execute", () => {
    it("should call clearSession", async () => {
      const { clearSession } = await import("../session.js");

      await clearCommand.execute([], mockSession);

      expect(clearSession).toHaveBeenCalledWith(mockSession);
    });

    it("should log confirmation message", async () => {
      await clearCommand.execute([], mockSession);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Conversation cleared"));
    });

    it("should return false (do not exit)", async () => {
      const result = await clearCommand.execute([], mockSession);

      expect(result).toBe(false);
    });

    it("should ignore any arguments", async () => {
      const { clearSession } = await import("../session.js");

      await clearCommand.execute(["ignored", "args"], mockSession);

      expect(clearSession).toHaveBeenCalledWith(mockSession);
    });
  });
});
