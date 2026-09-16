import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../tools/registry.js";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import { RuntimeToolExecutor } from "../runtime/runtime-tool-executor.js";
import type { RuntimePolicy } from "../runtime/context.js";
import type { RuntimeMode } from "../runtime/types.js";
import { wrapMCPTool } from "./tools.js";
import type { MCPClient, MCPTool, MCPToolWrapperOptions } from "./types.js";

function fixture(category = "deploy", runtimePolicy?: RuntimePolicy) {
  let effects = 0;
  const callTool = vi.fn(async () => {
    effects++;
    return { content: [{ type: "text" as const, text: "fixture output" }] };
  });
  // Only callTool is exercised; no server, provider, credentials, or network.
  const client = { callTool } as unknown as MCPClient;
  const remoteTool: MCPTool & { annotations: { readOnlyHint: boolean } } = {
    name: "read_file",
    description: "Server claims this operation only reads files",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    annotations: { readOnlyHint: true },
  };
  // Runtime metadata can arrive from untyped integrations, including categories
  // outside the narrower MCP wrapper option type.
  const options = { category, namePrefix: "custom", requestTimeout: 1000 } as MCPToolWrapperOptions;
  const { tool } = wrapMCPTool(remoteTool, "fixture-server", client, options);
  const registry = new ToolRegistry();
  registry.register(tool);
  const executor = new RuntimeToolExecutor({ toolRegistry: registry, runtimePolicy });
  const runtime = new AgentRuntime({
    providerType: "openai",
    model: "fixture-model",
    toolRegistry: registry,
    runtimePolicy,
  });
  return { tool, registry, executor, runtime, callTool, effects: () => effects };
}

describe("MCP provenance is an explicit runtime permission boundary", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    // Wrapper timeout cancellation is a separate lifecycle concern (E07).
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each(["deploy", "search", "web"])(
    "records provenance independent of custom prefix and %s category",
    (category) => {
      const { tool } = fixture(category);
      expect(tool.name).toContain("custom");
      expect(tool.category).toBe(category);
      expect(tool).toMatchObject({
        provenance: {
          kind: "mcp",
          serverName: "fixture-server",
          toolName: "read_file",
        },
      });
    },
  );

  const cases = (["ask", "plan", "build", "debug", "review", "architect"] as RuntimeMode[]).flatMap(
    (mode) => [false, true].map((confirmed) => ({ mode, confirmed })),
  );

  it.each(cases)(
    "mode=$mode confirmed=$confirmed enforces consent despite readOnlyHint/category",
    async ({ mode, confirmed }) => {
      const allowed = confirmed && (mode === "build" || mode === "debug");
      for (const category of ["deploy", "search", "web"]) {
        const { tool, executor, runtime, effects, callTool } = fixture(category);
        const input = { toolName: tool.name, input: { query: "fixture" }, mode, confirmed };
        const direct = await executor.execute(input);
        expect(direct.success).toBe(allowed);
        expect(direct.decision.risk).toBe("secrets-sensitive");
        expect(effects()).toBe(allowed ? 1 : 0);
        const session = runtime.createSession({ mode });
        const facade = await runtime.executeTool({ ...input, sessionId: session.id });
        expect(facade.success).toBe(allowed);
        expect(facade.decision.risk).toBe("secrets-sensitive");
        expect(effects()).toBe(allowed ? 2 : 0);
        expect(callTool).toHaveBeenCalledTimes(allowed ? 2 : 0);
        if (allowed)
          expect(callTool).toHaveBeenLastCalledWith({
            name: "read_file",
            arguments: { query: "fixture" },
          });
      }
    },
  );

  it.each(["read-only", "write", "network", "destructive"] as const)(
    "maxToolRisk=%s blocks MCP even with build confirmation",
    async (maxToolRisk) => {
      const { tool, executor, runtime, effects } = fixture("search", { maxToolRisk });
      const input = {
        toolName: tool.name,
        input: { query: "fixture" },
        mode: "build" as const,
        confirmed: true,
      };
      expect((await executor.execute(input)).success).toBe(false);
      expect((await runtime.executeTool(input)).success).toBe(false);
      expect(effects()).toBe(0);
    },
  );

  it("preserves native read_file access without confirmation in every mode", async () => {
    const { registry, executor, runtime, effects } = fixture();
    const nativeRead = vi.fn(async () => ({ content: "native fixture" }));
    registry.register({
      name: "read_file",
      description: "Native read",
      category: "file",
      parameters: z.object({}),
      execute: nativeRead,
    });
    for (const mode of ["ask", "plan", "build", "debug", "review", "architect"] as RuntimeMode[]) {
      const input = { toolName: "read_file", input: {}, mode, confirmed: false };
      expect((await executor.execute(input)).success).toBe(true);
      expect((await runtime.executeTool(input)).success).toBe(true);
    }
    expect(nativeRead).toHaveBeenCalledTimes(12);
    expect(effects()).toBe(0);
  });
});
