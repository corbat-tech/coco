/**
 * Tests for manage_permissions tool
 */

import { describe, it, expect } from "vitest";
import {
  getRiskLevel,
  getRiskDescription,
  getEffectDescription,
  managePermissionsTool,
} from "./permissions.js";

describe("getRiskLevel", () => {
  it("should return 'high' for DENY patterns", () => {
    expect(getRiskLevel("bash:sudo")).toBe("high");
    expect(getRiskLevel("bash:git:push")).toBe("high");
    expect(getRiskLevel("bash:git:rebase")).toBe("high");
    expect(getRiskLevel("bash:docker:push")).toBe("high");
    expect(getRiskLevel("bash:kubectl:delete")).toBe("high");
    expect(getRiskLevel("bash:npm:publish")).toBe("high");
    expect(getRiskLevel("bash:eval")).toBe("high");
  });

  it("should return 'medium' for ASK patterns", () => {
    expect(getRiskLevel("delete_file")).toBe("medium");
    expect(getRiskLevel("git_push")).toBe("medium");
    expect(getRiskLevel("bash:curl")).toBe("medium");
    expect(getRiskLevel("bash:rm")).toBe("medium");
    expect(getRiskLevel("bash:docker:exec")).toBe("medium");
    expect(getRiskLevel("bash:aws:s3")).toBe("medium");
  });

  it("should return 'low' for GLOBAL (read-only) patterns", () => {
    expect(getRiskLevel("read_file")).toBe("low");
    expect(getRiskLevel("glob")).toBe("low");
    expect(getRiskLevel("bash:cat")).toBe("low");
    expect(getRiskLevel("bash:git:status")).toBe("low");
    expect(getRiskLevel("bash:ls")).toBe("low");
  });

  it("should return 'low' for PROJECT (write+build) patterns", () => {
    expect(getRiskLevel("write_file")).toBe("low");
    expect(getRiskLevel("edit_file")).toBe("low");
    expect(getRiskLevel("bash:npm:install")).toBe("low");
    expect(getRiskLevel("bash:git:commit")).toBe("low");
  });

  it("should return 'unknown' for unrecognized patterns", () => {
    expect(getRiskLevel("some_custom_tool")).toBe("unknown");
    expect(getRiskLevel("bash:mycommand")).toBe("unknown");
    expect(getRiskLevel("bash:custom:subcommand")).toBe("unknown");
  });
});

describe("getRiskDescription", () => {
  it("should return descriptive string for each risk level", () => {
    expect(getRiskDescription("bash:git:push")).toContain("HIGH");
    expect(getRiskDescription("bash:curl")).toContain("MEDIUM");
    expect(getRiskDescription("read_file")).toContain("LOW");
    expect(getRiskDescription("unknown_tool")).toContain("UNKNOWN");
  });
});

describe("getEffectDescription", () => {
  it("should describe allow effect without scope", () => {
    const result = getEffectDescription("allow", "bash:npm:install");
    expect(result).toContain("auto-approve");
    expect(result).toContain("bash:npm:install");
  });

  it("should describe deny effect without scope", () => {
    const result = getEffectDescription("deny", "bash:git:push");
    expect(result).toContain("confirmation");
    expect(result).toContain("bash:git:push");
  });

  it("should describe ask effect (same as deny)", () => {
    const result = getEffectDescription("ask", "bash:rm");
    expect(result).toContain("confirmation");
    expect(result).toContain("bash:rm");
  });

  it("should include project scope label", () => {
    const result = getEffectDescription("deny", "bash:git:push", "project");
    expect(result).toContain("this project");
  });

  it("should include global scope label", () => {
    const result = getEffectDescription("allow", "bash:cat", "global");
    expect(result).toContain("all projects");
  });
});

describe("managePermissionsTool", () => {
  it("should have correct name and category", () => {
    expect(managePermissionsTool.name).toBe("manage_permissions");
    expect(managePermissionsTool.category).toBe("config");
  });

  it("should execute allow action and return changes with risk info", async () => {
    const result = await managePermissionsTool.execute({
      action: "allow",
      patterns: ["bash:npm:install"],
      reason: "Speed up dependency management",
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.pattern).toBe("bash:npm:install");
    expect(result.changes[0]!.action).toBe("allow");
    expect(result.changes[0]!.risk).toContain("LOW");
    expect(result.changes[0]!.effect).toContain("auto-approve");
    expect(result.summary).toContain("auto-approve");
    expect(result.summary).toContain("bash:npm:install");
  });

  it("should execute deny action and return changes with risk info", async () => {
    const result = await managePermissionsTool.execute({
      action: "deny",
      patterns: ["bash:git:push"],
      reason: "Prevent accidental pushes",
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.pattern).toBe("bash:git:push");
    expect(result.changes[0]!.action).toBe("deny");
    expect(result.changes[0]!.risk).toContain("HIGH");
    expect(result.changes[0]!.effect).toContain("confirmation");
    expect(result.summary).toContain("confirmation");
  });

  it("should handle multiple patterns in one call", async () => {
    const result = await managePermissionsTool.execute({
      action: "deny",
      patterns: ["bash:git:push", "bash:git:rebase", "bash:git:reset"],
    });

    expect(result.changes).toHaveLength(3);
    expect(result.changes.every((c) => c.action === "deny")).toBe(true);
    expect(result.changes.every((c) => c.risk.includes("HIGH"))).toBe(true);
  });

  it("should include reason in summary when provided", async () => {
    const result = await managePermissionsTool.execute({
      action: "allow",
      patterns: ["bash:cat"],
      reason: "Read-only, safe everywhere",
    });

    expect(result.summary).toContain("Read-only, safe everywhere");
  });

  it("should work without reason", async () => {
    const result = await managePermissionsTool.execute({
      action: "deny",
      patterns: ["bash:rm"],
    });

    expect(result.summary).not.toContain("undefined");
    expect(result.changes[0]!.risk).toContain("MEDIUM");
  });

  // Scope tests
  it("should default to project scope", async () => {
    const result = await managePermissionsTool.execute({
      action: "deny",
      patterns: ["bash:git:commit"],
    });

    expect(result.summary).toContain("(project)");
    expect(result.changes[0]!.effect).toContain("this project");
  });

  it("should accept global scope", async () => {
    const result = await managePermissionsTool.execute({
      action: "allow",
      patterns: ["bash:npm:install"],
      scope: "global",
    });

    expect(result.summary).toContain("(global)");
    expect(result.changes[0]!.effect).toContain("all projects");
  });

  it("should accept project scope explicitly", async () => {
    const result = await managePermissionsTool.execute({
      action: "deny",
      patterns: ["bash:git:push"],
      scope: "project",
    });

    expect(result.summary).toContain("(project)");
    expect(result.changes[0]!.effect).toContain("this project");
  });

  it("should show correct effect for global deny", async () => {
    const result = await managePermissionsTool.execute({
      action: "deny",
      patterns: ["bash:rm"],
      scope: "global",
    });

    expect(result.changes[0]!.effect).toContain("all projects");
    expect(result.summary).toContain("(global)");
  });
});
