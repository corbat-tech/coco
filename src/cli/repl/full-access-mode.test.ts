/**
 * Tests for full-access mode
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  isFullAccessMode,
  setFullAccessMode,
  toggleFullAccessMode,
  isDangerousCommand,
  shouldAutoApprove,
  formatDangerousCommandWarning,
} from "./full-access-mode.js";

describe("full-access-mode", () => {
  beforeEach(() => {
    setFullAccessMode(false);
  });

  describe("state management", () => {
    it("should start with full-access mode disabled", () => {
      expect(isFullAccessMode()).toBe(false);
    });

    it("should allow setting full-access mode", () => {
      setFullAccessMode(true);
      expect(isFullAccessMode()).toBe(true);

      setFullAccessMode(false);
      expect(isFullAccessMode()).toBe(false);
    });

    it("should toggle full-access mode", () => {
      const newState = toggleFullAccessMode();
      expect(newState).toBe(true);
      expect(isFullAccessMode()).toBe(true);

      const nextState = toggleFullAccessMode();
      expect(nextState).toBe(false);
      expect(isFullAccessMode()).toBe(false);
    });
  });

  describe("dangerous command detection", () => {
    it("should detect rm -rf commands", () => {
      expect(isDangerousCommand("rm -rf /")).toBe(true);
      expect(isDangerousCommand("rm -rf ~")).toBe(true);
      expect(isDangerousCommand("rm -rf $HOME")).toBe(true);
      expect(isDangerousCommand("sudo rm -rf /var")).toBe(true);
    });

    it("should detect system modification commands", () => {
      expect(isDangerousCommand("shutdown now")).toBe(true);
      expect(isDangerousCommand("reboot")).toBe(true);
    });

    it("should detect npm publish", () => {
      expect(isDangerousCommand("npm publish")).toBe(true);
      expect(isDangerousCommand("pnpm publish")).toBe(true);
    });

    it("should detect git force push to main", () => {
      expect(isDangerousCommand("git push --force origin main")).toBe(true);
      expect(isDangerousCommand("git push -f origin master")).toBe(true);
    });

    it("should allow safe commands", () => {
      expect(isDangerousCommand("npm install")).toBe(false);
      expect(isDangerousCommand("git status")).toBe(false);
      expect(isDangerousCommand("pnpm test")).toBe(false);
      expect(isDangerousCommand("git push origin feature-branch")).toBe(false);
    });
  });

  describe("auto-approve logic", () => {
    const projectCwd = process.cwd();

    it("should not auto-approve when mode is disabled", () => {
      setFullAccessMode(false);
      expect(shouldAutoApprove("npm install", projectCwd)).toBe(false);
    });

    it("should not auto-approve dangerous commands even when enabled", () => {
      setFullAccessMode(true);
      expect(shouldAutoApprove("rm -rf /", projectCwd)).toBe(false);
      expect(shouldAutoApprove("shutdown", projectCwd)).toBe(false);
    });

    it("should auto-approve safe commands within project", () => {
      setFullAccessMode(true);
      expect(shouldAutoApprove("npm test", projectCwd)).toBe(true);
      expect(shouldAutoApprove("git status", projectCwd)).toBe(true);
    });

    it("should not auto-approve commands outside project", () => {
      setFullAccessMode(true);
      expect(shouldAutoApprove("npm test", "/tmp")).toBe(false);
    });
  });

  describe("warning messages", () => {
    it("should format dangerous command warning", () => {
      const warning = formatDangerousCommandWarning("rm -rf /");
      expect(warning).toContain("DANGEROUS COMMAND");
      expect(warning).toContain("rm -rf /");
      expect(warning).toContain("blacklisted");
    });
  });
});
