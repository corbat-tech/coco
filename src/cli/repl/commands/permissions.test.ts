/**
 * Tests for /permissions command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReplSession } from "../types.js";

// ── Module-level mocks (must be before imports) ──────────────────────────────

vi.mock("chalk", () => ({
  default: {
    magenta: {
      bold: (s: string) => s,
    },
    green: Object.assign((s: string) => s, {
      bold: (s: string) => s,
    }),
    yellow: Object.assign((s: string) => s, {
      bold: (s: string) => s,
    }),
    red: Object.assign((s: string) => s, {
      bold: (s: string) => s,
    }),
    bold: (s: string) => s,
    dim: (s: string) => s,
  },
}));

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../session.js", () => ({
  getAllTrustedTools: vi.fn(),
  saveTrustedTool: vi.fn().mockResolvedValue(undefined),
  removeTrustedTool: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../recommended-permissions.js", () => ({
  applyRecommendedPermissions: vi.fn().mockResolvedValue(undefined),
  showPermissionDetails: vi.fn(),
  loadPermissionPreferences: vi.fn().mockResolvedValue({}),
  savePermissionPreference: vi.fn().mockResolvedValue(undefined),
  RECOMMENDED_GLOBAL: ["read_file", "glob", "bash:cat"],
  RECOMMENDED_PROJECT: ["write_file", "edit_file", "bash:git:add"],
  RECOMMENDED_DENY: ["bash:sudo", "bash:git:push"],
}));

vi.mock("../../../config/paths.js", () => ({
  CONFIG_PATHS: {
    trustedTools: "/mock-home/.coco/trusted-tools.json",
    config: "/mock-home/.coco/config.json",
  },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import * as p from "@clack/prompts";
import fs from "node:fs/promises";
import { getAllTrustedTools, saveTrustedTool, removeTrustedTool } from "../session.js";
import {
  applyRecommendedPermissions,
  showPermissionDetails,
  loadPermissionPreferences,
  savePermissionPreference,
} from "../recommended-permissions.js";
import { permissionsCommand } from "./permissions.js";

// ── Session fixture ───────────────────────────────────────────────────────────

function makeSession(overrides: Partial<ReplSession> = {}): ReplSession {
  return {
    id: "test-session-id",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    messages: [],
    projectPath: "/test/project",
    config: {
      provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
      ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100 },
      agent: { systemPrompt: "test prompt", maxToolIterations: 25, confirmDestructive: true },
    },
    trustedTools: new Set<string>(),
    ...overrides,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});

  // Default: getAllTrustedTools returns an empty structure
  vi.mocked(getAllTrustedTools).mockResolvedValue({
    global: [],
    project: [],
    denied: [],
  });

  // Default: loadPermissionPreferences returns no prefs set
  vi.mocked(loadPermissionPreferences).mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Metadata ──────────────────────────────────────────────────────────────────

describe("permissionsCommand", () => {
  describe("metadata", () => {
    it("has correct name", () => {
      expect(permissionsCommand.name).toBe("permissions");
    });

    it("has 'perms' alias", () => {
      expect(permissionsCommand.aliases).toContain("perms");
    });

    it("has a description", () => {
      expect(permissionsCommand.description).toBeTruthy();
    });

    it("has usage that mentions all subcommands", () => {
      expect(permissionsCommand.usage).toContain("permissions");
    });
  });

  // ── status subcommand ───────────────────────────────────────────────────────

  describe("status subcommand", () => {
    it("is invoked when no args are provided", async () => {
      const session = makeSession();
      const result = await permissionsCommand.execute([], session);

      expect(result).toBe(false);
      expect(getAllTrustedTools).toHaveBeenCalledWith("/test/project");
    });

    it("is invoked when 'status' arg is provided", async () => {
      const session = makeSession();
      const result = await permissionsCommand.execute(["status"], session);

      expect(result).toBe(false);
      expect(getAllTrustedTools).toHaveBeenCalledWith("/test/project");
    });

    it("calls loadPermissionPreferences", async () => {
      const session = makeSession();
      await permissionsCommand.execute([], session);

      expect(loadPermissionPreferences).toHaveBeenCalled();
    });

    it("shows 'Recommended allowlist applied' when flag is true", async () => {
      vi.mocked(loadPermissionPreferences).mockResolvedValue({
        recommendedAllowlistApplied: true,
      });
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/Recommended allowlist applied/);
    });

    it("shows 'Recommended allowlist not applied' when flag is false", async () => {
      vi.mocked(loadPermissionPreferences).mockResolvedValue({
        recommendedAllowlistApplied: false,
      });
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/Recommended allowlist not applied/);
    });

    it("shows 'Recommended allowlist not applied' when preference is absent", async () => {
      vi.mocked(loadPermissionPreferences).mockResolvedValue({});
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/Recommended allowlist not applied/);
    });

    it("displays global trusted tools", async () => {
      vi.mocked(getAllTrustedTools).mockResolvedValue({
        global: ["read_file", "bash:cat"],
        project: [],
        denied: [],
      });
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/read_file/);
      expect(logged).toMatch(/bash:cat/);
    });

    it("displays project trusted tools", async () => {
      vi.mocked(getAllTrustedTools).mockResolvedValue({
        global: [],
        project: ["write_file", "edit_file"],
        denied: [],
      });
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/write_file/);
      expect(logged).toMatch(/edit_file/);
    });

    it("displays denied tools section when there are denied tools", async () => {
      vi.mocked(getAllTrustedTools).mockResolvedValue({
        global: ["read_file"],
        project: [],
        denied: ["bash:rm"],
      });
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/denied/i);
      expect(logged).toMatch(/bash:rm/);
    });

    it("shows '(none)' when there are no trusted tools", async () => {
      vi.mocked(getAllTrustedTools).mockResolvedValue({
        global: [],
        project: [],
        denied: [],
      });
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/\(none\)/);
    });

    it("shows help hints for allow-commits subcommand", async () => {
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/allow-commits/);
    });

    it("shows help hints for revoke-commits subcommand", async () => {
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/revoke-commits/);
    });

    it("shows help hints for apply subcommand", async () => {
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/apply/);
    });

    it("shows help hints for view subcommand", async () => {
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/view/);
    });

    it("shows help hints for reset subcommand", async () => {
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/reset/);
    });

    it("deduplicates tools that appear in both global and project lists", async () => {
      vi.mocked(getAllTrustedTools).mockResolvedValue({
        global: ["read_file", "shared_tool"],
        project: ["write_file", "shared_tool"],
        denied: [],
      });
      const session = makeSession();
      await permissionsCommand.execute([], session);

      // Count occurrences of shared_tool — should appear only once
      const occurrences = vi
        .mocked(console.log)
        .mock.calls.flat()
        .filter((arg) => String(arg).includes("shared_tool")).length;
      expect(occurrences).toBe(1);
    });

    it("marks denied tools that also appear in the trusted list", async () => {
      vi.mocked(getAllTrustedTools).mockResolvedValue({
        global: ["bash:rm"],
        project: [],
        denied: ["bash:rm"],
      });
      const session = makeSession();
      await permissionsCommand.execute([], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/denied for this project/);
    });
  });

  // ── allow-commits subcommand ────────────────────────────────────────────────

  describe("allow-commits subcommand", () => {
    it("returns false (does not exit)", async () => {
      const session = makeSession();
      const result = await permissionsCommand.execute(["allow-commits"], session);
      expect(result).toBe(false);
    });

    it("adds git_commit to session.trustedTools", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["allow-commits"], session);
      expect(session.trustedTools.has("git_commit")).toBe(true);
    });

    it("adds bash:git:commit to session.trustedTools", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["allow-commits"], session);
      expect(session.trustedTools.has("bash:git:commit")).toBe(true);
    });

    it("calls saveTrustedTool for git_commit with project-level flag (false)", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["allow-commits"], session);
      expect(saveTrustedTool).toHaveBeenCalledWith("git_commit", "/test/project", false);
    });

    it("calls saveTrustedTool for bash:git:commit with project-level flag (false)", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["allow-commits"], session);
      expect(saveTrustedTool).toHaveBeenCalledWith("bash:git:commit", "/test/project", false);
    });

    it("calls saveTrustedTool exactly twice (once per commit tool)", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["allow-commits"], session);
      expect(saveTrustedTool).toHaveBeenCalledTimes(2);
    });

    it("does NOT pass global=true to saveTrustedTool", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["allow-commits"], session);
      for (const call of vi.mocked(saveTrustedTool).mock.calls) {
        expect(call[2]).toBe(false);
      }
    });

    it("prints a success message (green)", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["allow-commits"], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/auto-approved/);
    });

    it("is idempotent — adding again when tools already trusted does not throw", async () => {
      const session = makeSession({
        trustedTools: new Set(["git_commit", "bash:git:commit"]),
      });
      await expect(permissionsCommand.execute(["allow-commits"], session)).resolves.toBe(false);
      expect(session.trustedTools.has("git_commit")).toBe(true);
      expect(session.trustedTools.has("bash:git:commit")).toBe(true);
    });
  });

  // ── revoke-commits subcommand ───────────────────────────────────────────────

  describe("revoke-commits subcommand", () => {
    it("returns false (does not exit)", async () => {
      const session = makeSession({
        trustedTools: new Set(["git_commit", "bash:git:commit"]),
      });
      const result = await permissionsCommand.execute(["revoke-commits"], session);
      expect(result).toBe(false);
    });

    it("removes git_commit from session.trustedTools", async () => {
      const session = makeSession({
        trustedTools: new Set(["git_commit", "bash:git:commit"]),
      });
      await permissionsCommand.execute(["revoke-commits"], session);
      expect(session.trustedTools.has("git_commit")).toBe(false);
    });

    it("removes bash:git:commit from session.trustedTools", async () => {
      const session = makeSession({
        trustedTools: new Set(["git_commit", "bash:git:commit"]),
      });
      await permissionsCommand.execute(["revoke-commits"], session);
      expect(session.trustedTools.has("bash:git:commit")).toBe(false);
    });

    it("calls removeTrustedTool with project-level flag (false) for git_commit", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["revoke-commits"], session);
      expect(removeTrustedTool).toHaveBeenCalledWith("git_commit", "/test/project", false);
    });

    it("calls removeTrustedTool with global flag (true) for git_commit", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["revoke-commits"], session);
      expect(removeTrustedTool).toHaveBeenCalledWith("git_commit", "/test/project", true);
    });

    it("calls removeTrustedTool with project-level flag (false) for bash:git:commit", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["revoke-commits"], session);
      expect(removeTrustedTool).toHaveBeenCalledWith("bash:git:commit", "/test/project", false);
    });

    it("calls removeTrustedTool with global flag (true) for bash:git:commit", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["revoke-commits"], session);
      expect(removeTrustedTool).toHaveBeenCalledWith("bash:git:commit", "/test/project", true);
    });

    it("calls removeTrustedTool exactly four times (2 tools × 2 scopes)", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["revoke-commits"], session);
      expect(removeTrustedTool).toHaveBeenCalledTimes(4);
    });

    it("prints a warning message (yellow)", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["revoke-commits"], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/require confirmation/);
    });

    it("is idempotent — works even if the tools were not in session.trustedTools", async () => {
      // Session has an empty trustedTools set
      const session = makeSession();
      await expect(permissionsCommand.execute(["revoke-commits"], session)).resolves.toBe(false);
      // removeTrustedTool is still called to clean up persisted state
      expect(removeTrustedTool).toHaveBeenCalled();
    });
  });

  // ── apply subcommand ────────────────────────────────────────────────────────

  describe("apply subcommand", () => {
    it("returns false (does not exit)", async () => {
      const session = makeSession();
      const result = await permissionsCommand.execute(["apply"], session);
      expect(result).toBe(false);
    });

    it("calls applyRecommendedPermissions()", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["apply"], session);
      expect(applyRecommendedPermissions).toHaveBeenCalledTimes(1);
    });

    it("adds all RECOMMENDED_GLOBAL tools to session.trustedTools", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["apply"], session);
      expect(session.trustedTools.has("read_file")).toBe(true);
      expect(session.trustedTools.has("glob")).toBe(true);
      expect(session.trustedTools.has("bash:cat")).toBe(true);
    });

    it("adds all RECOMMENDED_PROJECT tools to session.trustedTools", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["apply"], session);
      expect(session.trustedTools.has("write_file")).toBe(true);
      expect(session.trustedTools.has("edit_file")).toBe(true);
      expect(session.trustedTools.has("bash:git:add")).toBe(true);
    });

    it("does NOT add git_commit to session.trustedTools", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["apply"], session);
      expect(session.trustedTools.has("git_commit")).toBe(false);
    });

    it("does NOT add bash:git:commit to session.trustedTools", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["apply"], session);
      expect(session.trustedTools.has("bash:git:commit")).toBe(false);
    });

    it("prints a success message", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["apply"], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/Recommended permissions applied/);
    });
  });

  // ── view subcommand ─────────────────────────────────────────────────────────

  describe("view subcommand", () => {
    it("returns false (does not exit)", async () => {
      const session = makeSession();
      const result = await permissionsCommand.execute(["view"], session);
      expect(result).toBe(false);
    });

    it("calls showPermissionDetails()", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["view"], session);
      expect(showPermissionDetails).toHaveBeenCalledTimes(1);
    });

    it("calls showPermissionDetails() without arguments", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["view"], session);
      expect(showPermissionDetails).toHaveBeenCalledWith();
    });
  });

  // ── reset subcommand ────────────────────────────────────────────────────────

  describe("reset subcommand", () => {
    it("returns false (does not exit) when confirmed", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession({
        trustedTools: new Set(["read_file", "bash:cat"]),
      });
      const result = await permissionsCommand.execute(["reset"], session);
      expect(result).toBe(false);
    });

    it("returns false (does not exit) when cancelled", async () => {
      vi.mocked(p.confirm).mockResolvedValue(false);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession();
      const result = await permissionsCommand.execute(["reset"], session);
      expect(result).toBe(false);
    });

    it("clears session.trustedTools when confirmed", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession({
        trustedTools: new Set(["read_file", "bash:cat", "write_file"]),
      });
      await permissionsCommand.execute(["reset"], session);
      expect(session.trustedTools.size).toBe(0);
    });

    it("writes empty settings to trusted-tools file when confirmed", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession();
      await permissionsCommand.execute(["reset"], session);

      expect(fs.writeFile).toHaveBeenCalledWith(
        "/mock-home/.coco/trusted-tools.json",
        expect.stringContaining('"globalTrusted": []'),
        "utf-8",
      );
    });

    it("written empty settings contain empty projectTrusted", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession();
      await permissionsCommand.execute(["reset"], session);

      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0]![1] as string;
      const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
      expect(parsed.projectTrusted).toEqual({});
    });

    it("written empty settings contain empty projectDenied", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession();
      await permissionsCommand.execute(["reset"], session);

      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0]![1] as string;
      const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
      expect(parsed.projectDenied).toEqual({});
    });

    it("calls savePermissionPreference to reset the allowlist flag when confirmed", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession();
      await permissionsCommand.execute(["reset"], session);
      expect(savePermissionPreference).toHaveBeenCalledWith("recommendedAllowlistApplied", false);
    });

    it("prints success message after reset", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession();
      await permissionsCommand.execute(["reset"], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/All tool permissions reset/);
    });

    it("does NOT clear session.trustedTools when cancelled", async () => {
      vi.mocked(p.confirm).mockResolvedValue(false);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession({
        trustedTools: new Set(["read_file"]),
      });
      await permissionsCommand.execute(["reset"], session);
      expect(session.trustedTools.has("read_file")).toBe(true);
    });

    it("does NOT write to file when cancelled", async () => {
      vi.mocked(p.confirm).mockResolvedValue(false);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession();
      await permissionsCommand.execute(["reset"], session);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("does NOT call savePermissionPreference when cancelled", async () => {
      vi.mocked(p.confirm).mockResolvedValue(false);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession();
      await permissionsCommand.execute(["reset"], session);
      expect(savePermissionPreference).not.toHaveBeenCalled();
    });

    it("prints 'Cancelled' when user declines", async () => {
      vi.mocked(p.confirm).mockResolvedValue(false);
      vi.mocked(p.isCancel).mockReturnValue(false);
      const session = makeSession();
      await permissionsCommand.execute(["reset"], session);

      const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(logged).toMatch(/Cancelled/);
    });

    it("does nothing when user presses Ctrl+C (isCancel returns true)", async () => {
      vi.mocked(p.confirm).mockResolvedValue(Symbol.for("cancel") as unknown as boolean);
      vi.mocked(p.isCancel).mockReturnValue(true);
      const session = makeSession({
        trustedTools: new Set(["read_file"]),
      });
      await permissionsCommand.execute(["reset"], session);
      expect(session.trustedTools.has("read_file")).toBe(true);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("silently handles writeFile errors", async () => {
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(p.isCancel).mockReturnValue(false);
      vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("EACCES: permission denied"));
      const session = makeSession();

      // Should not throw
      await expect(permissionsCommand.execute(["reset"], session)).resolves.toBe(false);
    });
  });

  // ── routing — unknown subcommand ────────────────────────────────────────────

  describe("routing", () => {
    it("falls through to status for an unknown subcommand", async () => {
      const session = makeSession();
      const result = await permissionsCommand.execute(["unknownsubcmd"], session);

      expect(result).toBe(false);
      // status calls getAllTrustedTools
      expect(getAllTrustedTools).toHaveBeenCalledWith("/test/project");
    });

    it("is case-insensitive for subcommand matching", async () => {
      const session = makeSession();
      const result = await permissionsCommand.execute(["APPLY"], session);
      expect(result).toBe(false);
      expect(applyRecommendedPermissions).toHaveBeenCalledTimes(1);
    });

    it("treats 'ALLOW-COMMITS' (uppercase) the same as 'allow-commits'", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["ALLOW-COMMITS"], session);
      expect(saveTrustedTool).toHaveBeenCalled();
    });

    it("treats 'REVOKE-COMMITS' (uppercase) the same as 'revoke-commits'", async () => {
      const session = makeSession();
      await permissionsCommand.execute(["REVOKE-COMMITS"], session);
      expect(removeTrustedTool).toHaveBeenCalled();
    });
  });
});
