/**
 * Quality regression detection for Corbat-Coco
 * Detect when quality scores decrease between iterations
 */

import type { QualityScores, QualityDimensions } from "./types.js";

/**
 * Regression severity level
 */
export type RegressionSeverity = "minor" | "moderate" | "severe";

/**
 * Single regression entry
 */
export interface RegressionEntry {
  dimension: keyof QualityDimensions;
  previousScore: number;
  currentScore: number;
  delta: number;
  percentChange: number;
  severity: RegressionSeverity;
}

/**
 * Regression detection result
 */
export interface RegressionResult {
  /** Whether any regression was detected */
  hasRegression: boolean;
  /** List of detected regressions */
  regressions: RegressionEntry[];
  /** Overall score change */
  overallDelta: number;
  /** Whether overall score regressed */
  overallRegressed: boolean;
  /** Severity of the worst regression */
  worstSeverity: RegressionSeverity | null;
  /** Summary message */
  summary: string;
}

/**
 * Options for regression detection
 */
export interface RegressionOptions {
  /**
   * Minimum score decrease to consider as regression (default: 2)
   * Smaller changes are considered noise
   */
  minDelta?: number;
  /**
   * Minimum percent decrease to consider as regression (default: 5%)
   * Alternative threshold for relative changes
   */
  minPercentChange?: number;
  /**
   * Dimensions to ignore in regression check
   */
  ignoreDimensions?: (keyof QualityDimensions)[];
  /**
   * Threshold for severe regression (default: 10 points)
   */
  severeThreshold?: number;
  /**
   * Threshold for moderate regression (default: 5 points)
   */
  moderateThreshold?: number;
}

const DEFAULT_OPTIONS: Required<RegressionOptions> = {
  minDelta: 2,
  minPercentChange: 5,
  ignoreDimensions: [],
  severeThreshold: 10,
  moderateThreshold: 5,
};

/**
 * Determine severity of a regression
 */
function getSeverity(
  delta: number,
  severeThreshold: number,
  moderateThreshold: number
): RegressionSeverity {
  const absDelta = Math.abs(delta);
  if (absDelta >= severeThreshold) return "severe";
  if (absDelta >= moderateThreshold) return "moderate";
  return "minor";
}

/**
 * Detect quality score regressions between two evaluations
 *
 * @example
 * const result = detectRegression(previousScores, currentScores);
 * if (result.hasRegression) {
 *   console.log(`Regression detected: ${result.summary}`);
 *   for (const r of result.regressions) {
 *     console.log(`  ${r.dimension}: ${r.previousScore} → ${r.currentScore} (${r.delta})`);
 *   }
 * }
 */
export function detectRegression(
  previous: QualityScores,
  current: QualityScores,
  options: RegressionOptions = {}
): RegressionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const regressions: RegressionEntry[] = [];
  const ignoredSet = new Set(opts.ignoreDimensions);

  // Check each dimension
  const dimensions = Object.keys(previous.dimensions) as (keyof QualityDimensions)[];

  for (const dim of dimensions) {
    if (ignoredSet.has(dim)) continue;

    const prevScore = previous.dimensions[dim];
    const currScore = current.dimensions[dim];
    const delta = currScore - prevScore;
    const percentChange = prevScore > 0 ? (delta / prevScore) * 100 : 0;

    // Only consider decreases that exceed threshold
    if (delta < 0) {
      const absDelta = Math.abs(delta);
      const absPercent = Math.abs(percentChange);

      if (absDelta >= opts.minDelta || absPercent >= opts.minPercentChange) {
        regressions.push({
          dimension: dim,
          previousScore: prevScore,
          currentScore: currScore,
          delta,
          percentChange,
          severity: getSeverity(delta, opts.severeThreshold, opts.moderateThreshold),
        });
      }
    }
  }

  // Calculate overall delta
  const overallDelta = current.overall - previous.overall;
  const overallRegressed = overallDelta < -opts.minDelta;

  // Determine worst severity
  let worstSeverity: RegressionSeverity | null = null;
  for (const r of regressions) {
    if (!worstSeverity) {
      worstSeverity = r.severity;
    } else if (r.severity === "severe") {
      worstSeverity = "severe";
    } else if (r.severity === "moderate" && worstSeverity === "minor") {
      worstSeverity = "moderate";
    }
  }

  // Generate summary
  let summary: string;
  if (regressions.length === 0) {
    summary = overallRegressed
      ? `Overall score decreased by ${Math.abs(overallDelta).toFixed(1)} points but no dimension regressions detected`
      : "No quality regressions detected";
  } else {
    const counts = {
      severe: regressions.filter(r => r.severity === "severe").length,
      moderate: regressions.filter(r => r.severity === "moderate").length,
      minor: regressions.filter(r => r.severity === "minor").length,
    };

    const parts: string[] = [];
    if (counts.severe > 0) parts.push(`${counts.severe} severe`);
    if (counts.moderate > 0) parts.push(`${counts.moderate} moderate`);
    if (counts.minor > 0) parts.push(`${counts.minor} minor`);

    const dims = regressions.map(r => r.dimension).join(", ");
    summary = `Quality regression detected: ${parts.join(", ")} in [${dims}]`;
  }

  return {
    hasRegression: regressions.length > 0,
    regressions,
    overallDelta,
    overallRegressed,
    worstSeverity,
    summary,
  };
}

/**
 * Check if regression is acceptable (e.g., during refactoring)
 * Returns true if regressions are within acceptable limits
 */
export function isRegressionAcceptable(
  result: RegressionResult,
  maxSeverity: RegressionSeverity = "minor",
  maxRegressions: number = 2
): boolean {
  if (!result.hasRegression) return true;

  // Check severity
  const severityOrder: RegressionSeverity[] = ["minor", "moderate", "severe"];
  const maxSeverityIndex = severityOrder.indexOf(maxSeverity);
  const worstSeverityIndex = result.worstSeverity
    ? severityOrder.indexOf(result.worstSeverity)
    : -1;

  if (worstSeverityIndex > maxSeverityIndex) return false;

  // Check count
  if (result.regressions.length > maxRegressions) return false;

  return true;
}

/**
 * Format regression result for display
 */
export function formatRegression(result: RegressionResult, colorize: boolean = false): string {
  if (!result.hasRegression && !result.overallRegressed) {
    return colorize ? "\x1b[32m✓ No regressions\x1b[0m" : "✓ No regressions";
  }

  const lines: string[] = [];

  // Header
  const headerColor = result.worstSeverity === "severe" ? "\x1b[31m" : "\x1b[33m";
  const header = colorize
    ? `${headerColor}⚠ Quality Regression Detected\x1b[0m`
    : "⚠ Quality Regression Detected";
  lines.push(header);

  // Overall delta
  const overallStr = `Overall: ${result.overallDelta >= 0 ? "+" : ""}${result.overallDelta.toFixed(1)} points`;
  lines.push(colorize && result.overallRegressed ? `\x1b[31m${overallStr}\x1b[0m` : overallStr);

  // Individual regressions
  if (result.regressions.length > 0) {
    lines.push("");
    lines.push("Dimensions:");

    for (const r of result.regressions) {
      const severityIcon = r.severity === "severe" ? "🔴" : r.severity === "moderate" ? "🟡" : "🟢";
      const deltaStr = `${r.delta.toFixed(1)} (${r.percentChange.toFixed(1)}%)`;
      const line = `  ${severityIcon} ${r.dimension}: ${r.previousScore.toFixed(1)} → ${r.currentScore.toFixed(1)} (${deltaStr})`;
      lines.push(line);
    }
  }

  return lines.join("\n");
}

/**
 * Track quality history and detect trends
 */
export class QualityTrend {
  private history: QualityScores[] = [];
  private maxHistory: number;

  constructor(maxHistory: number = 10) {
    this.maxHistory = maxHistory;
  }

  /**
   * Add a score to the history
   */
  add(scores: QualityScores): void {
    this.history.push(scores);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /**
   * Get the last N scores
   */
  getRecent(n: number = 5): QualityScores[] {
    return this.history.slice(-n);
  }

  /**
   * Check if quality is trending down
   */
  isTrendingDown(windowSize: number = 3): boolean {
    const recent = this.getRecent(windowSize);
    if (recent.length < 2) return false;

    // Check if each score is lower than the previous
    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];
      if (prev && curr && curr.overall >= prev.overall) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get average score over window
   */
  getAverageScore(windowSize: number = 5): number {
    const recent = this.getRecent(windowSize);
    if (recent.length === 0) return 0;

    const sum = recent.reduce((acc, s) => acc + s.overall, 0);
    return sum / recent.length;
  }

  /**
   * Detect if we've hit a plateau (scores not improving)
   */
  isPlateaued(windowSize: number = 3, threshold: number = 1): boolean {
    const recent = this.getRecent(windowSize);
    if (recent.length < windowSize) return false;

    const first = recent[0];
    const last = recent[recent.length - 1];
    if (!first || !last) return false;

    return Math.abs(last.overall - first.overall) < threshold;
  }

  /**
   * Clear history
   */
  clear(): void {
    this.history = [];
  }
}
