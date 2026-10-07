import { describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "../tools/registry.js";
import { gitBranchTool } from "../tools/git.js";
import { readImageTool } from "../tools/image.js";
import { RuntimeToolExecutor } from "./runtime-tool-executor.js";

describe("permission checks account for actual tool effects", () => {
  it.each([{ create: "feature" }, { delete: "old" }])(
    "blocks branch mutation %j in plan even with confirmation",
    async (input) => {
      const execute = vi.fn(async () => ({ branches: [], current: "main" }));
      const registry = new ToolRegistry();
      registry.register({ ...gitBranchTool, execute });
      const executor = new RuntimeToolExecutor({ toolRegistry: registry });
      const result = await executor.execute({
        toolName: "git_branch",
        input,
        mode: "plan",
        confirmed: true,
      });
      expect(result.success).toBe(false);
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it("requires confirmation for branch mutation and still allows listing in plan", async () => {
    const execute = vi.fn(async () => ({ branches: ["main"], current: "main" }));
    const registry = new ToolRegistry();
    registry.register({ ...gitBranchTool, execute });
    const executor = new RuntimeToolExecutor({ toolRegistry: registry });
    expect(
      (
        await executor.execute({
          toolName: "git_branch",
          input: { create: "feature" },
          mode: "build",
        })
      ).success,
    ).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(
      (await executor.execute({ toolName: "git_branch", input: {}, mode: "plan" })).success,
    ).toBe(true);
    expect(
      (
        await executor.execute({
          toolName: "git_branch",
          input: { create: "feature" },
          mode: "build",
          confirmed: true,
        })
      ).success,
    ).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it.each([
    { mode: "plan" as const, confirmed: true },
    { mode: "build" as const, confirmed: false },
  ])("denies remote image before reading or SDK access: %j", async (options) => {
    const execute = vi.fn(readImageTool.execute);
    const registry = new ToolRegistry();
    registry.register({ ...readImageTool, execute });
    const executor = new RuntimeToolExecutor({ toolRegistry: registry });
    expect(
      (
        await executor.execute({
          toolName: "read_image",
          input: { path: "never-read.png" },
          ...options,
        })
      ).success,
    ).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
  it("a no-network risk ceiling overrides explicit image confirmation", async () => {
    const execute = vi.fn(readImageTool.execute);
    const registry = new ToolRegistry();
    registry.register({ ...readImageTool, execute });
    const executor = new RuntimeToolExecutor({
      toolRegistry: registry,
      runtimePolicy: { maxToolRisk: "read-only" },
    });
    expect(
      (
        await executor.execute({
          toolName: "read_image",
          input: { path: "never-read.png" },
          mode: "build",
          confirmed: true,
        })
      ).success,
    ).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
