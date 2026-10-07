import { z } from "zod";
import { describe, expect, it } from "vitest";
import { fileExistsTool } from "../tools/file.js";
import { createPermissionPolicy } from "./permission-policy.js";
import type { ToolDefinition } from "../tools/registry.js";

const spawnSimpleAgentTool: ToolDefinition = {
  name: "spawnSimpleAgent",
  description: "spawn agent",
  category: "build",
  parameters: z.object({}),
  async execute() {
    return {};
  },
};

describe("runtime permission policy", () => {
  it.each(["plan", "ask", "review"] as const)(
    "allows scoped file existence queries in %s",
    (mode) => {
      expect(createPermissionPolicy().canExecuteTool(mode, fileExistsTool)).toMatchObject({
        allowed: true,
        risk: "read-only",
      });
    },
  );
  it("blocks write-capable subagents in read-only modes", () => {
    const policy = createPermissionPolicy();

    expect(
      policy.canExecuteToolInput?.("ask", spawnSimpleAgentTool, {
        type: "debug",
      }),
    ).toMatchObject({
      allowed: false,
      risk: "write",
    });

    expect(
      policy.canExecuteToolInput?.("ask", spawnSimpleAgentTool, {
        type: "explore",
      }),
    ).toMatchObject({
      allowed: true,
      risk: "read-only",
    });
  });

  it("requires confirmation for destructive or secrets-sensitive subagents", () => {
    const policy = createPermissionPolicy();

    expect(
      policy.canExecuteToolInput?.("build", spawnSimpleAgentTool, {
        type: "test",
      }),
    ).toMatchObject({
      allowed: true,
      requiresConfirmation: true,
      risk: "destructive",
    });

    expect(
      policy.canExecuteToolInput?.("build", spawnSimpleAgentTool, {
        type: "database",
      }),
    ).toMatchObject({
      allowed: true,
      requiresConfirmation: true,
      risk: "secrets-sensitive",
    });
  });
});
