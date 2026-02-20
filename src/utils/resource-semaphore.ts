/**
 * Resource-aware semaphore — extends the base createSemaphore() from async.ts
 * with dynamic concurrency that shrinks under memory or CPU pressure.
 *
 * Usage:
 *   const sem = createResourceAwareSemaphore({ maxConcurrency: 5 });
 *   const result = await sem.withSemaphore(() => runExpensiveOp());
 */

import os from "node:os";

/**
 * Resource limits for the semaphore
 */
export interface ResourceLimits {
  /** Hard ceiling on concurrent tasks */
  maxConcurrency: number;
  /** Never go below this, even under pressure */
  minConcurrency: number;
  /** Halve concurrency when system RAM usage % exceeds this */
  memoryThresholdPct: number;
  /** Reduce concurrency by 25% when 1-min load / cpuCount exceeds this */
  cpuLoadThreshold: number;
}

const DEFAULTS: ResourceLimits = {
  maxConcurrency: os.cpus().length,
  minConcurrency: 1,
  memoryThresholdPct: 80,
  cpuLoadThreshold: 0.75,
};

/**
 * Compute how many tasks should run concurrently given current resource state.
 */
function computeEffectiveConcurrency(cfg: ResourceLimits): number {
  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  const memUsedPct = ((totalMem - freeMem) / totalMem) * 100;
  const [loadAvg1m = 0] = os.loadavg();
  const cpuCount = os.cpus().length;

  if (memUsedPct > cfg.memoryThresholdPct) {
    // Memory pressure: halve concurrency
    return Math.max(cfg.minConcurrency, Math.floor(cfg.maxConcurrency / 2));
  }

  if (loadAvg1m > cpuCount * cfg.cpuLoadThreshold) {
    // CPU load: reduce by 25%
    return Math.max(cfg.minConcurrency, Math.floor(cfg.maxConcurrency * 0.75));
  }

  return cfg.maxConcurrency;
}

/**
 * Create a semaphore that re-evaluates resource pressure before each acquisition.
 * Unlike a static semaphore, the effective concurrency can shrink or grow between runs.
 */
export function createResourceAwareSemaphore(limits: Partial<ResourceLimits> = {}) {
  const cfg: ResourceLimits = { ...DEFAULTS, ...limits };

  // Internal queue of waiters
  const queue: Array<() => void> = [];
  let currentCount = 0;

  async function acquire(): Promise<void> {
    const effective = computeEffectiveConcurrency(cfg);
    if (currentCount < effective) {
      currentCount++;
      return;
    }
    return new Promise<void>((resolve) => {
      queue.push(resolve);
    });
  }

  function release(): void {
    currentCount--;
    const next = queue.shift();
    if (next) {
      currentCount++;
      next();
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

  return {
    withSemaphore,
    /** Returns the concurrency the semaphore would allow right now */
    getEffectiveConcurrency: () => computeEffectiveConcurrency(cfg),
  };
}
