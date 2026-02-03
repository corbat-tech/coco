/**
 * Tests for /compact command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReplSession } from "../types.js";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => s,
  },
}));

describe("compactCommand", () => {
  let mockSession: ReplSession;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Reset module to reset compactMode state
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
      const { compactCommand } = await import("./compact.js");
      expect(compactCommand.name).toBe("compact");
    });

    it("should have empty aliases", async () => {
      const { compactCommand } = await import("./compact.js");
      expect(compactCommand.aliases).toEqual([]);
    });

    it("should have description", async () => {
      const { compactCommand } = await import("./compact.js");
      expect(compactCommand.description).toContain("compact mode");
    });
  });

  describe("execute", () => {
    it("should toggle compact mode on", async () => {
      const { compactCommand, isCompactMode } = await import("./compact.js");

      // Initially off
      expect(isCompactMode()).toBe(false);

      await compactCommand.execute([], mockSession);

      expect(isCompactMode()).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("ON"));
    });

    it("should toggle compact mode off", async () => {
      const { compactCommand, isCompactMode } = await import("./compact.js");

      // Turn on first
      await compactCommand.execute([], mockSession);
      expect(isCompactMode()).toBe(true);

      // Toggle off
      await compactCommand.execute([], mockSession);
      expect(isCompactMode()).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("OFF"));
    });

    it("should return false (do not exit)", async () => {
      const { compactCommand } = await import("./compact.js");
      const result = await compactCommand.execute([], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("isCompactMode", () => {
    it("should return current compact mode state", async () => {
      const { compactCommand, isCompactMode } = await import("./compact.js");

      expect(isCompactMode()).toBe(false);
      await compactCommand.execute([], mockSession);
      expect(isCompactMode()).toBe(true);
    });
  });
});
