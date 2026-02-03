/**
 * Tests for /status command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { statusCommand } from "./status.js";
import type { ReplSession } from "../types.js";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => s,
    cyan: { bold: (s: string) => s },
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    white: (s: string) => s,
    gray: (s: string) => s,
  },
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("statusCommand", () => {
  let mockSession: ReplSession;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSession = {
      id: "test-session",
      startedAt: new Date("2026-02-02T10:00:00Z"),
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
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
      expect(statusCommand.name).toBe("status");
    });

    it("should have s alias", () => {
      expect(statusCommand.aliases).toContain("s");
    });

    it("should have description", () => {
      expect(statusCommand.description).toContain("status");
    });
  });

  describe("execute", () => {
    it("should display project path", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("main");

      await statusCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("/test/project");
    });

    it("should display model name", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("main");

      await statusCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("claude-sonnet-4-20250514");
    });

    it("should display message count", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("main");

      await statusCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("2");
    });

    it("should display git branch", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync)
        .mockReturnValueOnce("") // git status --short
        .mockReturnValueOnce("feature-branch"); // git branch --show-current

      await statusCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("feature-branch");
    });

    it("should display clean working tree when no changes", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync)
        .mockReturnValueOnce("") // git status --short (empty)
        .mockReturnValueOnce("main"); // git branch

      await statusCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Clean working tree");
    });

    it("should display git changes", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync)
        .mockReturnValueOnce("M  file1.ts\nA  file2.ts\n?? file3.ts") // git status
        .mockReturnValueOnce("main"); // git branch

      await statusCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("file1.ts");
      expect(allOutput).toContain("file2.ts");
    });

    it("should truncate long git status", async () => {
      const { execSync } = await import("node:child_process");
      const manyFiles = Array(15).fill(0).map((_, i) => `M  file${i}.ts`).join("\n");
      vi.mocked(execSync)
        .mockReturnValueOnce(manyFiles)
        .mockReturnValueOnce("main");

      await statusCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("more");
    });

    it("should return false (do not exit)", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue("main");

      const result = await statusCommand.execute([], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should handle non-git repository", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not a git repository");
      });

      await statusCommand.execute([], mockSession);

      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(allOutput).toContain("Not a git repository");
    });
  });
});
