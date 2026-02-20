/**
 * Resource Monitor - RAM/CPU via Node.js built-ins
 * Uses process.memoryUsage(), os.freemem(), and os.loadavg()
 * No external dependencies required.
 */

import os from "node:os";

/**
 * Snapshot of system and process resource usage
 */
export interface ResourceSnapshot {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number; // Resident Set Size — true process RAM
  freeSystemMb: number;
  totalSystemMb: number;
  systemMemoryPct: number; // % of system RAM in use
  loadAvg1m: number; // 1-minute CPU load average (0 on Windows)
  cpuCount: number;
}

/**
 * Capture a point-in-time snapshot of resource usage
 */
export function getResourceSnapshot(): ResourceSnapshot {
  const mem = process.memoryUsage();
  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  const [loadAvg1m = 0] = os.loadavg();

  return {
    heapUsedMb: mem.heapUsed / 1024 / 1024,
    heapTotalMb: mem.heapTotal / 1024 / 1024,
    rssMb: mem.rss / 1024 / 1024,
    freeSystemMb: freeMem / 1024 / 1024,
    totalSystemMb: totalMem / 1024 / 1024,
    systemMemoryPct: ((totalMem - freeMem) / totalMem) * 100,
    loadAvg1m,
    cpuCount: os.cpus().length,
  };
}

/**
 * Returns true when system RAM usage exceeds the threshold percentage
 */
export function isMemoryPressured(thresholdPct = 85): boolean {
  const snap = getResourceSnapshot();
  return snap.systemMemoryPct > thresholdPct;
}

/**
 * Returns true when the 1-minute CPU load average exceeds the threshold
 * multiplied by the number of CPU cores. Always returns false on Windows
 * (loadavg returns [0,0,0] there).
 */
export function isCpuLoaded(thresholdMultiplier = 0.8): boolean {
  const snap = getResourceSnapshot();
  return snap.loadAvg1m > snap.cpuCount * thresholdMultiplier;
}

/**
 * Compute the maximum number of agents that can safely run in parallel
 * given current resource pressure.
 *
 * - Base: cpu count * 0.75 (leave headroom)
 * - Under memory pressure (> memThresholdPct): halve the result
 * - Under CPU load (> cpuThresholdMultiplier per core): reduce by 25%
 * - Always at least 1
 */
export function getMaxSafeAgents(
  memThresholdPct = 85,
  cpuThresholdMultiplier = 0.8,
): number {
  const snap = getResourceSnapshot();
  let max = Math.max(1, Math.floor(snap.cpuCount * 0.75));

  if (snap.systemMemoryPct > memThresholdPct) {
    max = Math.max(1, Math.floor(max / 2));
  } else if (snap.loadAvg1m > snap.cpuCount * cpuThresholdMultiplier) {
    max = Math.max(1, Math.floor(max * 0.75));
  }

  return max;
}
