import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutionContext } from "../tools/execution-context.js";
import { RuntimeToolExecutor } from "./runtime-tool-executor.js";

describe("background authority is supplied only by the host", () => {
  it("isolates sessions, inherits parent ownership and revokes on close", async () => {
    const registry = new ToolRegistry();
    const seen: ToolExecutionContext[] = [];
    registry.register({
      name: "read_file",
      category: "file",
      description: "test",
      parameters: z.object({}),
      async execute(_input, context) {
        seen.push(context!);
        return Boolean(context?.backgroundJobs);
      },
    });
    registry.register({
      name: "spawnSimpleAgent",
      category: "build",
      description: "test",
      parameters: z.object({}),
      async execute(_input, context) {
        seen.push(context!);
        return context!.executeDelegatedTool!({
          toolName: "read_file",
          input: {},
          mode: "build",
          allowedTools: ["read_file"],
        });
      },
    });
    const executor = new RuntimeToolExecutor({ toolRegistry: registry });
    executor.enableBackgroundJobs("a", process.cwd());
    executor.enableBackgroundJobs("b", process.cwd());
    await executor.execute({ sessionId: "a", toolName: "read_file", input: {}, mode: "build" });
    await executor.execute({ sessionId: "b", toolName: "read_file", input: {}, mode: "build" });
    expect(seen[0]!.backgroundJobs).not.toBe(seen[1]!.backgroundJobs);
    await executor.execute({
      sessionId: "a",
      toolName: "spawnSimpleAgent",
      input: {},
      mode: "build",
      confirmed: true,
    });
    expect(seen[2]!.backgroundJobs).toBe(seen[0]!.backgroundJobs);
    expect(seen[3]!.backgroundJobs).toBe(seen[0]!.backgroundJobs);
    await executor.closeSession("a");
    await executor.execute({
      sessionId: "a",
      toolName: "read_file",
      input: { sessionId: "b" },
      mode: "build",
    });
    expect(seen[4]!.backgroundJobs).toBeUndefined();
    expect(() => seen[0]!.backgroundJobs!.start({ command: "echo late" })).toThrow(/closed/);
    await executor.close();
  });
});
