/**
 * Tests for orchestrator metrics
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MetricsCollector,
  createMetricsCollector,
  formatDuration,
} from "./metrics.js";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe("startPhase / completePhase", () => {
    it("should track phase execution", () => {
      collector.startPhase("converge", { task: "gather requirements" });
      collector.completePhase(true);

      const metrics = collector.getMetrics();

      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.phase).toBe("converge");
      expect(metrics[0]?.success).toBe(true);
      expect(metrics[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should track failed phases", () => {
      collector.startPhase("complete");
      collector.completePhase(false, "Task failed");

      const metrics = collector.getMetrics();

      expect(metrics[0]?.success).toBe(false);
      expect(metrics[0]?.error).toBe("Task failed");
    });

    it("should merge additional details on complete", () => {
      collector.startPhase("orchestrate", { initial: "value" });
      collector.completePhase(true, undefined, { result: "success" });

      const metrics = collector.getMetrics();

      expect(metrics[0]?.details).toEqual({
        initial: "value",
        result: "success",
      });
    });

    it("should handle complete without start", () => {
      collector.completePhase(true);

      expect(collector.getMetrics()).toHaveLength(0);
    });
  });

  describe("addMetric", () => {
    it("should add custom metrics", () => {
      collector.addMetric("output", 1500, true, { files: 5 });

      const metrics = collector.getMetrics();

      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.phase).toBe("output");
      expect(metrics[0]?.durationMs).toBe(1500);
      expect(metrics[0]?.success).toBe(true);
      expect(metrics[0]?.details).toEqual({ files: 5 });
    });
  });

  describe("getPhaseMetrics", () => {
    it("should filter metrics by phase", () => {
      collector.addMetric("converge", 100, true);
      collector.addMetric("orchestrate", 200, true);
      collector.addMetric("converge", 150, true);

      const convergeMetrics = collector.getPhaseMetrics("converge");

      expect(convergeMetrics).toHaveLength(2);
      expect(convergeMetrics.every((m) => m.phase === "converge")).toBe(true);
    });

    it("should return empty array for phase with no metrics", () => {
      collector.addMetric("converge", 100, true);

      const outputMetrics = collector.getPhaseMetrics("output");

      expect(outputMetrics).toHaveLength(0);
    });
  });

  describe("getAggregatedMetrics", () => {
    it("should calculate aggregated metrics", () => {
      collector.addMetric("converge", 1000, true);
      collector.addMetric("orchestrate", 2000, true);
      collector.addMetric("complete", 3000, false);

      const aggregated = collector.getAggregatedMetrics();

      expect(aggregated.totalDurationMs).toBe(6000);
      expect(aggregated.phaseCount).toBe(3);
      expect(aggregated.successCount).toBe(2);
      expect(aggregated.failureCount).toBe(1);
      expect(aggregated.averageDurationMs).toBe(2000);
    });

    it("should calculate phase breakdown", () => {
      collector.addMetric("converge", 1000, true);
      collector.addMetric("converge", 1500, true);
      collector.addMetric("converge", 500, false);

      const aggregated = collector.getAggregatedMetrics();
      const converge = aggregated.phaseBreakdown.converge;

      expect(converge.count).toBe(3);
      expect(converge.totalDurationMs).toBe(3000);
      expect(converge.averageDurationMs).toBe(1000);
      expect(converge.successRate).toBeCloseTo(0.667, 2);
    });

    it("should handle empty metrics", () => {
      const aggregated = collector.getAggregatedMetrics();

      expect(aggregated.totalDurationMs).toBe(0);
      expect(aggregated.phaseCount).toBe(0);
      expect(aggregated.averageDurationMs).toBe(0);
    });
  });

  describe("getRecentMetrics", () => {
    it("should return last N metrics", () => {
      collector.addMetric("converge", 100, true);
      collector.addMetric("orchestrate", 200, true);
      collector.addMetric("complete", 300, true);
      collector.addMetric("output", 400, true);

      const recent = collector.getRecentMetrics(2);

      expect(recent).toHaveLength(2);
      expect(recent[0]?.phase).toBe("complete");
      expect(recent[1]?.phase).toBe("output");
    });
  });

  describe("clear", () => {
    it("should clear all metrics", () => {
      collector.addMetric("converge", 100, true);
      collector.addMetric("orchestrate", 200, true);

      collector.clear();

      expect(collector.getMetrics()).toHaveLength(0);
    });

    it("should clear current phase", () => {
      collector.startPhase("converge");
      collector.clear();
      collector.completePhase(true);

      expect(collector.getMetrics()).toHaveLength(0);
    });
  });

  describe("toJSON", () => {
    it("should export metrics as JSON", () => {
      collector.addMetric("converge", 100, true);

      const json = collector.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.metrics).toHaveLength(1);
      expect(parsed.aggregated).toBeDefined();
      expect(parsed.aggregated.phaseCount).toBe(1);
    });
  });
});

describe("createMetricsCollector", () => {
  it("should create a new collector", () => {
    const collector = createMetricsCollector();

    expect(collector).toBeInstanceOf(MetricsCollector);
    expect(collector.getMetrics()).toHaveLength(0);
  });
});

describe("formatDuration", () => {
  it("should format milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("should format seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(5500)).toBe("5.5s");
    expect(formatDuration(59999)).toBe("60.0s");
  });

  it("should format minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(90000)).toBe("1m 30s");
    expect(formatDuration(125000)).toBe("2m 5s");
  });
});
