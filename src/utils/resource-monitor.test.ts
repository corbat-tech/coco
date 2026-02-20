/**
 * Tests for resource-monitor.ts
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import os from "node:os";

// We mock os and process.memoryUsage before importing the module
vi.mock("node:os", () => ({
  default: {
    freemem: vi.fn(() => 4 * 1024 * 1024 * 1024), // 4 GB free
    totalmem: vi.fn(() => 16 * 1024 * 1024 * 1024), // 16 GB total
    loadavg: vi.fn(() => [1.0, 1.2, 1.1]),
    cpus: vi.fn(() => Array.from({ length: 8 }).fill({})),
  },
}));

const mockMemoryUsage = vi.fn(() => ({
  rss: 100 * 1024 * 1024,
  heapTotal: 80 * 1024 * 1024,
  heapUsed: 50 * 1024 * 1024,
  external: 5 * 1024 * 1024,
  arrayBuffers: 1 * 1024 * 1024,
}));

vi.stubGlobal("process", {
  ...process,
  memoryUsage: mockMemoryUsage,
});

import {
  getResourceSnapshot,
  isMemoryPressured,
  isCpuLoaded,
  getMaxSafeAgents,
} from "./resource-monitor.js";

const mockOs = vi.mocked(os);

afterEach(() => {
  vi.clearAllMocks();
});

describe("getResourceSnapshot", () => {
  it("returns correct memory percentages", () => {
    // 4 GB free / 16 GB total = 75% used
    mockOs.freemem.mockReturnValue(4 * 1024 * 1024 * 1024);
    mockOs.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024);

    const snap = getResourceSnapshot();

    expect(snap.systemMemoryPct).toBeCloseTo(75, 0);
    expect(snap.freeSystemMb).toBeCloseTo(4096, 0);
    expect(snap.totalSystemMb).toBeCloseTo(16384, 0);
  });

  it("returns process heap and rss in MB", () => {
    const snap = getResourceSnapshot();
    expect(snap.heapUsedMb).toBeCloseTo(50, 0);
    expect(snap.heapTotalMb).toBeCloseTo(80, 0);
    expect(snap.rssMb).toBeCloseTo(100, 0);
  });

  it("returns load average and cpu count", () => {
    mockOs.loadavg.mockReturnValue([2.4, 1.8, 1.5]);
    mockOs.cpus.mockReturnValue(Array.from({ length: 4 }).fill({}) as os.CpuInfo[]);

    const snap = getResourceSnapshot();
    expect(snap.loadAvg1m).toBe(2.4);
    expect(snap.cpuCount).toBe(4);
  });
});

describe("isMemoryPressured", () => {
  it("returns false when memory usage is below threshold", () => {
    // 4 GB free / 16 GB = 75% used — below default threshold of 85%
    mockOs.freemem.mockReturnValue(4 * 1024 * 1024 * 1024);
    mockOs.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024);

    expect(isMemoryPressured()).toBe(false);
  });

  it("returns true when memory usage exceeds threshold", () => {
    // 1 GB free / 16 GB = 93.75% used — above threshold
    mockOs.freemem.mockReturnValue(1 * 1024 * 1024 * 1024);
    mockOs.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024);

    expect(isMemoryPressured(85)).toBe(true);
  });

  it("respects custom threshold", () => {
    // 75% used
    mockOs.freemem.mockReturnValue(4 * 1024 * 1024 * 1024);
    mockOs.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024);

    expect(isMemoryPressured(70)).toBe(true);
    expect(isMemoryPressured(80)).toBe(false);
  });
});

describe("isCpuLoaded", () => {
  it("returns false when load is below threshold", () => {
    // 4 CPUs, load 1.0 = 0.25 per core — below 0.8 threshold
    mockOs.loadavg.mockReturnValue([1.0, 1.0, 1.0]);
    mockOs.cpus.mockReturnValue(Array.from({ length: 4 }).fill({}) as os.CpuInfo[]);

    expect(isCpuLoaded()).toBe(false);
  });

  it("returns true when load exceeds threshold", () => {
    // 4 CPUs, load 4.0 = 1.0 per core — above 0.8 threshold
    mockOs.loadavg.mockReturnValue([4.0, 3.5, 3.0]);
    mockOs.cpus.mockReturnValue(Array.from({ length: 4 }).fill({}) as os.CpuInfo[]);

    expect(isCpuLoaded()).toBe(true);
  });
});

describe("getMaxSafeAgents", () => {
  it("returns 75% of cpu count under normal conditions", () => {
    // 8 CPUs, 75% used memory, load 1.0/8 = fine
    mockOs.freemem.mockReturnValue(4 * 1024 * 1024 * 1024);
    mockOs.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024);
    mockOs.loadavg.mockReturnValue([1.0, 1.0, 1.0]);
    mockOs.cpus.mockReturnValue(Array.from({ length: 8 }).fill({}) as os.CpuInfo[]);

    expect(getMaxSafeAgents()).toBe(6); // floor(8 * 0.75)
  });

  it("halves max when memory is pressured", () => {
    // 93.75% used
    mockOs.freemem.mockReturnValue(1 * 1024 * 1024 * 1024);
    mockOs.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024);
    mockOs.loadavg.mockReturnValue([1.0, 1.0, 1.0]);
    mockOs.cpus.mockReturnValue(Array.from({ length: 8 }).fill({}) as os.CpuInfo[]);

    expect(getMaxSafeAgents()).toBe(3); // floor(floor(8 * 0.75) / 2)
  });

  it("reduces by 25% when CPU is loaded", () => {
    // 75% memory, high CPU load
    mockOs.freemem.mockReturnValue(4 * 1024 * 1024 * 1024);
    mockOs.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024);
    // Load = 7.0 on 8 CPUs = 0.875 per core > 0.8 threshold
    mockOs.loadavg.mockReturnValue([7.0, 6.0, 5.5]);
    mockOs.cpus.mockReturnValue(Array.from({ length: 8 }).fill({}) as os.CpuInfo[]);

    expect(getMaxSafeAgents()).toBe(4); // floor(6 * 0.75) = floor(4.5) = 4
  });

  it("always returns at least 1", () => {
    // Extreme pressure: 1 CPU, high load
    mockOs.freemem.mockReturnValue(100 * 1024); // 100 KB free
    mockOs.totalmem.mockReturnValue(100 * 1024 * 1024); // 100 MB total
    mockOs.loadavg.mockReturnValue([5.0, 5.0, 5.0]);
    mockOs.cpus.mockReturnValue([{}] as os.CpuInfo[]);

    expect(getMaxSafeAgents()).toBeGreaterThanOrEqual(1);
  });
});
