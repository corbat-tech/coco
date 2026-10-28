import { describe, expect, it, vi } from "vitest";
import { RuntimeToolExecutor } from "./runtime-tool-executor.js";
import { normalizeAgentRunResult } from "./multi-agent.js";
import { ToolRegistry } from "../tools/registry.js";
import { spawnSimpleAgentTool } from "../tools/simple-agent.js";
import { delegateTaskTool } from "../tools/agent-coordinator.js";
import { z } from "zod";
import type { RunAgent, ToolExecutionContext } from "../tools/execution-context.js";
import { InMemoryRuntimeSessionStore } from "./runtime-session-store.js";
import {
  createSessionWorkLedgerAccess,
  readWorkLedger,
  reconcileWorkEvidence,
} from "./work-ledger.js";

describe("host-bound session worker dispatch", () => {
  it("does not let a provider reuse a call ID to erase uncertain host evidence", async () => {
    const store = new InMemoryRuntimeSessionStore();
    store.create({ id: "identity", mode: "build" });
    const access = createSessionWorkLedgerAccess(store);
    access
      .forSession("identity")
      .beforeTool("write_file", {}, "write", false, "reused-provider-id");
    const registry = new ToolRegistry();
    const effect = vi.fn(async () => "effect");
    registry.register({
      name: "read_file",
      description: "fixture",
      category: "file",
      parameters: z.object({}),
      execute: async () => "read",
    });
    registry.register({
      name: "write_file",
      description: "fixture",
      category: "file",
      parameters: z.object({}),
      execute: effect,
    });
    const runtime = new RuntimeToolExecutor({ toolRegistry: registry, workLedgerAccess: access });
    expect(
      (
        await runtime.execute({
          sessionId: "identity",
          mode: "build",
          toolName: "read_file",
          toolCallId: "reused-provider-id",
          input: {},
        })
      ).success,
    ).toBe(true);
    expect(
      (
        await runtime.execute({
          sessionId: "identity",
          mode: "build",
          toolName: "write_file",
          input: {},
          confirmed: true,
        })
      ).success,
    ).toBe(false);
    expect(effect).not.toHaveBeenCalled();
    expect(access.forSession("identity").read().evidence[0]).toMatchObject({
      toolName: "write_file",
      phase: "running",
    });
  });
  it("blocks mutations after reopening an effect whose result was not durably saved", async () => {
    const store = new InMemoryRuntimeSessionStore();
    store.create({ id: "reopen", mode: "build" });
    const registry = new ToolRegistry();
    const effect = vi.fn(async () => "applied");
    registry.register({
      name: "write_file",
      description: "fixture",
      category: "file",
      parameters: z.object({}),
      execute: effect,
    });
    let durable = store.get("reopen")!;
    let saves = 0;
    const options = {
      toolRegistry: registry,
      workLedgerAccess: createSessionWorkLedgerAccess(store),
    };
    await expect(
      new RuntimeToolExecutor(options).execute({
        sessionId: "reopen",
        mode: "build",
        toolName: "write_file",
        input: {},
        confirmed: true,
        checkpoint: async () => {
          if (++saves === 1) durable = store.get("reopen")!;
          else throw new Error("result not persisted");
        },
      }),
    ).rejects.toThrow("result not persisted");
    expect(effect).toHaveBeenCalledOnce();
    const sameHost = await new RuntimeToolExecutor(options).execute({
      sessionId: "reopen",
      mode: "build",
      toolName: "write_file",
      input: {},
      confirmed: true,
    });
    expect(sameHost.success).toBe(false);
    expect(effect).toHaveBeenCalledOnce();
    store.update(durable);
    const reopened = await new RuntimeToolExecutor(options).execute({
      sessionId: "reopen",
      mode: "build",
      toolName: "write_file",
      input: {},
      confirmed: true,
    });
    expect(reopened.success).toBe(false);
    expect(reopened.error).toContain("uncertain");
    expect(effect).toHaveBeenCalledOnce();
    const state = readWorkLedger(store.get("reopen")!.metadata);
    const reconciled = reconcileWorkEvidence(state, {
      evidenceId: state.evidence[0]!.id,
      outcome: "applied",
      reason: "Host inspected the written file",
    });
    store.update({ ...store.get("reopen")!, metadata: { workLedger: reconciled } });
    const continued = await new RuntimeToolExecutor(options).execute({
      sessionId: "reopen",
      mode: "build",
      toolName: "write_file",
      input: {},
      confirmed: true,
    });
    expect(continued.success).toBe(true);
    expect(effect).toHaveBeenCalledTimes(2);
  });
  it("persists intent before effects and observations afterwards; a failed barrier blocks effects", async () => {
    const store = new InMemoryRuntimeSessionStore();
    store.create({ id: "durable", mode: "build" });
    const registry = new ToolRegistry();
    const effect = vi.fn(async () => "written");
    registry.register({
      name: "write_file",
      description: "fixture",
      category: "file",
      parameters: z.object({}),
      execute: effect,
    });
    const runtime = new RuntimeToolExecutor({
      toolRegistry: registry,
      workLedgerAccess: createSessionWorkLedgerAccess(store),
    });
    const phases: string[][] = [];
    await runtime.execute({
      sessionId: "durable",
      toolName: "write_file",
      mode: "build",
      input: {},
      confirmed: true,
      checkpoint: async () => {
        const state = readWorkLedger(store.get("durable")!.metadata);
        phases.push(state.evidence.map((e) => e.phase));
        if (phases.length === 1) expect(effect).not.toHaveBeenCalled();
      },
    });
    expect(phases).toEqual([["running"], ["completed"]]);
    effect.mockClear();
    await expect(
      runtime.execute({
        sessionId: "durable",
        toolName: "write_file",
        mode: "build",
        input: {},
        confirmed: true,
        checkpoint: async () => {
          throw new Error("disk unavailable");
        },
      }),
    ).rejects.toThrow("disk unavailable");
    expect(effect).not.toHaveBeenCalled();
    expect(
      readWorkLedger(store.get("durable")!.metadata).evidence.some((e) => e.phase === "running"),
    ).toBe(true);
  });
  it.each([spawnSimpleAgentTool, delegateTaskTool])(
    "$name uses only the supplied host dispatch and respects its parent authority",
    async (wrapper) => {
      const registry = new ToolRegistry();
      const mutation = vi.fn(async () => ({ written: true }));
      registry.register({
        name: "write_file",
        description: "fixture",
        category: "file",
        parameters: z.object({}),
        execute: mutation,
      });
      registry.register(wrapper);
      const runtime = new RuntimeToolExecutor({ toolRegistry: registry });
      const runAgent = vi.fn<RunAgent>(async (_request, context) => {
        expect(context.sessionId).toBe("session-a");
        const denied = await context.executeDelegatedTool!({
          toolName: "write_file",
          input: {},
          mode: "build",
          allowedTools: ["write_file"],
        });
        expect(denied.success).toBe(false);
        return normalizeAgentRunResult({
          id: "owned-worker",
          taskId: "task",
          role: "researcher",
          success: true,
          output: "observed",
          turns: 1,
        });
      });
      const input =
        wrapper.name === "spawnSimpleAgent"
          ? { type: "explore", task: "inspect", maxTurns: 2 }
          : { agentType: "explore", taskId: "task", task: "inspect", maxTurns: 2 };
      const result = await runtime.execute({
        sessionId: "session-a",
        mode: "plan",
        toolName: wrapper.name,
        input,
        runAgent,
      });
      expect(result.success).toBe(true);
      expect(runAgent).toHaveBeenCalledOnce();
      expect(JSON.stringify(result.output)).toContain("owned-worker");
      expect(mutation).not.toHaveBeenCalled();
    },
  );
  it("does not propagate the worker-creation capability through child tool calls", async () => {
    const registry = new ToolRegistry();
    const child = vi.fn(async (_input: unknown, context?: ToolExecutionContext) => {
      expect(context?.runAgent).toBeUndefined();
      return "ok";
    });
    registry.register({
      name: "read_file",
      description: "fixture",
      category: "file",
      parameters: z.object({}),
      execute: child,
    });
    registry.register(spawnSimpleAgentTool);
    const runtime = new RuntimeToolExecutor({ toolRegistry: registry });
    await runtime.execute({
      mode: "plan",
      toolName: "spawnSimpleAgent",
      input: { task: "inspect", type: "explore", maxTurns: 1 },
      runAgent: async (_request, context) => {
        await context.executeDelegatedTool!({
          toolName: "read_file",
          input: {},
          mode: "plan",
          allowedTools: ["read_file"],
        });
        return normalizeAgentRunResult({
          id: "worker",
          taskId: "task",
          role: "researcher",
          success: true,
          output: "ok",
        });
      },
    });
    expect(child).toHaveBeenCalledOnce();
  });
  it.each([spawnSimpleAgentTool, delegateTaskTool])(
    "$name preserves artifacts and rejects simulated or cancelled success",
    async (wrapper) => {
      const registry = new ToolRegistry();
      registry.register(wrapper);
      const runtime = new RuntimeToolExecutor({ toolRegistry: registry });
      for (const patch of [{ status: "cancelled" as const }, { metadata: { simulated: true } }]) {
        const canonical = {
          ...normalizeAgentRunResult({
            id: "worker",
            taskId: "task",
            role: "researcher",
            success: true,
            output: "partial",
          }),
          ...patch,
        };
        const result = await runtime.execute({
          toolName: wrapper.name,
          mode: "plan",
          input: { task: "inspect", taskId: "task", maxTurns: 1 },
          runAgent: async () => canonical,
        });
        const raw =
          wrapper.name === "spawnSimpleAgent"
            ? JSON.parse((result.output as { stdout: string }).stdout)
            : result.output;
        expect(raw).toMatchObject({
          success: false,
          structuredResult: { success: false },
          artifacts: expect.any(Array),
        });
      }
    },
  );
  it("binds child consent to an immutable call and still honors the parent mode", async () => {
    const registry = new ToolRegistry();
    registry.register(spawnSimpleAgentTool);
    const effect = vi.fn(async (_input: { path: string }) => "written");
    registry.register({
      name: "write_file",
      description: "fixture",
      category: "file",
      parameters: z.object({ path: z.string() }),
      execute: effect,
    });
    const runtime = new RuntimeToolExecutor({ toolRegistry: registry });
    const runAgent: RunAgent = async (_request, context) => {
      const result = await context.executeDelegatedTool!({
        toolName: "write_file",
        input: { path: "approved" },
        mode: "build",
        allowedTools: ["write_file"],
      });
      return normalizeAgentRunResult({
        id: "worker",
        taskId: "task",
        role: "researcher",
        success: result.success,
        output: "observed",
      });
    };
    const approveDelegatedTool = vi.fn(async (call) => {
      call.input.path = "changed";
      return true;
    });
    for (const mode of ["plan", "build"] as const)
      await runtime.execute({
        toolName: "spawnSimpleAgent",
        input: { task: "inspect", type: "explore", maxTurns: 1 },
        mode,
        confirmed: true,
        runAgent,
        approveDelegatedTool,
      });
    expect(effect).toHaveBeenCalledOnce();
    expect(effect.mock.calls[0]?.[0]).toEqual({ path: "approved" });
    effect.mockClear();
    await runtime.execute({
      toolName: "spawnSimpleAgent",
      input: { task: "inspect", type: "explore", maxTurns: 1 },
      mode: "build",
      confirmed: true,
      runAgent,
      approveDelegatedTool: async () => false,
    });
    expect(effect).not.toHaveBeenCalled();
  });
});
