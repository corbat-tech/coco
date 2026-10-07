import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "./registry.js";
import type { ToolExecutionContext } from "./execution-context.js";

function delegate(label: string) {
  return vi.fn<NonNullable<ToolExecutionContext["executeDelegatedTool"]>>(async (call) => ({
    toolName: call.toolName,
    success: true,
    output: label,
    duration: 0,
    decision: { allowed: true, risk: "read-only" },
  }));
}

function fixture(
  execute: (input: { value: string }, context?: ToolExecutionContext) => Promise<unknown>,
) {
  const registry = new ToolRegistry();
  registry.register({
    name: "context_fixture",
    category: "search",
    description: "Context transport fixture",
    parameters: z.object({ value: z.string() }),
    execute,
  });
  return registry;
}

describe("ToolRegistry host execution context transport", () => {
  it("passes host context outside validated model parameters and ignores JSON authority spoofing", async () => {
    const dispatch = delegate("host authority");
    const context: ToolExecutionContext = { executeDelegatedTool: dispatch };
    const execute = vi.fn(async (input: { value: string }, received?: ToolExecutionContext) => {
      expect(input).toEqual({ value: "model value" });
      expect(received?.executeDelegatedTool).toBe(dispatch);
      return received?.executeDelegatedTool?.({
        toolName: "read_file",
        input: { path: "fixture" },
        mode: "plan",
        allowedTools: ["read_file"],
      });
    });
    const registry = fixture(execute);
    const input = JSON.parse(
      JSON.stringify({
        value: "model value",
        context: { confirmed: true, mode: "build" },
        executeDelegatedTool: "untrusted dispatch",
        signal: { aborted: false },
      }),
    );
    const result = await registry.execute("context_fixture", input, { context });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ output: "host authority" });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty("executeDelegatedTool");
  });

  it("keeps concurrent contexts separate and leaves no context on a subsequent direct call", async () => {
    const first = delegate("first");
    const second = delegate("second");
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const received = new Map<string, ToolExecutionContext | undefined>();
    const registry = fixture(async ({ value }, context) => {
      received.set(value, context);
      if (value !== "direct") await barrier;
      return context?.executeDelegatedTool?.({
        toolName: "read_file",
        input: {},
        mode: "plan",
        allowedTools: ["read_file"],
      });
    });
    const a = registry.execute(
      "context_fixture",
      { value: "a" },
      { context: { executeDelegatedTool: first } },
    );
    const b = registry.execute(
      "context_fixture",
      { value: "b" },
      { context: { executeDelegatedTool: second } },
    );
    release();
    const [resultA, resultB] = await Promise.all([a, b]);
    expect(resultA.data).toMatchObject({ output: "first" });
    expect(resultB.data).toMatchObject({ output: "second" });
    expect(received.get("a")?.executeDelegatedTool).toBe(first);
    expect(received.get("b")?.executeDelegatedTool).toBe(second);
    await registry.execute("context_fixture", { value: "direct" });
    expect(received.get("direct")).toBeUndefined();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not execute when the host context signal is already aborted", async () => {
    const execute = vi.fn(async () => "effect");
    const registry = fixture(execute);
    const controller = new AbortController();
    controller.abort();
    const result = await registry.execute(
      "context_fixture",
      { value: "value" },
      { context: { signal: controller.signal } },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cancel|abort/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["options", "context"])(
    "propagates cancellation from the %s signal to the combined tool signal",
    async (source) => {
      const optionsController = new AbortController();
      const contextController = new AbortController();
      const dispatch = delegate("host");
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      let receivedSignal: AbortSignal | undefined;
      const registry = fixture(async (_input, context) => {
        receivedSignal = context?.signal;
        started();
        expect(context?.executeDelegatedTool).toBe(dispatch);
        expect(receivedSignal).toBeDefined();
        await new Promise<void>((resolve) =>
          receivedSignal!.addEventListener("abort", () => resolve(), { once: true }),
        );
        return "cancel observed";
      });
      const pending = registry.execute(
        "context_fixture",
        { value: "value" },
        {
          signal: optionsController.signal,
          context: { signal: contextController.signal, executeDelegatedTool: dispatch },
        },
      );
      await ready;
      expect(receivedSignal?.aborted).toBe(false);
      (source === "options" ? optionsController : contextController).abort();
      await pending;
      expect(receivedSignal?.aborted).toBe(true);
      expect((source === "options" ? contextController : optionsController).signal.aborted).toBe(
        false,
      );
    },
  );

  it("forwards a direct execution option signal even without an explicit context", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async (_input: { value: string }, context?: ToolExecutionContext) => {
      expect(context?.signal).toBe(controller.signal);
      expect(context?.executeDelegatedTool).toBeUndefined();
    });
    const registry = fixture(execute);
    expect(
      (await registry.execute("context_fixture", { value: "value" }, { signal: controller.signal }))
        .success,
    ).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("preserves the single-argument tool call when neither context nor signal is provided", async () => {
    const execute = vi.fn(async (_input: { value: string }) => "result");
    const registry = fixture(execute);
    const result = await registry.execute("context_fixture", { value: "value" });
    expect(result.success).toBe(true);
    expect(execute.mock.calls).toEqual([[{ value: "value" }]]);
  });
});
