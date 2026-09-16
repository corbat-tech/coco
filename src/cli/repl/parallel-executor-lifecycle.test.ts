import { afterEach, describe, expect, it, vi } from "vitest";
import { ParallelToolExecutor } from "./parallel-executor.js";

const calls = Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, name: `tool_${i}`, input: {} }));

describe("parallel execution lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for later batches, keeping result order and releasing its timer", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const last = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async (name: string) => {
      if (name === "tool_5") await last;
      return { success: true, data: name, duration: 0 };
    });
    let finished = false;
    const pending = new ParallelToolExecutor()
      .executeParallel(calls, (call) => execute(call.name))
      .then((result) => {
        finished = true;
        return result;
      });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(execute).toHaveBeenCalledTimes(6);
      expect(finished).toBe(false);
    } finally {
      release();
      await pending;
    }
    expect((await pending).executed.map(({ id }) => id)).toEqual(calls.map(({ id }) => id));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up its safety timer and abort listener after normal completion", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const execute = vi.fn(async (_name: string) => ({ success: true, data: "ok", duration: 0 }));
    await new ParallelToolExecutor().executeParallel(
      calls.slice(0, 1),
      (call) => execute(call.name),
      { signal: controller.signal },
    );
    expect(vi.getTimerCount()).toBe(0);
    for (const [event, listener] of add.mock.calls) {
      expect(remove).toHaveBeenCalledWith(event, listener);
    }
  });
});
