/**
 * Tests for CommandHeartbeat utility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CommandHeartbeat } from "./heartbeat.js";

describe("CommandHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("start() and stop()", () => {
    it("should initialize timers correctly", () => {
      const heartbeat = new CommandHeartbeat();

      heartbeat.start();
      const stats = heartbeat.getStats();

      expect(stats.elapsedSeconds).toBe(0);
      expect(stats.silentSeconds).toBe(0);

      heartbeat.stop();
    });

    it("should clear interval on stop()", () => {
      const onUpdate = vi.fn();
      const heartbeat = new CommandHeartbeat({ onUpdate });

      heartbeat.start();
      vi.advanceTimersByTime(10000); // 10s
      expect(onUpdate).toHaveBeenCalledTimes(1);

      heartbeat.stop();

      // After stop, no more updates
      vi.advanceTimersByTime(10000); // Another 10s
      expect(onUpdate).toHaveBeenCalledTimes(1); // Still 1
    });

    it("should handle multiple stop() calls safely", () => {
      const heartbeat = new CommandHeartbeat();

      heartbeat.start();
      heartbeat.stop();
      heartbeat.stop(); // Should not throw

      expect(() => heartbeat.stop()).not.toThrow();
    });
  });

  describe("onUpdate callback", () => {
    it("should call onUpdate every 10 seconds", () => {
      const onUpdate = vi.fn();
      const heartbeat = new CommandHeartbeat({ onUpdate });

      heartbeat.start();

      vi.advanceTimersByTime(10000); // 10s
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith({
        elapsedSeconds: 10,
        silentSeconds: 10,
      });

      vi.advanceTimersByTime(10000); // 20s total
      expect(onUpdate).toHaveBeenCalledTimes(2);
      expect(onUpdate).toHaveBeenCalledWith({
        elapsedSeconds: 20,
        silentSeconds: 20,
      });

      heartbeat.stop();
    });

    it("should not throw if onUpdate is not provided", () => {
      const heartbeat = new CommandHeartbeat();

      heartbeat.start();
      expect(() => vi.advanceTimersByTime(10000)).not.toThrow();

      heartbeat.stop();
    });
  });

  describe("onWarn callback", () => {
    it("should call onWarn when silent for 30 seconds", () => {
      const onWarn = vi.fn();
      const heartbeat = new CommandHeartbeat({ onWarn });

      heartbeat.start();

      // First update at 10s - no warning (silence < 30s)
      vi.advanceTimersByTime(10000);
      expect(onWarn).not.toHaveBeenCalled();

      // Second update at 20s - no warning (silence < 30s)
      vi.advanceTimersByTime(10000);
      expect(onWarn).not.toHaveBeenCalled();

      // Third update at 30s - warning (silence >= 30s)
      vi.advanceTimersByTime(10000);
      expect(onWarn).toHaveBeenCalledTimes(1);
      expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("30s"));

      // Fourth update at 40s - warning again
      vi.advanceTimersByTime(10000);
      expect(onWarn).toHaveBeenCalledTimes(2);
      expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("40s"));

      heartbeat.stop();
    });

    it("should not throw if onWarn is not provided", () => {
      const heartbeat = new CommandHeartbeat();

      heartbeat.start();
      expect(() => vi.advanceTimersByTime(30000)).not.toThrow();

      heartbeat.stop();
    });
  });

  describe("activity()", () => {
    it("should reset silence timer on activity", () => {
      const onWarn = vi.fn();
      const heartbeat = new CommandHeartbeat({ onWarn });

      heartbeat.start();

      // Advance 20s without activity
      vi.advanceTimersByTime(20000);

      // Register activity
      heartbeat.activity();

      // Advance another 20s (total 40s elapsed, but only 20s since activity)
      vi.advanceTimersByTime(20000);

      // Should NOT warn because silence is only 20s
      expect(onWarn).not.toHaveBeenCalled();

      heartbeat.stop();
    });

    it("should update silentSeconds in stats after activity", () => {
      const onUpdate = vi.fn();
      const heartbeat = new CommandHeartbeat({ onUpdate });

      heartbeat.start();

      // 10s without activity
      vi.advanceTimersByTime(10000);
      expect(onUpdate).toHaveBeenCalledWith({
        elapsedSeconds: 10,
        silentSeconds: 10,
      });

      // Register activity
      heartbeat.activity();

      // Another 10s (total 20s elapsed, but 10s since activity)
      vi.advanceTimersByTime(10000);
      expect(onUpdate).toHaveBeenCalledWith({
        elapsedSeconds: 20,
        silentSeconds: 10,
      });

      heartbeat.stop();
    });

    it("should prevent warnings with frequent activity", () => {
      const onWarn = vi.fn();
      const heartbeat = new CommandHeartbeat({ onWarn });

      heartbeat.start();

      // Activity every 5 seconds for 60 seconds
      for (let i = 0; i < 12; i++) {
        vi.advanceTimersByTime(5000);
        heartbeat.activity();
      }

      // Should never warn because silence never reaches 30s
      expect(onWarn).not.toHaveBeenCalled();

      heartbeat.stop();
    });
  });

  describe("getStats()", () => {
    it("should return accurate elapsed time", () => {
      const heartbeat = new CommandHeartbeat();

      heartbeat.start();

      vi.advanceTimersByTime(5000); // 5s
      expect(heartbeat.getStats().elapsedSeconds).toBe(5);

      vi.advanceTimersByTime(5000); // 10s total
      expect(heartbeat.getStats().elapsedSeconds).toBe(10);

      vi.advanceTimersByTime(15000); // 25s total
      expect(heartbeat.getStats().elapsedSeconds).toBe(25);

      heartbeat.stop();
    });

    it("should return accurate silent time", () => {
      const heartbeat = new CommandHeartbeat();

      heartbeat.start();

      vi.advanceTimersByTime(10000); // 10s without activity
      expect(heartbeat.getStats().silentSeconds).toBe(10);

      heartbeat.activity(); // Reset

      vi.advanceTimersByTime(5000); // 5s since activity
      expect(heartbeat.getStats().silentSeconds).toBe(5);

      heartbeat.stop();
    });

    it("should work correctly before start()", () => {
      const heartbeat = new CommandHeartbeat();

      // Should not throw
      const stats = heartbeat.getStats();
      expect(stats.elapsedSeconds).toBeGreaterThanOrEqual(0);
      expect(stats.silentSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe("integration scenarios", () => {
    it("should handle realistic command execution pattern", () => {
      const onUpdate = vi.fn();
      const onWarn = vi.fn();
      const heartbeat = new CommandHeartbeat({ onUpdate, onWarn });

      heartbeat.start();

      // Simulate npm install with bursts of activity
      // First 5s: active output
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(1000);
        heartbeat.activity();
      }

      // 10s update - no warning (only 5s silent)
      vi.advanceTimersByTime(5000);
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onWarn).not.toHaveBeenCalled();

      // Next 10s: silent (downloading)
      vi.advanceTimersByTime(10000);
      expect(onUpdate).toHaveBeenCalledTimes(2);
      expect(onWarn).not.toHaveBeenCalled(); // 15s silent

      // Activity burst
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(1000);
        heartbeat.activity();
      }

      // Continue
      vi.advanceTimersByTime(7000); // Total 30s, but only 10s since last activity
      expect(onUpdate).toHaveBeenCalledTimes(3);
      expect(onWarn).not.toHaveBeenCalled(); // No warning

      heartbeat.stop();
    });

    it("should warn for truly stalled command", () => {
      const onUpdate = vi.fn();
      const onWarn = vi.fn();
      const heartbeat = new CommandHeartbeat({ onUpdate, onWarn });

      heartbeat.start();

      // Command produces output initially
      heartbeat.activity();

      // Then becomes completely silent for 60s
      vi.advanceTimersByTime(60000);

      // Should have warned multiple times
      expect(onWarn).toHaveBeenCalled();
      expect(onWarn.mock.calls.length).toBeGreaterThan(0);

      heartbeat.stop();
    });
  });
});
