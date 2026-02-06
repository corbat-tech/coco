/**
 * Async utilities for Corbat-Coco
 */

import { TimeoutError } from "./errors.js";

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a promise with a timeout
 */
export async function timeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string = "Operation",
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new TimeoutError(`${operation} timed out after ${ms}ms`, {
          timeoutMs: ms,
          operation,
        }),
      );
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, ms);
  };
}

/**
 * Throttle a function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= ms) {
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn(...args);
      }, ms - timeSinceLastCall);
    }
  };
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
    onRetry?: (error: unknown, attempt: number) => void;
  } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelay = options.initialDelay ?? 1000;
  const maxDelay = options.maxDelay ?? 30000;
  const factor = options.factor ?? 2;

  let delay = initialDelay;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        throw error;
      }

      options.onRetry?.(error, attempt);

      await sleep(delay);
      delay = Math.min(delay * factor, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Run promises in parallel with concurrency limit
 * Uses proper async tracking without race conditions
 */
export async function parallel<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = 5,
): Promise<R[]> {
  const results: R[] = Array.from<R>({ length: items.length });
  const executing = new Map<number, Promise<void>>();
  let nextId = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;

    const id = nextId++;
    const promise = fn(item, i)
      .then((result) => {
        results[i] = result;
      })
      .finally(() => {
        executing.delete(id);
      });

    executing.set(id, promise);

    // Wait for one to complete if at concurrency limit
    if (executing.size >= concurrency) {
      await Promise.race(executing.values());
    }
  }

  // Wait for remaining promises
  await Promise.all(executing.values());
  return results;
}

/**
 * Run promises sequentially
 */
export async function sequential<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;
    results[i] = await fn(item, i);
  }

  return results;
}

/**
 * Create a deferred promise
 */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Run a function with a lock (mutex)
 */
export function createMutex() {
  let locked = false;
  const queue: (() => void)[] = [];

  async function acquire(): Promise<void> {
    if (!locked) {
      locked = true;
      return;
    }

    return new Promise((resolve) => {
      queue.push(resolve);
    });
  }

  function release(): void {
    const next = queue.shift();
    if (next) {
      next();
    } else {
      locked = false;
    }
  }

  async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return { acquire, release, withLock };
}

/**
 * Create a semaphore for limiting concurrency
 */
export function createSemaphore(maxConcurrency: number) {
  let current = 0;
  const queue: (() => void)[] = [];

  async function acquire(): Promise<void> {
    if (current < maxConcurrency) {
      current++;
      return;
    }

    return new Promise((resolve) => {
      queue.push(resolve);
    });
  }

  function release(): void {
    const next = queue.shift();
    if (next) {
      next();
    } else {
      current--;
    }
  }

  async function withSemaphore<T>(fn: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return { acquire, release, withSemaphore };
}
