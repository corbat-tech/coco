/**
 * Tests for /help command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { helpCommand } from "./help.js";
import type { ReplSession } from "../types.js";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => s,
    cyan: { bold: (s: string) => s },
    yellow: (s: string) => s,
    bold: (s: string) => s,
  },
}));

describe("helpCommand", () => {
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
      expect(helpCommand.name).toBe("help");
    });

    it("should have h and ? aliases", () => {
      expect(helpCommand.aliases).toContain("h");
      expect(helpCommand.aliases).toContain("?");
    });

    it("should have description", () => {
      expect(helpCommand.description).toBe("Show available commands");
    });

    it("should have usage", () => {
      expect(helpCommand.usage).toBe("/help");
    });
  });

  describe("execute", () => {
    it("should return false (do not exit)", async () => {
      const result = await helpCommand.execute([], mockSession);

      expect(result).toBe(false);
    });

    it("should display command sections", async () => {
      await helpCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

      // Check for section headers
      expect(allOutput).toContain("Coco Commands");
      expect(allOutput).toContain("General");
      expect(allOutput).toContain("Model & Settings");
      expect(allOutput).toContain("Git");
    });

    it("should display general commands", async () => {
      await helpCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

      expect(allOutput).toContain("/help");
      expect(allOutput).toContain("/clear");
      expect(allOutput).toContain("/exit");
    });

    it("should display model commands", async () => {
      await helpCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

      expect(allOutput).toContain("/model");
      expect(allOutput).toContain("/compact");
      expect(allOutput).toContain("/cost");
    });

    it("should display git commands", async () => {
      await helpCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

      expect(allOutput).toContain("/status");
      expect(allOutput).toContain("/diff");
      expect(allOutput).toContain("/commit");
      expect(allOutput).toContain("/undo");
    });

    it("should display tips section", async () => {
      await helpCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

      expect(allOutput).toContain("Tips");
      expect(allOutput).toContain("Ctrl+D");
    });
  });
});
