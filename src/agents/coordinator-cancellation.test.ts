import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCoordinator } from "./coordinator.js";
import type { AgentExecutor, AgentResult, AgentTask } from "./executor.js";
import type { ToolExecutionContext } from "../tools/execution-context.js";

vi.mock("../utils/resource-semaphore.js", () => ({
  createResourceAwareSemaphore: () => ({
    withSemaphore: async (fn: () => Promise<unknown>) => fn(),
  }),
}));
const result: AgentResult = { success: true, output: "done", turns: 1, toolsUsed: [], duration: 0 };
const tasks: AgentTask[] = [
  { id: "first", description: "implement" },
  { id: "second", description: "implement", dependencies: ["first"] },
];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function coordinator(execute = vi.fn().mockResolvedValue(result)) {
  return {
    execute,
    coordinator: new AgentCoordinator({ execute } as unknown as AgentExecutor, new Map()),
  };
}

describe("coordination lifetime", () => {
  it("rejects pre-abort before starting any agent", async () => {
    const c = coordinator();
    const host = new AbortController();
    const reason = new Error("host abort");
    host.abort(reason);
    await expect(
      c.coordinator.coordinateAgents(tasks, { signal: host.signal, timeoutMs: 10 }),
    ).rejects.toBe(reason);
    expect(c.execute).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses one deadline across levels and refuses late success", async () => {
    const host = new AbortController();
    const signals: AbortSignal[] = [];
    const c = coordinator(
      vi.fn(async (_agent: unknown, _task: unknown, context: ToolExecutionContext) => {
        signals.push(context.signal!);
        await new Promise((resolve) => setTimeout(resolve, 8));
        return result;
      }),
    );
    const outcome = c.coordinator
      .coordinateAgents(tasks, { signal: host.signal, timeoutMs: 10 })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(16);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(getEventListeners(host.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not run the next batch after cancellation during a successful child result", async () => {
    const host = new AbortController();
    const reason = new Error("stop");
    const c = coordinator(
      vi.fn(async () => {
        host.abort(reason);
        return result;
      }),
    );
    await expect(
      c.coordinator.coordinateAgents(
        tasks.map((t) => ({ ...t, dependencies: [] })),
        { signal: host.signal, maxParallelAgents: 1 },
      ),
    ).rejects.toBe(reason);
    expect(c.execute).toHaveBeenCalledOnce();
  });
  it("aborts siblings on throw but waits until they settle before returning", async () => {
    const reason = new Error("child failure");
    let siblingSignal!: AbortSignal;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const c = coordinator(
      vi.fn(async (_agent: unknown, task: AgentTask, context: ToolExecutionContext) => {
        if (task.id === "first") {
          await Promise.resolve();
          throw reason;
        }
        siblingSignal = context.signal!;
        await pending;
        return result;
      }),
    );
    let settled = false;
    const outcome = c.coordinator
      .coordinateAgents(
        tasks.map((t) => ({ ...t, dependencies: [] })),
        { maxParallelAgents: 2 },
      )
      .catch((error) => {
        settled = true;
        return error;
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(siblingSignal.aborted).toBe(true);
    expect(settled).toBe(false);
    release();
    expect(await outcome).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, -1, 1.5, NaN, Infinity])(
    "rejects invalid concurrency %s without scheduling",
    async (maxParallelAgents) => {
      const c = coordinator();
      await expect(
        c.coordinator.coordinateAgents(tasks, { maxParallelAgents }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(c.execute).not.toHaveBeenCalled();
    },
  );
  it("cleans deadline and host listener after success or graph error", async () => {
    const host = new AbortController();
    const c = coordinator();
    await c.coordinator.coordinateAgents(tasks, { signal: host.signal, timeoutMs: 100 });
    await expect(
      c.coordinator.coordinateAgents([{ ...tasks[0]!, dependencies: ["missing"] }], {
        signal: host.signal,
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/dependency/);
    expect(getEventListeners(host.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
