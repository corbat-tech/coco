/**
 * Performance metrics for orchestrator phases
 */

import type { Phase } from "../phases/types.js";

/**
 * Phase metrics
 */
export interface PhaseMetrics {
  phase: Phase;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  success: boolean;
  error?: string;
  details: Record<string, unknown>;
}

/**
 * Aggregated metrics
 */
export interface AggregatedMetrics {
  totalDurationMs: number;
  phaseCount: number;
  successCount: number;
  failureCount: number;
  averageDurationMs: number;
  phaseBreakdown: Record<Phase, {
    count: number;
    totalDurationMs: number;
    averageDurationMs: number;
    successRate: number;
  }>;
}

/**
 * Metrics collector
 */
export class MetricsCollector {
  private metrics: PhaseMetrics[] = [];
  private currentPhase: PhaseMetrics | null = null;

  /**
   * Start tracking a phase
   */
  startPhase(phase: Phase, details: Record<string, unknown> = {}): void {
    this.currentPhase = {
      phase,
      startTime: new Date(),
      success: false,
      details,
    };
  }

  /**
   * Complete current phase
   */
  completePhase(success: boolean, error?: string, additionalDetails?: Record<string, unknown>): void {
    if (!this.currentPhase) return;

    this.currentPhase.endTime = new Date();
    this.currentPhase.durationMs =
      this.currentPhase.endTime.getTime() - this.currentPhase.startTime.getTime();
    this.currentPhase.success = success;
    this.currentPhase.error = error;

    if (additionalDetails) {
      this.currentPhase.details = {
        ...this.currentPhase.details,
        ...additionalDetails,
      };
    }

    this.metrics.push(this.currentPhase);
    this.currentPhase = null;
  }

  /**
   * Add custom metric
   */
  addMetric(phase: Phase, durationMs: number, success: boolean, details?: Record<string, unknown>): void {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - durationMs);

    this.metrics.push({
      phase,
      startTime,
      endTime,
      durationMs,
      success,
      details: details || {},
    });
  }

  /**
   * Get all metrics
   */
  getMetrics(): PhaseMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get metrics for a specific phase
   */
  getPhaseMetrics(phase: Phase): PhaseMetrics[] {
    return this.metrics.filter((m) => m.phase === phase);
  }

  /**
   * Get aggregated metrics
   */
  getAggregatedMetrics(): AggregatedMetrics {
    const phases: Phase[] = ["idle", "converge", "orchestrate", "complete", "output"];
    const breakdown: AggregatedMetrics["phaseBreakdown"] = {} as any;

    for (const phase of phases) {
      const phaseMetrics = this.getPhaseMetrics(phase);
      const totalDuration = phaseMetrics.reduce((sum, m) => sum + (m.durationMs || 0), 0);
      const successCount = phaseMetrics.filter((m) => m.success).length;

      breakdown[phase] = {
        count: phaseMetrics.length,
        totalDurationMs: totalDuration,
        averageDurationMs: phaseMetrics.length > 0 ? totalDuration / phaseMetrics.length : 0,
        successRate: phaseMetrics.length > 0 ? successCount / phaseMetrics.length : 0,
      };
    }

    const totalDuration = this.metrics.reduce((sum, m) => sum + (m.durationMs || 0), 0);
    const successCount = this.metrics.filter((m) => m.success).length;

    return {
      totalDurationMs: totalDuration,
      phaseCount: this.metrics.length,
      successCount,
      failureCount: this.metrics.length - successCount,
      averageDurationMs: this.metrics.length > 0 ? totalDuration / this.metrics.length : 0,
      phaseBreakdown: breakdown,
    };
  }

  /**
   * Get last N metrics
   */
  getRecentMetrics(count: number): PhaseMetrics[] {
    return this.metrics.slice(-count);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.currentPhase = null;
  }

  /**
   * Export metrics as JSON
   */
  toJSON(): string {
    return JSON.stringify({
      metrics: this.metrics,
      aggregated: this.getAggregatedMetrics(),
    }, null, 2);
  }
}

/**
 * Create a metrics collector
 */
export function createMetricsCollector(): MetricsCollector {
  return new MetricsCollector();
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
