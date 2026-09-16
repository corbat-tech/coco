import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolCall } from "../../providers/types.js";
import { AgentRuntime } from "../../runtime/agent-runtime.js";
import type { RuntimePolicy } from "../../runtime/context.js";
import { createEventLog } from "../../runtime/event-log.js";
import type { RuntimeMode } from "../../runtime/types.js";
import { ToolRegistry } from "../../tools/registry.js";
import { createRuntimeToolDispatch } from "./runtime-tool-dispatch.js";

function call(name = "write_file"): ToolCall {
  return { id: "call-1", name, input: { path: "fixture.txt", details: { content: "original" } } };
}

function fixture(mode: RuntimeMode = "build", runtimePolicy?: RuntimePolicy) {
  const registry = new ToolRegistry();
  const effect = vi.fn(async (input: { path: string; details: { content: string } }) => ({
    path: input.path,
    content: input.details.content,
  }));
  for (const name of ["read_file", "write_file", "edit_file", "copy_file"]) {
    registry.register({
      name,
      description: "In-memory dispatch fixture",
      category: "file",
      parameters: z.object({ path: z.string(), details: z.object({ content: z.string() }) }),
      execute: effect,
    });
  }
  const eventLog = createEventLog();
  const runtime = new AgentRuntime({
    providerType: "openai",
    model: "fixture-model",
    toolRegistry: registry,
    eventLog,
    runtimePolicy,
  });
  const session = runtime.createSession({ mode });
  eventLog.clear();
  const dispatch = (approved: ToolCall[] = []) =>
    createRuntimeToolDispatch(runtime, session.id, mode, approved);
  return { runtime, registry, effect, eventLog, session, dispatch };
}

describe("runtime tool dispatch", () => {
  it("executes the exact approved write once and maps output to ToolResult.data", async () => {
    const { effect, eventLog, session, dispatch } = fixture();
    const approved = call();
    const result = await dispatch([approved])(structuredClone(approved));
    expect(result).toMatchObject({
      success: true,
      data: { path: "fixture.txt", content: "original" },
    });
    expect(effect).toHaveBeenCalledExactlyOnceWith(approved.input, {
      executeDelegatedTool: expect.any(Function),
    });
    expect(eventLog.list().map(({ type }) => type)).toEqual(["tool.started", "tool.completed"]);
    for (const event of eventLog.list()) {
      expect(event.data).toMatchObject({
        sessionId: session.id,
        toolCallId: approved.id,
        tool: approved.name,
      });
    }
  });

  it("blocks an unapproved write before any effect", async () => {
    const { effect, dispatch } = fixture();
    const result = await dispatch()(call());
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(effect).not.toHaveBeenCalled();
  });

  it.each(["nested input", "name", "id"])(
    "does not transfer approval after changing %s",
    async (change) => {
      const { effect, dispatch } = fixture();
      const approved = call();
      const execute = dispatch([approved]);
      const changed = structuredClone(approved);
      if (change === "nested input")
        changed.input = { ...changed.input, details: { content: "different" } };
      if (change === "name") changed.name = "edit_file";
      if (change === "id") changed.id = "other-call";
      expect((await execute(changed)).success).toBe(false);
      expect(effect).not.toHaveBeenCalled();
    },
  );

  it("snapshots nested approvals rather than retaining caller-owned objects or arrays", async () => {
    const { effect, dispatch } = fixture();
    const approved = call();
    const original = structuredClone(approved);
    const approvals = [approved];
    const execute = dispatch(approvals);
    (approved.input["details"] as { content: string }).content = "mutated-after-approval";
    const appended = { ...call(), id: "appended" };
    approvals.push(appended);
    expect((await execute(approved)).success).toBe(false);
    expect((await execute(appended)).success).toBe(false);
    expect(effect).not.toHaveBeenCalled();
    expect((await execute(original)).success).toBe(true);
    expect(effect).toHaveBeenCalledExactlyOnceWith(original.input, {
      executeDelegatedTool: expect.any(Function),
    });
  });

  it("requires common runtime confirmation for copy_file", async () => {
    const { effect, dispatch } = fixture();
    const copy = call("copy_file");
    expect((await dispatch()(copy)).success).toBe(false);
    expect(effect).not.toHaveBeenCalled();
    expect((await dispatch([copy])(copy)).success).toBe(true);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("does not let an approved write escape plan mode", async () => {
    const { effect, dispatch } = fixture("plan");
    const approved = call();
    const result = await dispatch([approved])(approved);
    expect(result.success).toBe(false);
    expect(result.error).toContain("read-only");
    expect(effect).not.toHaveBeenCalled();
  });

  it("allows an ordinary read without manufacturing approval", async () => {
    const { runtime, effect, dispatch } = fixture("plan");
    const boundary = vi.spyOn(runtime, "executeTool");
    const read = call("read_file");
    expect((await dispatch()(read)).success).toBe(true);
    expect(effect).toHaveBeenCalledExactlyOnceWith(read.input, {
      executeDelegatedTool: expect.any(Function),
    });
    expect(boundary).toHaveBeenCalledTimes(1);
    expect(boundary.mock.calls[0]?.[0].confirmed).not.toBe(true);
  });

  it("keeps runtime allowlists authoritative over approval", async () => {
    const { effect, dispatch } = fixture("build", { allowedTools: ["read_file"] });
    const approved = call();
    const result = await dispatch([approved])(approved);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Runtime policy does not allow tool");
    expect(effect).not.toHaveBeenCalled();
  });

  it("passes the same AbortSignal through the boundary and prevents an already aborted effect", async () => {
    const { runtime, registry, effect, dispatch } = fixture();
    const boundary = vi.spyOn(runtime, "executeTool");
    const registryExecute = vi.spyOn(registry, "execute");
    const controller = new AbortController();
    controller.abort();
    const result = await dispatch()(call("read_file"), controller.signal);
    expect(result.success).toBe(false);
    expect(effect).not.toHaveBeenCalled();
    expect(boundary).toHaveBeenCalledTimes(1);
    expect(boundary.mock.calls[0]?.[0].signal).toBe(controller.signal);
    expect(registryExecute).toHaveBeenCalledWith(
      "read_file",
      call("read_file").input,
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
