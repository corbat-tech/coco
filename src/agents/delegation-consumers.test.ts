import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LLMProvider } from "../providers/types.js";
import { AgentManager } from "../cli/repl/agents/manager.js";
import { AgentExecutor, type AgentDefinition } from "./executor.js";
import * as bridge from "./provider-bridge.js";
import { ToolRegistry } from "../tools/registry.js";
import { spawnSimpleAgentTool } from "../tools/simple-agent.js";
import { delegateTaskTool } from "../tools/agent-coordinator.js";
import { RuntimeToolExecutor } from "../runtime/runtime-tool-executor.js";
import { createEventLog } from "../runtime/event-log.js";
import type { RuntimePolicy } from "../runtime/context.js";

function fixture(requestedTool: "read_file" | "run_tests", runtimePolicy?: RuntimePolicy) {
  const chat = vi
    .fn<LLMProvider["chatWithTools"]>()
    .mockResolvedValueOnce({
      id: "first",
      content: "",
      stopReason: "tool_use",
      model: "fixture",
      usage: { inputTokens: 1, outputTokens: 1 },
      toolCalls: [{ id: "child-tool-call", name: requestedTool, input: {} }],
    })
    .mockResolvedValue({
      id: "last",
      content: "Finished",
      stopReason: "end_turn",
      model: "fixture",
      usage: { inputTokens: 1, outputTokens: 1 },
      toolCalls: [],
    });
  const provider = {
    id: "fixture",
    name: "Fixture",
    chatWithTools: chat,
  } as unknown as LLMProvider;
  const registry = new ToolRegistry();
  const effect = vi.fn(async () => ({ content: "fixture data" }));
  registry.register({
    name: requestedTool,
    category: requestedTool === "run_tests" ? "test" : "file",
    description: "In-memory fixture",
    parameters: z.object({}),
    execute: effect,
  });
  registry.register(spawnSimpleAgentTool);
  registry.register(delegateTaskTool);
  const manager = new AgentManager(provider, registry);
  vi.spyOn(bridge, "getAgentManager").mockReturnValue(manager);
  const eventLog = createEventLog();
  const runtime = new RuntimeToolExecutor({
    toolRegistry: registry,
    runtimePolicy,
    eventLog,
    eventProfile: "runtime-api",
  });
  const definition: AgentDefinition = {
    role: "tester",
    systemPrompt: "Fixture",
    allowedTools: [requestedTool],
    maxTurns: 3,
  };
  return { registry, provider, manager, runtime, eventLog, effect, chat, definition };
}

const wrappers = ["spawnSimpleAgent", "delegateTask"] as const;
function wrapperInput(toolName: (typeof wrappers)[number], role: "test" | "explore") {
  return toolName === "spawnSimpleAgent"
    ? { task: "Fixture task", type: role, maxTurns: 3 }
    : { taskId: "fixture-task", task: "Fixture task", agentType: role, maxTurns: 3 };
}

describe("delegation consumers retain execution context authority", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(wrappers)("%s cannot bypass the parent's tool allowlist", async (toolName) => {
    const { runtime, effect, chat, eventLog } = fixture("run_tests");
    const result = await runtime.execute({
      toolName,
      input: wrapperInput(toolName, "test"),
      mode: "build",
      confirmed: true,
      allowedTools: [toolName],
      sessionId: "parent-session",
    });
    expect(result.success).toBe(true);
    expect(effect).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(chat.mock.calls[1]?.[0])).toContain('"is_error":true');
    expect(eventLog.list().filter((event) => event.type === "tool.blocked")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          tool: "run_tests",
          sessionId: "parent-session",
          toolCallId: "child-tool-call",
        }),
      }),
    ]);
  });

  it.each(wrappers)(
    "%s does not inherit spawn consent for runtime write-risk approval",
    async (toolName) => {
      const { runtime, effect, eventLog } = fixture("run_tests", {
        requireHumanApprovalFor: ["write"],
      });
      const result = await runtime.execute({
        toolName,
        input: wrapperInput(toolName, "test"),
        mode: "build",
        confirmed: true,
      });
      expect(result.success).toBe(true);
      expect(effect).not.toHaveBeenCalled();
      expect(eventLog.list().filter((event) => event.type === "tool.blocked")).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ tool: "run_tests", runtimePolicyBlocked: true }),
        }),
      ]);
    },
  );

  it.each(wrappers)("%s delegates permitted reads through the parent runtime", async (toolName) => {
    const { runtime, effect, eventLog } = fixture("read_file");
    const result = await runtime.execute({
      toolName,
      input: wrapperInput(toolName, "explore"),
      mode: "build",
      confirmed: true,
      allowedTools: [toolName, "read_file"],
      sessionId: "parent-session",
    });
    expect(result.success).toBe(true);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(
      eventLog
        .list()
        .filter((event) => event.type === "tool.completed" && event.data.tool === "read_file"),
    ).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: "parent-session",
          toolCallId: "child-tool-call",
          success: true,
        }),
      }),
    ]);
  });

  it.each(["manager", "executor"])(
    "%s without host context cannot execute writable run_tests by choosing a tester role",
    async (consumer) => {
      const { provider, registry, manager, definition, effect, chat } = fixture("run_tests");
      if (consumer === "manager") await manager.spawn("test", "Fixture task");
      else
        await new AgentExecutor(provider, registry).execute(definition, {
          id: "fixture",
          description: "Fixture task",
        });
      expect(effect).not.toHaveBeenCalled();
      expect(chat).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(chat.mock.calls[1]?.[0])).toContain('"is_error":true');
    },
  );

  it.each(["allowlist", "mode", "permitted read"])(
    "AgentExecutor consumes the parent's context: %s",
    async (scenario) => {
      const requested = scenario === "permitted read" ? "read_file" : "run_tests";
      const { provider, registry, runtime, definition, effect, eventLog } = fixture(requested);
      const executor = new AgentExecutor(provider, registry);
      // A tiny host wrapper injects the real context exactly as a delegation tool does.
      registry.register({
        name: "spawnSimpleAgent",
        description: "Executor adapter fixture",
        category: "build",
        parameters: z.object({ type: z.literal("explore") }),
        execute: async (_input, executionContext) =>
          executor.execute(
            definition,
            { id: "fixture", description: "Fixture task" },
            executionContext,
          ),
      });
      const result = await runtime.execute({
        toolName: "spawnSimpleAgent",
        input: { type: "explore" },
        mode: scenario === "mode" ? "plan" : "build",
        allowedTools:
          scenario === "allowlist" ? ["spawnSimpleAgent"] : ["spawnSimpleAgent", requested],
        sessionId: "executor-parent",
      });
      expect(result.success).toBe(true);
      expect(effect).toHaveBeenCalledTimes(scenario === "permitted read" ? 1 : 0);
      const terminal = scenario === "permitted read" ? "tool.completed" : "tool.blocked";
      expect(
        eventLog.list().filter((event) => event.type === terminal && event.data.tool === requested),
      ).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: "executor-parent",
            toolCallId: "child-tool-call",
          }),
        }),
      ]);
    },
  );
});
