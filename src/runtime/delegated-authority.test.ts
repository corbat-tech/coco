import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../tools/registry.js";
import type { DelegatedToolCall, ToolExecutionContext } from "../tools/execution-context.js";
import { RuntimeToolExecutor } from "./runtime-tool-executor.js";
import { createEventLog } from "./event-log.js";
import type { RuntimePolicy } from "./context.js";
import type { RuntimeMode, RuntimeToolExecutionResult } from "./types.js";

type Dispatch = NonNullable<ToolExecutionContext["executeDelegatedTool"]>;
const spawn = "spawnSimpleAgent";
const child = (toolName = "read_file", mode: RuntimeMode = "build"): DelegatedToolCall => ({
  toolName,
  input: {},
  mode,
  allowedTools: [spawn, "read_file", "run_tests", "write_file"],
  toolCallId: "child-call",
});

function fixture(
  run: (dispatch: Dispatch, depth: number) => Promise<RuntimeToolExecutionResult>,
  policy?: RuntimePolicy,
) {
  const registry = new ToolRegistry();
  const effects = {
    read_file: vi.fn(async () => "read"),
    run_tests: vi.fn(async () => "test"),
    write_file: vi.fn(async () => "write"),
  };
  for (const name of ["read_file", "run_tests", "write_file"] as const) {
    registry.register({
      name,
      description: "In-memory effect",
      category: name === "run_tests" ? "test" : "file",
      parameters: z.object({}),
      execute: effects[name],
    });
  }
  registry.register({
    name: spawn,
    category: "build",
    description: "Delegation fixture",
    parameters: z.object({ type: z.literal("explore"), depth: z.number().default(0) }),
    execute: async ({ depth }, context) => {
      if (!context?.executeDelegatedTool) throw new Error("Missing bound delegate dispatch");
      return run(context.executeDelegatedTool, depth);
    },
  });
  const eventLog = createEventLog();
  const executor = new RuntimeToolExecutor({
    toolRegistry: registry,
    runtimePolicy: policy,
    eventLog,
    eventProfile: "runtime-api",
  });
  const root = (
    mode: RuntimeMode = "build",
    extra: Partial<Parameters<typeof executor.execute>[0]> = {},
  ) =>
    executor.execute({
      toolName: spawn,
      input: { type: "explore" },
      mode,
      sessionId: "parent-session",
      toolCallId: "parent-call",
      ...extra,
    });
  return { executor, registry, effects, eventLog, root };
}

function childResult(result: RuntimeToolExecutionResult): RuntimeToolExecutionResult {
  expect(result.success).toBe(true);
  expect(result.output).toMatchObject({
    toolName: expect.any(String),
    success: expect.any(Boolean),
  });
  return result.output as RuntimeToolExecutionResult;
}

describe("delegated tool authority remains bounded by every ancestor", () => {
  it.each(["ask", "plan", "review", "architect"] as RuntimeMode[])(
    "parent mode %s cannot be broadened by child build mode",
    async (mode) => {
      const { root, effects } = fixture((dispatch) => dispatch(child("run_tests")));
      expect(childResult(await root(mode)).success).toBe(false);
      expect(effects.run_tests).not.toHaveBeenCalled();
    },
  );

  it("a child read-only mode still restricts a build parent", async () => {
    const { root, effects } = fixture((dispatch) => dispatch(child("run_tests", "plan")));
    expect(childResult(await root()).success).toBe(false);
    expect(effects.run_tests).not.toHaveBeenCalled();
  });

  it("does not replace the parent allowlist with the broader child allowlist", async () => {
    const { root, effects } = fixture((dispatch) => dispatch(child("read_file")));
    expect(childResult(await root("build", { allowedTools: [spawn] })).success).toBe(false);
    expect(effects.read_file).not.toHaveBeenCalled();
  });

  it("an empty child allowlist means no tools, not unrestricted access", async () => {
    const { root, effects } = fixture((dispatch) => dispatch({ ...child(), allowedTools: [] }));
    expect(childResult(await root()).success).toBe(false);
    expect(effects.read_file).not.toHaveBeenCalled();
  });

  it("neither parent confirmation nor spoofed child confirmation authorizes destructive effects", async () => {
    const spoofed = {
      ...child("write_file"),
      confirmed: true,
      sessionId: "spoofed-session",
    } as DelegatedToolCall;
    const { root, effects, eventLog } = fixture((dispatch) => dispatch(spoofed));
    expect(childResult(await root("build", { confirmed: true })).success).toBe(false);
    expect(effects.write_file).not.toHaveBeenCalled();
    const blocked = eventLog.list().filter((event) => event.type === "tool.blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.data).toMatchObject({
      sessionId: "parent-session",
      toolCallId: "child-call",
      tool: "write_file",
    });
  });

  it.each([
    { maxToolRisk: "read-only" },
    { requireHumanApprovalFor: ["write"] },
  ] satisfies RuntimePolicy[])(
    "retains runtime risk/approval policy %j on children",
    async (policy) => {
      const { root, effects } = fixture((dispatch) => dispatch(child("run_tests")), policy);
      expect(childResult(await root("build", { confirmed: true })).success).toBe(false);
      expect(effects.run_tests).not.toHaveBeenCalled();
    },
  );

  it.each(["mode", "allowlist"])(
    "grandchildren retain the original ancestor %s ceiling",
    async (limit) => {
      const { root, effects } = fixture((dispatch, depth) =>
        depth === 0
          ? dispatch({ ...child(spawn), input: { type: "explore", depth: 1 } })
          : dispatch(child("run_tests")),
      );
      const result = await root(
        limit === "mode" ? "plan" : "build",
        limit === "allowlist" ? { allowedTools: [spawn, "read_file"] } : {},
      );
      expect(childResult(childResult(result)).success).toBe(false);
      expect(effects.run_tests).not.toHaveBeenCalled();
    },
  );

  it("keeps concurrent parent registries, policies, sessions, and events separate", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = async (dispatch: Dispatch) => {
      await wait;
      return dispatch(child());
    };
    const a = fixture(run, { allowedTools: [spawn, "read_file"] });
    const b = fixture(run, { allowedTools: [spawn] });
    const pendingA = a.root("build", { sessionId: "session-a" });
    const pendingB = b.root("build", { sessionId: "session-b" });
    release();
    const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
    expect(childResult(resultA).success).toBe(true);
    expect(childResult(resultB).success).toBe(false);
    expect(a.effects.read_file).toHaveBeenCalledTimes(1);
    expect(b.effects.read_file).not.toHaveBeenCalled();
    for (const [instance, sessionId] of [
      [a, "session-a"],
      [b, "session-b"],
    ] as const) {
      const events = instance.eventLog
        .list()
        .filter((event) => event.data.toolCallId === "child-call");
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.data.sessionId === sessionId)).toBe(true);
    }
  });

  it("snapshots the parent allowlist before an asynchronous tool can widen its original array", async () => {
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { root, effects } = fixture(async (dispatch) => {
      entered();
      await wait;
      return dispatch(child("run_tests"));
    });
    const allowedTools = [spawn];
    const pending = root("build", { allowedTools });
    expect(await Promise.race([ready.then(() => true), pending.then(() => false)])).toBe(true);
    allowedTools.push("run_tests");
    release();
    expect(childResult(await pending).success).toBe(false);
    expect(effects.run_tests).not.toHaveBeenCalled();
  });

  it("snapshots runtime policy at construction rather than retaining its mutable allowlist", async () => {
    const policy: RuntimePolicy = { allowedTools: [spawn] };
    const { root, effects } = fixture((dispatch) => dispatch(child()), policy);
    policy.allowedTools!.push("read_file");
    expect(childResult(await root()).success).toBe(false);
    expect(effects.read_file).not.toHaveBeenCalled();
  });

  it("allows a permitted child read and correlates its events to the parent's session", async () => {
    const { root, effects, eventLog } = fixture((dispatch) => dispatch(child("read_file", "plan")));
    expect(childResult(await root("plan", { allowedTools: [spawn, "read_file"] }))).toMatchObject({
      success: true,
      output: "read",
    });
    expect(effects.read_file).toHaveBeenCalledTimes(1);
    const events = eventLog.list().filter((event) => event.data.toolCallId === "child-call");
    expect(events.map((event) => event.type)).toEqual(["tool.started", "tool.completed"]);
    expect(events.every((event) => event.data.sessionId === "parent-session")).toBe(true);
  });

  it("remote MCP provenance still requires its own consent under a confirmed parent", async () => {
    const { registry, root } = fixture((dispatch) =>
      dispatch({ ...child("remote_read"), allowedTools: ["remote_read"] }),
    );
    const remoteEffect = vi.fn(async () => "remote effect");
    registry.register({
      name: "remote_read",
      description: "Remote fixture",
      category: "search",
      provenance: { kind: "mcp", serverName: "fixture", toolName: "read" },
      parameters: z.object({}),
      execute: remoteEffect,
    });
    const result = childResult(await root("build", { confirmed: true }));
    expect(result.success).toBe(false);
    expect(result.decision).toMatchObject({
      risk: "secrets-sensitive",
      requiresConfirmation: true,
    });
    expect(remoteEffect).not.toHaveBeenCalled();
  });

  it("a parent aborted before child dispatch cannot produce a child effect", async () => {
    const controller = new AbortController();
    const { root, effects } = fixture((dispatch) => {
      controller.abort();
      return dispatch(child("run_tests"));
    });
    const result = childResult(await root("build", { signal: controller.signal }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/abort|cancel/i);
    expect(effects.run_tests).not.toHaveBeenCalled();
  });
});
