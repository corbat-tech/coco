/**
 * Shared dimension labels and ordering constants.
 * Import from here instead of duplicating across formatter, exporter, and workflow.
 */

import type { QualityDimensions } from "./types.js";

/** Human-readable label for each quality dimension */
export const DIMENSION_LABELS: Record<keyof QualityDimensions, string> = {
  correctness: "Correctness",
  completeness: "Completeness",
  robustness: "Robustness",
  readability: "Readability",
  maintainability: "Maintainability",
  complexity: "Complexity",
  duplication: "Duplication",
  testCoverage: "Test Coverage",
  testQuality: "Test Quality",
  security: "Security",
  documentation: "Documentation",
  style: "Style",
};

/** Canonical display order for quality dimensions */
export const DIMENSION_ORDER: Array<keyof QualityDimensions> = [
  "correctness",
  "completeness",
  "robustness",
  "readability",
  "maintainability",
  "complexity",
  "duplication",
  "testCoverage",
  "testQuality",
  "security",
  "documentation",
  "style",
];
