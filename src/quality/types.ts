/**
 * Quality system types for Corbat-Coco
 */

/**
 * Multi-dimensional quality scores
 */
export interface QualityScores {
  /**
   * Overall weighted score (0-100)
   */
  overall: number;

  /**
   * Individual dimension scores
   */
  dimensions: QualityDimensions;

  /**
   * Metadata
   */
  evaluatedAt: Date;
  evaluationDurationMs: number;
}

/**
 * Quality dimensions
 */
export interface QualityDimensions {
  /**
   * Does the code work correctly? (tests pass, logic correct)
   */
  correctness: number;

  /**
   * Are all requirements met?
   */
  completeness: number;

  /**
   * Are edge cases handled?
   */
  robustness: number;

  /**
   * Is the code clear and understandable?
   */
  readability: number;

  /**
   * Is the code easy to modify?
   */
  maintainability: number;

  /**
   * Cyclomatic complexity score (inverted - higher is better)
   */
  complexity: number;

  /**
   * DRY score - code duplication (inverted - higher is better)
   */
  duplication: number;

  /**
   * Line and branch coverage
   */
  testCoverage: number;

  /**
   * Test meaningfulness and quality
   */
  testQuality: number;

  /**
   * Security vulnerability score (100 = no vulnerabilities)
   */
  security: number;

  /**
   * Documentation coverage
   */
  documentation: number;

  /**
   * Linting and style compliance
   */
  style: number;
}

/**
 * Weights for quality dimensions (must sum to 1.0)
 */
export interface QualityWeights {
  correctness: number;
  completeness: number;
  robustness: number;
  readability: number;
  maintainability: number;
  complexity: number;
  duplication: number;
  testCoverage: number;
  testQuality: number;
  security: number;
  documentation: number;
  style: number;
}

/**
 * Default quality weights
 */
export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
  correctness: 0.15,
  completeness: 0.1,
  robustness: 0.1,
  readability: 0.1,
  maintainability: 0.1,
  complexity: 0.08,
  duplication: 0.07,
  testCoverage: 0.1,
  testQuality: 0.05,
  security: 0.08,
  documentation: 0.04,
  style: 0.03,
};

/**
 * Quality thresholds
 */
export interface QualityThresholds {
  /**
   * Minimum acceptable scores (must achieve to pass)
   */
  minimum: {
    overall: number;
    testCoverage: number;
    security: number;
  };

  /**
   * Target scores (excellent quality)
   */
  target: {
    overall: number;
    testCoverage: number;
  };

  /**
   * Convergence threshold (max score delta to consider converged)
   */
  convergenceThreshold: number;

  /**
   * Maximum iterations before forced completion
   */
  maxIterations: number;

  /**
   * Minimum iterations before checking convergence
   */
  minIterations: number;
}

/**
 * Default quality thresholds
 */
export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  minimum: {
    overall: 85,
    testCoverage: 80,
    security: 100, // No vulnerabilities allowed
  },
  target: {
    overall: 95,
    testCoverage: 90,
  },
  convergenceThreshold: 2,
  maxIterations: 10,
  minIterations: 2,
};

/**
 * Quality evaluation result
 */
export interface QualityEvaluation {
  scores: QualityScores;
  meetsMinimum: boolean;
  /**
   * Whether the current score meets or exceeds the target overall score AND target test coverage.
   * Used for UI display to indicate the project has reached excellent quality.
   * In a single-shot evaluation this shares the same overall threshold check as `converged`,
   * but it also enforces the testCoverage target threshold.
   */
  meetsTarget: boolean;
  /**
   * Whether quality is stable at or above the target overall score.
   * Used by the convergence loop to decide whether further iterations are needed.
   * In a single-shot evaluation this checks only the overall score threshold;
   * in an iterative context it can additionally require stability across iterations
   * (score delta below convergenceThreshold).
   */
  converged: boolean;
  issues: QualityIssue[];
  suggestions: QualitySuggestion[];
}

/**
 * Quality issue found during evaluation
 */
export interface QualityIssue {
  dimension: keyof QualityDimensions;
  severity: "critical" | "major" | "minor";
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

/**
 * Suggestion for improving quality
 */
export interface QualitySuggestion {
  dimension: keyof QualityDimensions;
  priority: "high" | "medium" | "low";
  description: string;
  estimatedImpact: number; // Expected score increase
}

/**
 * Quality history for tracking improvement
 */
export interface QualityHistory {
  taskId: string;
  iterations: QualityIteration[];
}

/**
 * Single iteration in quality history
 */
export interface QualityIteration {
  iteration: number;
  timestamp: Date;
  scores: QualityScores;
  delta: number; // Change from previous iteration
  issues: QualityIssue[];
  improvements: string[]; // What was improved
}

/**
 * Convergence check result
 */
export interface ConvergenceResult {
  converged: boolean;
  reason: ConvergenceReason;
  currentScore: number;
  previousScore: number;
  delta: number;
  iterationCount: number;
}

/**
 * Reasons for convergence determination
 */
export type ConvergenceReason =
  | "score_converged" // Score delta below threshold
  | "target_reached" // Reached target score
  | "max_iterations" // Hit max iterations limit
  | "below_minimum" // Below minimum after min iterations
  | "not_converged"; // Still improving
