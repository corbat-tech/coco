import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../tools/registry.js";
import { AgentRuntime } from "./agent-runtime.js";
import { createEventLog } from "./event-log.js";
import type { PermissionPolicy } from "./types.js";

function fixture(permissionPolicy?: PermissionPolicy) {
  const registry = new ToolRegistry();
  const execute = vi.fn(async ({ path }: { path: string }) => ({ path }));
  registry.register({
    name: "read_file",
    description: "Fixture read",
    category: "file",
    parameters: z.object({ path: z.string() }),
    execute,
  });
  const eventLog = createEventLog();
  const runtime = new AgentRuntime({
    providerType: "openai",
    model: "fixture-model",
    toolRegistry: registry,
    eventLog,
    permissionPolicy,
  });
  const events = () => eventLog.list().map(({ type, data }) => ({ type, data }));
  return { runtime, registry, execute, eventLog, events };
}

const read = { toolName: "read_file", input: { path: "README.md" } };

describe("AgentRuntime tool execution contract", () => {
  it("resolves explicit mode before session mode, then defaults to ask without mutating sessions", async () => {
    const canExecuteTool = vi.fn<PermissionPolicy["canExecuteTool"]>(() => ({
      allowed: true,
      risk: "read-only",
    }));
    const { runtime, execute } = fixture({ canExecuteTool });
    const session = runtime.createSession({
      mode: "build",
      messages: [{ role: "user", content: "hi" }],
    });
    await runtime.executeTool({ ...read, sessionId: session.id, mode: "plan" });
    await runtime.executeTool({ ...read, sessionId: session.id });
    await runtime.executeTool(read);
    expect(canExecuteTool.mock.calls.map(([mode]) => mode)).toEqual(["plan", "build", "ask"]);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(runtime.getSession(session.id)).toEqual(session);
  });

  it("rejects an unknown session before registry lookup or policy evaluation", async () => {
    const canExecuteTool = vi.fn<PermissionPolicy["canExecuteTool"]>(() => ({
      allowed: true,
      risk: "read-only",
    }));
    const { runtime, registry, execute, events } = fixture({ canExecuteTool });
    const lookup = vi.spyOn(registry, "get");
    const dispatch = vi.spyOn(registry, "execute");
    const result = await runtime.executeTool({ ...read, sessionId: "missing", mode: "plan" });
    expect(result).toMatchObject({ success: false, error: "Runtime session not found: missing" });
    expect(lookup).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(canExecuteTool).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(events()).toStrictEqual([
      {
        type: "tool.blocked",
        data: {
          sessionId: "missing",
          mode: "plan",
          tool: "read_file",
          reason: "Runtime session not found: missing",
          runtimeApi: true,
        },
      },
    ]);
  });

  it("retains exact facade event payloads and logs metadata keys without values", async () => {
    const { runtime, eventLog, events } = fixture();
    const session = runtime.createSession({ mode: "plan" });
    eventLog.clear();
    const result = await runtime.executeTool({
      ...read,
      sessionId: session.id,
      metadata: { z: "private-z", a: "private-a" },
    });
    expect(events()).toStrictEqual([
      {
        type: "tool.started",
        data: {
          sessionId: session.id,
          mode: "plan",
          tool: "read_file",
          risk: "read-only",
          runtimeApi: true,
          metadataKeys: ["a", "z"],
        },
      },
      {
        type: "tool.completed",
        data: {
          sessionId: session.id,
          mode: "plan",
          tool: "read_file",
          success: true,
          duration: result.duration,
          runtimeApi: true,
        },
      },
    ]);
    eventLog.clear();
    await runtime.executeTool({ toolName: "unknown", input: {}, metadata: { secret: "private" } });
    expect(events()).toStrictEqual([
      {
        type: "tool.blocked",
        data: {
          sessionId: undefined,
          mode: "ask",
          tool: "unknown",
          reason: "Tool not registered.",
          runtimeApi: true,
        },
      },
    ]);
  });

  it("uses input-aware policy once and never falls through to legacy policy on denial", async () => {
    const canExecuteTool = vi.fn<PermissionPolicy["canExecuteTool"]>(() => ({
      allowed: true,
      risk: "read-only",
    }));
    const canExecuteToolInput = vi
      .fn<NonNullable<PermissionPolicy["canExecuteToolInput"]>>()
      .mockReturnValue({ allowed: false, risk: "write", reason: "fixture denial" });
    const { runtime, registry, execute, events } = fixture({ canExecuteTool, canExecuteToolInput });
    const dispatch = vi.spyOn(registry, "execute");
    const result = await runtime.executeTool({
      ...read,
      mode: "build",
      confirmed: true,
      metadata: { secret: "private" },
    });
    expect(canExecuteToolInput).toHaveBeenCalledExactlyOnceWith(
      "build",
      registry.get("read_file"),
      read.input,
    );
    expect(canExecuteTool).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(result.decision).toEqual({
      allowed: false,
      risk: "write",
      reason: "fixture denial",
      requiresConfirmation: undefined,
    });
    expect(events()).toStrictEqual([
      {
        type: "tool.blocked",
        data: {
          sessionId: undefined,
          mode: "build",
          tool: "read_file",
          reason: "fixture denial",
          risk: "write",
          requiresConfirmation: undefined,
          runtimePolicyBlocked: false,
          runtimeApi: true,
        },
      },
    ]);
  });

  it("keeps concurrent session context attached when completion order reverses", async () => {
    const { runtime, execute, eventLog, events } = fixture();
    const first = runtime.createSession({ mode: "plan" });
    const second = runtime.createSession({ mode: "build" });
    const releases = new Map<string, () => void>();
    execute.mockImplementation(
      ({ path }) =>
        new Promise((resolve) => {
          releases.set(path, () => resolve({ path }));
        }),
    );
    eventLog.clear();
    const a = runtime.executeTool({
      toolName: "read_file",
      input: { path: "a" },
      sessionId: first.id,
      metadata: { first: "private-first" },
    });
    const b = runtime.executeTool({
      toolName: "read_file",
      input: { path: "b" },
      sessionId: second.id,
      metadata: { second: "private-second" },
    });
    expect([...releases.keys()]).toEqual(["a", "b"]);
    releases.get("b")!();
    expect((await b).output).toEqual({ path: "b" });
    releases.get("a")!();
    expect((await a).output).toEqual({ path: "a" });
    expect(events().map(({ type, data }) => [type, data.sessionId, data.mode])).toEqual([
      ["tool.started", first.id, "plan"],
      ["tool.started", second.id, "build"],
      ["tool.completed", second.id, "build"],
      ["tool.completed", first.id, "plan"],
    ]);
    expect(
      events()
        .slice(0, 2)
        .map(({ data }) => data.metadataKeys),
    ).toEqual([["first"], ["second"]]);
    expect(JSON.stringify(events())).not.toContain("private-");
    expect(runtime.getSession(first.id)).toEqual(first);
    expect(runtime.getSession(second.id)).toEqual(second);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("returns schema and execution failures through one started/completed pair each", async () => {
    const { runtime, registry, execute, events } = fixture();
    const dispatch = vi.spyOn(registry, "execute");
    const invalid = await runtime.executeTool({ toolName: "read_file", input: { path: 3 } });
    expect(invalid).toMatchObject({ success: false, output: undefined });
    expect(invalid.error).toContain("Invalid tool input for 'read_file'");
    expect(execute).not.toHaveBeenCalled();
    execute.mockRejectedValueOnce(new Error("fixture exploded"));
    const failed = await runtime.executeTool(read);
    expect(failed).toMatchObject({ success: false, output: undefined });
    expect(failed.error).toContain("fixture exploded");
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(events().map(({ type }) => type)).toEqual([
      "tool.started",
      "tool.completed",
      "tool.started",
      "tool.completed",
    ]);
    expect(
      events()
        .filter(({ type }) => type === "tool.completed")
        .map(({ data }) => [data.success, data.duration]),
    ).toEqual([
      [false, invalid.duration],
      [false, failed.duration],
    ]);
  });
});
