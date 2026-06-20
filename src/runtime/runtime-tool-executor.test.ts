import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "../tools/registry.js";
import { createEventLog } from "./event-log.js";
import { createRuntimeToolExecutor } from "./runtime-tool-executor.js";

describe("RuntimeToolExecutor", () => {
  it("executes allowed read-only tools through the runtime boundary", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "read_file",
      description: "Read a file",
      category: "file",
      parameters: z.object({ path: z.string() }),
      execute: vi.fn(async () => ({ content: "ok" })),
    });
    const eventLog = createEventLog();
    const executor = createRuntimeToolExecutor({ toolRegistry: registry, eventLog, mode: "plan" });

    const result = await executor.execute({
      toolName: "read_file",
      input: { path: "README.md" },
      allowedTools: ["read_file"],
    });

    expect(result).toMatchObject({
      toolName: "read_file",
      success: true,
      output: { content: "ok" },
    });
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "agent.tool.called",
      "tool.started",
      "tool.completed",
    ]);
  });

  it("blocks destructive tools without explicit confirmation", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ ok: true }));
    registry.register({
      name: "write_file",
      description: "Write a file",
      category: "file",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute,
    });
    const eventLog = createEventLog();
    const executor = createRuntimeToolExecutor({ toolRegistry: registry, eventLog, mode: "build" });

    const result = await executor.execute({
      toolName: "write_file",
      input: { path: "src/a.ts", content: "x" },
      allowedTools: ["write_file"],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("should be confirmed");
    expect(execute).not.toHaveBeenCalled();
    expect(eventLog.list().map((event) => event.type)).toEqual(["tool.blocked"]);
  });
});
