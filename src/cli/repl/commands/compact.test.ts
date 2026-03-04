/**
 * Tests for /compact command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReplSession } from "../types.js";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => s,
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
}));

describe("compactCommand", () => {
  let mockSession: ReplSession;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();

    mockSession = {
      id: "test-session",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/project",
      config: {
        provider: { type: "anthropic" as any, model: "claude-sonnet-4-20250514", maxTokens: 8192 },
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

    it("should have description about compaction", async () => {
      const { compactCommand } = await import("./compact.js");
      expect(compactCommand.description).toContain("Compact");
    });
  });

  describe("/compact verbose — toggle mode", () => {
    it("should toggle compact mode on", async () => {
      const { compactCommand, isCompactMode } = await import("./compact.js");

      expect(isCompactMode()).toBe(false);
      await compactCommand.execute(["verbose"], mockSession);
      expect(isCompactMode()).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("ON"));
    });

    it("should toggle compact mode off", async () => {
      const { compactCommand, isCompactMode } = await import("./compact.js");

      await compactCommand.execute(["verbose"], mockSession);
      expect(isCompactMode()).toBe(true);

      await compactCommand.execute(["verbose"], mockSession);
      expect(isCompactMode()).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("OFF"));
    });
  });

  describe("/compact — manual compaction", () => {
    it("should warn when context manager not initialized", async () => {
      const { compactCommand } = await import("./compact.js");

      const result = await compactCommand.execute([], mockSession);

      expect(result).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Context manager not initialized"),
      );
    });

    it("should warn when not enough messages", async () => {
      const { compactCommand } = await import("./compact.js");
      mockSession.contextManager = {
        _compactor: {},
        _provider: {},
      } as any;

      const result = await compactCommand.execute([], mockSession);
      expect(result).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Not enough messages"));
    });

    it("should return false (do not exit)", async () => {
      const { compactCommand } = await import("./compact.js");
      const result = await compactCommand.execute([], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("isCompactMode", () => {
    it("should return current compact mode state", async () => {
      const { isCompactMode, compactCommand } = await import("./compact.js");
      expect(isCompactMode()).toBe(false);
      await compactCommand.execute(["verbose"], mockSession);
      expect(isCompactMode()).toBe(true);
    });
  });
});
