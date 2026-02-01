/**
 * Corbat-Coco: Autonomous Coding Agent
 *
 * An autonomous coding agent with self-review, quality convergence,
 * and production-ready output following the COCO methodology:
 * CONVERGE → ORCHESTRATE → COMPLETE → OUTPUT
 *
 * @packageDocumentation
 */

// Version
export { VERSION } from "./version.js";

// Orchestrator
export { createOrchestrator } from "./orchestrator/index.js";
export type { Orchestrator, OrchestratorConfig, ProjectState, Progress } from "./orchestrator/types.js";

// Configuration
export { loadConfig, saveConfig, createDefaultConfig, configExists } from "./config/index.js";
export type { CocoConfig } from "./config/index.js";

// Phases - Core types
export type { Phase, PhaseResult, PhaseExecutor, PhaseContext } from "./phases/types.js";

// Phases - CONVERGE
export {
  DiscoveryEngine,
  createDiscoveryEngine,
  SpecificationGenerator,
  createSpecificationGenerator,
  SessionManager,
  createSessionManager,
  ConvergeExecutor,
  createConvergeExecutor,
} from "./phases/converge/index.js";

// Phases - ORCHESTRATE
export {
  ArchitectureGenerator,
  createArchitectureGenerator,
  ADRGenerator,
  createADRGenerator,
  BacklogGenerator,
  createBacklogGenerator,
  OrchestrateExecutor,
  createOrchestrateExecutor,
} from "./phases/orchestrate/index.js";

// Phases - COMPLETE
export {
  CodeGenerator,
  createCodeGenerator,
  CodeReviewer,
  createCodeReviewer,
  TaskIterator,
  createTaskIterator,
  CompleteExecutor,
  createCompleteExecutor,
} from "./phases/complete/index.js";

// Phases - OUTPUT
export {
  CICDGenerator,
  createCICDGenerator,
  DockerGenerator,
  createDockerGenerator,
  DocsGenerator,
  createDocsGenerator,
  OutputExecutor,
  createOutputExecutor,
} from "./phases/output/index.js";

// Quality
export type { QualityScores, QualityDimensions, QualityThresholds } from "./quality/types.js";

// Tasks
export type { Task, TaskVersion, TaskHistory, Sprint, Story, Epic, Backlog } from "./types/task.js";

// Providers
export { AnthropicProvider, createAnthropicProvider, createProvider } from "./providers/index.js";
export type { LLMProvider, Message, ChatResponse, ChatOptions } from "./providers/types.js";

// Tools
export { ToolRegistry, createToolRegistry, registerAllTools, createFullToolRegistry } from "./tools/index.js";

// Utilities
export { CocoError, ConfigError, PhaseError, TaskError } from "./utils/errors.js";
export { createLogger } from "./utils/logger.js";
