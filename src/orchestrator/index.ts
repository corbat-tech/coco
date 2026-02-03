/**
 * Orchestrator - Central coordinator for Corbat-Coco
 */

export { createOrchestrator } from "./orchestrator.js";
export type { Orchestrator, OrchestratorConfig } from "./types.js";
export { createProjectStructure } from "./project.js";

// Phase metrics for performance tracking
export {
  MetricsCollector,
  createMetricsCollector,
  formatDuration,
  type PhaseMetrics,
  type AggregatedMetrics,
} from "./metrics.js";
