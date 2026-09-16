import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveAgentType } from "./agent-type.js";
import * as bridge from "../agents/provider-bridge.js";
import { AgentManager } from "../cli/repl/agents/manager.js";
import type { LLMProvider } from "../providers/types.js";
import { spawnSimpleAgentTool } from "../tools/simple-agent.js";
import { delegateTaskTool } from "../tools/agent-coordinator.js";
import { ToolRegistry } from "../tools/registry.js";
import { createPermissionPolicy } from "./permission-policy.js";
import { RuntimeToolExecutor } from "./runtime-tool-executor.js";
import { createEventLog } from "./event-log.js";
import type { RuntimeMode } from "./types.js";

const roleRisks = [
  ["explore", "read-only"],
  ["plan", "read-only"],
  ["test", "destructive"],
  ["debug", "write"],
  ["review", "read-only"],
  ["architect", "read-only"],
  ["security", "read-only"],
  ["tdd", "destructive"],
  ["refactor", "write"],
  ["e2e", "destructive"],
  ["docs", "write"],
  ["database", "secrets-sensitive"],
] as const;
const wrappers = [spawnSimpleAgentTool, delegateTaskTool];
const policy = createPermissionPolicy();

function roleInput(name: string, type: string): Record<string, unknown> {
  return name === "spawnSimpleAgent" ? { type } : { agentType: type };
}

describe("delegation role resolution and permission classification agree", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(roleRisks)("classifies %s as %s consistently for both wrappers", (type, risk) => {
    expect(resolveAgentType({ type })).toBe(type);
    for (const mode of ["ask", "plan", "review", "architect", "build", "debug"] as RuntimeMode[]) {
      const expectedAllowed = risk === "read-only" || mode === "build" || mode === "debug";
      const decisions = wrappers.map((tool) =>
        policy.canExecuteToolInput!(mode, tool, roleInput(tool.name, type)),
      );
      for (const decision of decisions) {
        expect(decision.risk).toBe(risk);
        expect(decision.allowed).toBe(expectedAllowed);
        if (expectedAllowed)
          expect(Boolean(decision.requiresConfirmation)).toBe(
            risk === "destructive" || risk === "secrets-sensitive",
          );
      }
      expect(Boolean(decisions[0]?.requiresConfirmation)).toBe(
        Boolean(decisions[1]?.requiresConfirmation),
      );
    }
  });

  it.each([
    ["researcher", "explore"],
    ["coder", "debug"],
    ["tester", "test"],
    ["reviewer", "review"],
    ["optimizer", "refactor"],
    ["planner", "plan"],
  ])("normalizes legacy %s to %s before policy classification", (role, type) => {
    expect(resolveAgentType({ role })).toBe(type);
    for (const tool of wrappers) {
      const legacyInput = tool.name === "spawnSimpleAgent" ? { role } : { agentRole: role };
      const legacy = policy.canExecuteToolInput!("build", tool, legacyInput);
      const modern = policy.canExecuteToolInput!("build", tool, roleInput(tool.name, type));
      expect(legacy.risk).toBe(modern.risk);
      expect(Boolean(legacy.requiresConfirmation)).toBe(Boolean(modern.requiresConfirmation));
    }
  });

  it("modern valid type takes precedence over a conflicting legacy role", () => {
    expect(resolveAgentType({ type: "docs", role: "researcher" })).toBe("docs");
    for (const tool of wrappers) {
      const input =
        tool.name === "spawnSimpleAgent"
          ? { type: "docs", role: "researcher" }
          : { agentType: "docs", agentRole: "researcher" };
      expect(policy.canExecuteToolInput!("plan", tool, input)).toMatchObject({
        allowed: false,
        risk: "write",
      });
    }
  });

  it.each([{}, { role: "unknown" }, { type: "unknown" }, { type: 42, role: null }])(
    "defaults malformed or omitted role input to explore: %j",
    (input) => {
      expect(resolveAgentType(input)).toBe("explore");
    },
  );

  it.each(wrappers)("$name ignores the other wrapper's role fields", (tool) => {
    const foreignOnly =
      tool.name === "spawnSimpleAgent"
        ? { agentType: "database", agentRole: "tester" }
        : { type: "database", role: "tester" };
    expect(policy.canExecuteToolInput!("plan", tool, foreignOnly)).toMatchObject({
      allowed: true,
      risk: "read-only",
    });
    const ownDangerous =
      tool.name === "spawnSimpleAgent"
        ? { type: "database", agentType: "explore" }
        : { agentType: "database", type: "explore" };
    expect(policy.canExecuteToolInput!("plan", tool, ownDangerous)).toMatchObject({
      allowed: false,
      risk: "secrets-sensitive",
    });
  });

  it.each(wrappers)(
    "$name rejects docs under plan and allows drafting under build without child write consent",
    async (tool) => {
      const chat = vi
        .fn<LLMProvider["chatWithTools"]>()
        .mockResolvedValueOnce({
          id: "first",
          content: "",
          stopReason: "tool_use",
          model: "fixture",
          usage: { inputTokens: 1, outputTokens: 1 },
          toolCalls: [
            {
              id: "docs-write",
              name: "write_file",
              input: { path: "README.md", content: "draft" },
            },
          ],
        })
        .mockResolvedValue({
          id: "last",
          content: "Draft documentation",
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
      const effect = vi.fn(async () => ({ written: true }));
      registry.register({
        name: "write_file",
        description: "In-memory write",
        category: "file",
        parameters: z.object({ path: z.string(), content: z.string() }),
        execute: effect,
      });
      registry.register(tool);
      const manager = new AgentManager(provider, registry);
      vi.spyOn(bridge, "getAgentManager").mockReturnValue(manager);
      const eventLog = createEventLog();
      const runtime = new RuntimeToolExecutor({
        toolRegistry: registry,
        eventLog,
        eventProfile: "runtime-api",
      });
      const input = {
        task: "Document fixture",
        taskId: "docs-task",
        maxTurns: 3,
        ...roleInput(tool.name, "docs"),
      };
      expect(
        (await runtime.execute({ toolName: tool.name, input, mode: "plan", confirmed: true }))
          .success,
      ).toBe(false);
      expect(chat).not.toHaveBeenCalled();
      expect((await runtime.execute({ toolName: tool.name, input, mode: "build" })).success).toBe(
        true,
      );
      expect(effect).not.toHaveBeenCalled();
      const denied = eventLog
        .list()
        .find((event) => event.type === "tool.blocked" && event.data.tool === "write_file");
      expect(denied?.data).toMatchObject({ mode: "build", toolCallId: "docs-write" });
      expect(denied?.data.reason).toMatch(/confirm/i);
      expect(JSON.stringify(chat.mock.calls[1]?.[0])).toContain('"is_error":true');
      const instructions = chat.mock.calls[0]?.[1]?.system;
      expect(instructions).toMatch(/draft|proposed documentation/i);
      expect(instructions).toMatch(/denied|blocked|unavailable/i);
      expect(instructions).toMatch(/saved|written|persist/i);
    },
  );
});
