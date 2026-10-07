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
    expect(getRiskLevel("bash:aws:s3:ls")).toBe("medium");
    // git commit always asks by default; opt in per-project with /permissions allow-commits
    expect(getRiskLevel("git_commit")).toBe("medium");
    expect(getRiskLevel("bash:git:commit")).toBe("medium");
  });

  it("should return 'low' for GLOBAL (read-only) patterns", () => {
    expect(getRiskLevel("read_file")).toBe("low");
    expect(getRiskLevel("glob")).toBe("low");
  });

  it("should return 'low' for PROJECT native write patterns", () => {
    expect(getRiskLevel("write_file")).toBe("low");
    expect(getRiskLevel("edit_file")).toBe("low");
  });

  it("should return 'unknown' for unrecognized patterns", () => {
    expect(getRiskLevel("some_custom_tool")).toBe("unknown");
    expect(getRiskLevel("bash:cat")).toBe("unknown");
    expect(getRiskLevel("bash:git:status")).toBe("unknown");
    expect(getRiskLevel("bash:ls")).toBe("unknown");
    expect(getRiskLevel("bash:npm:install")).toBe("unknown");
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
    const result = getEffectDescription("allow", "write_file");
    expect(result).toContain("auto-approve");
    expect(result).toContain("write_file");
  });

  it("should describe deny effect without scope", () => {
    const result = getEffectDescription("deny", "git_push");
    expect(result).toContain("confirmation");
    expect(result).toContain("git_push");
  });

  it("should describe ask effect (same as deny)", () => {
    const result = getEffectDescription("ask", "delete_file");
    expect(result).toContain("confirmation");
    expect(result).toContain("delete_file");
  });

  it("should include project scope label", () => {
    const result = getEffectDescription("deny", "git_push", "project");
    expect(result).toContain("this project");
  });

  it("should include global scope label", () => {
    const result = getEffectDescription("allow", "read_file", "global");
    expect(result).toContain("all projects");
  });
  it("warns that legacy shell grants are inactive", () => {
    expect(getEffectDescription("allow", "bash:cat")).toContain("inactive");
    expect(getEffectDescription("deny", "bash:git:push")).toContain("inactive");
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
      patterns: ["write_file"],
      reason: "Allow project file writes",
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.pattern).toBe("write_file");
    expect(result.changes[0]!.action).toBe("allow");
    expect(result.changes[0]!.risk).toContain("LOW");
    expect(result.changes[0]!.effect).toContain("auto-approve");
    expect(result.summary).toContain("auto-approve");
    expect(result.summary).toContain("write_file");
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
    expect(result.changes[0]!.effect).toContain("inactive");
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
      patterns: ["read_file"],
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
      patterns: ["git_commit"],
    });

    expect(result.summary).toContain("(project)");
    expect(result.changes[0]!.effect).toContain("this project");
  });

  it("should accept global scope", async () => {
    const result = await managePermissionsTool.execute({
      action: "allow",
      patterns: ["write_file"],
      scope: "global",
    });

    expect(result.summary).toContain("(global)");
    expect(result.changes[0]!.effect).toContain("all projects");
  });

  it("should accept project scope explicitly", async () => {
    const result = await managePermissionsTool.execute({
      action: "deny",
      patterns: ["git_push"],
      scope: "project",
    });

    expect(result.summary).toContain("(project)");
    expect(result.changes[0]!.effect).toContain("this project");
  });

  it("should show correct effect for global deny", async () => {
    const result = await managePermissionsTool.execute({
      action: "deny",
      patterns: ["delete_file"],
      scope: "global",
    });

    expect(result.changes[0]!.effect).toContain("all projects");
    expect(result.summary).toContain("(global)");
  });
  it.each(["bash:cat", "bash:git:commit", "bash_exec", "bash_background", "bash:exact:abc"])(
    "rejects allowing legacy or malformed shell pattern %s",
    async (pattern) => {
      await expect(
        managePermissionsTool.execute({ action: "allow", patterns: [pattern] }),
      ).rejects.toThrow("Shell permissions can only be granted");
    },
  );

  it("rejects an opaque exact shell fingerprint for new permission but allows revocation", async () => {
    const pattern = "bash:exact:efbda45375cb66d6aabca56074915e4b10f60f0a2bd0f06e21cbb7d0de7b7a99";
    await expect(
      managePermissionsTool.execute({ action: "allow", patterns: [pattern] }),
    ).rejects.toThrow("visible command");
    for (const action of ["deny", "ask"] as const) {
      const result = await managePermissionsTool.execute({ action, patterns: [pattern] });
      expect(result.changes).toEqual([expect.objectContaining({ pattern, action })]);
    }
  });
});
