/**
 * Convergence Analyzer
 * Analyzes quality score history to determine when to stop iterating
 */

export interface QualityIteration {
  iteration: number;
  scores: {
    overall: number;
    dimensions: Record<string, number>;
  };
  timestamp: number;
  testsPassing: number;
  testsTotal: number;
  issuesCount: number;
}

export type ConvergenceReason =
  | "target_reached"
  | "stuck_below_minimum"
  | "oscillating"
  | "diminishing_returns"
  | "score_stable"
  | "max_iterations"
  | "still_improving"
  | "insufficient_data";

export interface ConvergenceResult {
  converged: boolean;
  reason: ConvergenceReason;
  confidence: number; // 0-100
  recommendation?: string;
}

/**
 * Convergence Analyzer
 */
export class ConvergenceAnalyzer {
  private minScore: number;
  private targetScore: number;
  private maxIterations: number;
  private stableDeltaThreshold: number;

  constructor(options?: {
    minScore?: number;
    targetScore?: number;
    maxIterations?: number;
    stableDeltaThreshold?: number;
  }) {
    this.minScore = options?.minScore ?? 85;
    this.targetScore = options?.targetScore ?? 95;
    this.maxIterations = options?.maxIterations ?? 10;
    this.stableDeltaThreshold = options?.stableDeltaThreshold ?? 2;
  }

  /**
   * Analyze convergence based on iteration history
   */
  analyzeConvergence(history: QualityIteration[]): ConvergenceResult {
    if (history.length === 0) {
      return {
        converged: false,
        reason: "insufficient_data",
        confidence: 100,
      };
    }

    const current = history[history.length - 1];
    if (!current) {
      return {
        converged: false,
        reason: "insufficient_data",
        confidence: 100,
      };
    }

    // Check 1: Max iterations reached
    if (current.iteration >= this.maxIterations) {
      return {
        converged: true,
        reason: "max_iterations",
        confidence: 100,
        recommendation: `Reached maximum iterations (${this.maxIterations}). Final score: ${current.scores.overall}`,
      };
    }

    // Check 2: Target reached
    if (current.scores.overall >= this.targetScore) {
      return {
        converged: true,
        reason: "target_reached",
        confidence: 100,
        recommendation: `Target quality ${this.targetScore} achieved! Score: ${current.scores.overall}`,
      };
    }

    // Need at least 2 iterations for comparative analysis
    if (history.length < 2) {
      return {
        converged: false,
        reason: "insufficient_data",
        confidence: 100,
      };
    }

    // Check 3: Stuck below minimum after multiple iterations
    if (history.length >= 5) {
      const recentScores = history.slice(-5).map((h) => h.scores.overall);
      const allBelowMin = recentScores.every((s) => s < this.minScore);
      const noSignificantImprovement = this.calculateMaxDelta(recentScores) < 5;

      if (allBelowMin && noSignificantImprovement) {
        return {
          converged: true,
          reason: "stuck_below_minimum",
          confidence: 90,
          recommendation: `Quality stuck below minimum ${this.minScore} for 5 iterations. Consider revising requirements or approach.`,
        };
      }
    }

    // Check 4: Oscillation detection
    if (history.length >= 4) {
      const oscillation = this.detectOscillation(history);
      if (oscillation.detected) {
        return {
          converged: true,
          reason: "oscillating",
          confidence: oscillation.confidence,
          recommendation:
            "Quality scores are oscillating. This may indicate conflicting requirements or unstable fixes.",
        };
      }
    }

    // Check 5: Diminishing returns
    if (history.length >= 4) {
      const diminishing = this.detectDiminishingReturns(history, 3, 1);
      if (diminishing && current.scores.overall >= this.minScore) {
        return {
          converged: true,
          reason: "diminishing_returns",
          confidence: 80,
          recommendation: `Quality improvements are diminishing (< 1 point for 3 iterations). Current score ${current.scores.overall} is acceptable.`,
        };
      }
    }

    // Check 6: Score is stable and above minimum
    if (history.length >= 2) {
      const previous = history[history.length - 2];
      if (!previous) {
        return {
          converged: false,
          reason: "insufficient_data",
          confidence: 100,
        };
      }
      const delta = Math.abs(current.scores.overall - previous.scores.overall);

      if (delta < this.stableDeltaThreshold && current.scores.overall >= this.minScore) {
        return {
          converged: true,
          reason: "score_stable",
          confidence: 85,
          recommendation: `Quality is stable at ${current.scores.overall} (delta: ${delta.toFixed(2)}).`,
        };
      }
    }

    // Not converged yet
    const trend = this.calculateTrend(history);
    const improvementRate = this.calculateImprovementRate(history);

    return {
      converged: false,
      reason: "still_improving",
      confidence: 100,
      recommendation: `Still improving (${trend > 0 ? "+" : ""}${trend.toFixed(1)} per iteration, ${improvementRate.toFixed(1)}% total improvement). Continue iterating.`,
    };
  }

  /**
   * Detect oscillation pattern in scores
   */
  private detectOscillation(history: QualityIteration[]): {
    detected: boolean;
    confidence: number;
  } {
    if (history.length < 4) {
      return { detected: false, confidence: 0 };
    }

    // Check last 4-6 iterations for up-down-up-down pattern
    const checkSize = Math.min(6, history.length);
    const recentScores = history
      .slice(-checkSize)
      .map((h) => h?.scores?.overall || 0)
      .filter((s) => s > 0);

    // Calculate direction changes
    let directionChanges = 0;
    for (let i = 1; i < recentScores.length - 1; i++) {
      const prevScore = recentScores[i - 1];
      const currentScore = recentScores[i];
      const nextScore = recentScores[i + 1];

      if (prevScore === undefined || currentScore === undefined || nextScore === undefined)
        continue;

      const prevDelta = currentScore - prevScore;
      const nextDelta = nextScore - currentScore;

      // Direction changed if signs are different
      if ((prevDelta > 0 && nextDelta < 0) || (prevDelta < 0 && nextDelta > 0)) {
        directionChanges++;
      }
    }

    // Oscillating if more than half of the points show direction changes
    const oscillationRatio = directionChanges / (recentScores.length - 2);

    if (oscillationRatio >= 0.6) {
      // High oscillation
      return { detected: true, confidence: Math.min(100, Math.round(oscillationRatio * 100)) };
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Detect diminishing returns
   */
  private detectDiminishingReturns(
    history: QualityIteration[],
    windowSize: number,
    threshold: number,
  ): boolean {
    if (history.length < windowSize + 1) {
      return false;
    }

    const recentScores = history
      .slice(-(windowSize + 1))
      .map((h) => h?.scores?.overall || 0)
      .filter((s) => s > 0);

    // Check if all recent improvements are below threshold
    for (let i = 1; i < recentScores.length; i++) {
      const prevScore = recentScores[i - 1];
      const currentScore = recentScores[i];

      if (prevScore === undefined || currentScore === undefined) continue;

      const improvement = currentScore - prevScore;
      if (Math.abs(improvement) >= threshold) {
        return false; // Found a significant change
      }
    }

    return true;
  }

  /**
   * Calculate max delta in a sequence of scores
   */
  private calculateMaxDelta(scores: number[]): number {
    if (scores.length < 2) return 0;

    let maxDelta = 0;
    for (let i = 1; i < scores.length; i++) {
      const prevScore = scores[i - 1];
      const currentScore = scores[i];

      if (prevScore === undefined || currentScore === undefined) continue;

      const delta = Math.abs(currentScore - prevScore);
      maxDelta = Math.max(maxDelta, delta);
    }

    return maxDelta;
  }

  /**
   * Calculate trend (average change per iteration)
   */
  private calculateTrend(history: QualityIteration[]): number {
    if (history.length < 2) return 0;

    const scores = history.map((h) => h?.scores?.overall || 0).filter((s) => s > 0);
    let totalChange = 0;

    for (let i = 1; i < scores.length; i++) {
      const prevScore = scores[i - 1];
      const currentScore = scores[i];

      if (prevScore === undefined || currentScore === undefined) continue;

      totalChange += currentScore - prevScore;
    }

    return scores.length > 1 ? totalChange / (scores.length - 1) : 0;
  }

  /**
   * Calculate total improvement rate (%)
   */
  private calculateImprovementRate(history: QualityIteration[]): number {
    if (history.length < 2) return 0;

    const first = history[0]?.scores?.overall || 0;
    const last = history[history.length - 1]?.scores?.overall || 0;

    if (first === 0) return 0;

    return ((last - first) / first) * 100;
  }

  /**
   * Get convergence summary for logging
   */
  getSummary(result: ConvergenceResult): string {
    const status = result.converged ? "✅ CONVERGED" : "🔄 CONTINUING";
    const reason = result.reason.toUpperCase().replace(/_/g, " ");

    let summary = `${status}: ${reason}`;
    if (result.recommendation) {
      summary += `\n  ${result.recommendation}`;
    }

    return summary;
  }
}

/**
 * Create a convergence analyzer
 */
export function createConvergenceAnalyzer(options?: {
  minScore?: number;
  targetScore?: number;
  maxIterations?: number;
  stableDeltaThreshold?: number;
}): ConvergenceAnalyzer {
  return new ConvergenceAnalyzer(options);
}
