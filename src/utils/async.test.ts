/**
 * Tests for async utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve after specified time", async () => {
    const { sleep } = await import("./async.js");

    const promise = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve if promise completes in time", async () => {
    const { timeout } = await import("./async.js");

    const fastPromise = Promise.resolve("success");
    const result = await timeout(fastPromise, 1000);

    expect(result).toBe("success");
  });

  it("should reject with TimeoutError if promise takes too long", async () => {
    const { timeout } = await import("./async.js");
    const { TimeoutError } = await import("./errors.js");

    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("too late"), 2000);
    });

    const promise = timeout(slowPromise, 1000, "Test operation");
    vi.advanceTimersByTime(1000);

    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should debounce function calls", async () => {
    const { debounce } = await import("./async.js");

    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should reset timer on each call", async () => {
    const { debounce } = await import("./async.js");

    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should throttle function calls", async () => {
    const { throttle } = await import("./async.js");

    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    throttled();
    throttled();

    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    throttled();

    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("retry", () => {
  it("should return result on first success", async () => {
    const { retry } = await import("./async.js");

    const fn = vi.fn().mockResolvedValue("success");

    const result = await retry(fn, { maxAttempts: 3 });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure", async () => {
    const { retry } = await import("./async.js");

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("success");

    const result = await retry(fn, { maxAttempts: 3, initialDelay: 10 });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should throw after max attempts", async () => {
    const { retry } = await import("./async.js");

    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(
      retry(fn, { maxAttempts: 3, initialDelay: 10 })
    ).rejects.toThrow("always fails");

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should call onRetry callback", async () => {
    const { retry } = await import("./async.js");

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("success");

    const onRetry = vi.fn();

    await retry(fn, { maxAttempts: 3, initialDelay: 10, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });
});

describe("parallel", () => {
  it("should run items in parallel with concurrency limit", async () => {
    const { parallel } = await import("./async.js");

    const items = [1, 2, 3, 4, 5];
    const fn = vi.fn().mockImplementation(async (item) => item * 2);

    const results = await parallel(items, fn, 2);

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("should preserve order of results", async () => {
    const { parallel } = await import("./async.js");

    const items = [100, 50, 10];
    const fn = async (delay: number) => {
      await new Promise((r) => setTimeout(r, delay));
      return delay;
    };

    const results = await parallel(items, fn, 3);

    expect(results).toEqual([100, 50, 10]);
  });
});

describe("sequential", () => {
  it("should run items sequentially", async () => {
    const { sequential } = await import("./async.js");

    const order: number[] = [];
    const items = [1, 2, 3];

    const fn = async (item: number) => {
      order.push(item);
      return item * 2;
    };

    const results = await sequential(items, fn);

    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([2, 4, 6]);
  });
});

describe("deferred", () => {
  it("should create a deferred promise", async () => {
    const { deferred } = await import("./async.js");

    const d = deferred<string>();

    setTimeout(() => d.resolve("resolved"), 10);

    const result = await d.promise;
    expect(result).toBe("resolved");
  });

  it("should allow rejection", async () => {
    const { deferred } = await import("./async.js");

    const d = deferred<string>();

    setTimeout(() => d.reject(new Error("rejected")), 10);

    await expect(d.promise).rejects.toThrow("rejected");
  });
});

describe("createMutex", () => {
  it("should allow sequential access", async () => {
    const { createMutex } = await import("./async.js");

    const mutex = createMutex();
    const order: string[] = [];

    const task = async (name: string) => {
      await mutex.withLock(async () => {
        order.push(`${name}-start`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`${name}-end`);
      });
    };

    await Promise.all([task("A"), task("B")]);

    // Either A completes before B starts, or vice versa
    expect(
      order.indexOf("A-end") < order.indexOf("B-start") ||
        order.indexOf("B-end") < order.indexOf("A-start")
    ).toBe(true);
  });
});

describe("createSemaphore", () => {
  it("should limit concurrency", async () => {
    const { createSemaphore } = await import("./async.js");

    const semaphore = createSemaphore(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = async () => {
      await semaphore.withSemaphore(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
      });
    };

    await Promise.all([task(), task(), task(), task()]);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
