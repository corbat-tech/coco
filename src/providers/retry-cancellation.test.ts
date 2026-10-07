import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry.js";

const config = { maxRetries: 2, initialDelayMs: 1000, maxDelayMs: 5000, jitterFactor: 0 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("provider retry cancellation", () => {
  it("does not invoke the operation when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => "unexpected success");
    await expect(withRetry(fn, config, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("aborting during backoff clears the timer and listener without another invocation", async () => {
    const controller = new AbortController();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 rate limit"))
      .mockResolvedValue("must not run");
    const pending = withRetry(fn, config, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
    controller.abort();
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("does not retry a retryable rejection received after aborting an in-flight operation", async () => {
    const controller = new AbortController();
    let fail!: (error: Error) => void;
    const operation = new Promise<string>((_resolve, reject) => {
      fail = reject;
    });
    const fn = vi.fn(() => operation);
    const pending = withRetry(fn, config, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    fail(new Error("503 temporarily unavailable"));
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("does not deliver a successful result that arrives after cancellation", async () => {
    const controller = new AbortController();
    let finish!: (value: string) => void;
    const fn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = withRetry(fn, config, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    finish("late successful response");
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("does not retry an AbortError even when its message contains a retryable status", async () => {
    const error = Object.assign(new Error("429 rate limit while request aborted"), {
      name: "AbortError",
    });
    const fn = vi.fn().mockRejectedValue(error);
    const pending = withRetry(fn, config);
    const assertion = expect(pending).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans completed backoff listeners while preserving unrelated signal listeners", async () => {
    const controller = new AbortController();
    const unrelated = vi.fn();
    controller.signal.addEventListener("abort", unrelated);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 service unavailable"))
      .mockResolvedValue("retried success");
    const pending = withRetry(fn, config, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe("retried success");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(getEventListeners(controller.signal, "abort")).toEqual([unrelated]);
    expect(vi.getTimerCount()).toBe(0);
    controller.signal.removeEventListener("abort", unrelated);
  });

  it("preserves retries for existing callers that supply no AbortSignal", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("recovered");
    const pending = withRetry(fn, config);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await expect(withRetry(async () => "default configuration")).resolves.toBe(
      "default configuration",
    );
  });
});
