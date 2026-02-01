/**
 * ORCHESTRATE Phase - Architecture and Planning
 *
 * This phase is responsible for:
 * 1. Generating architecture documentation and diagrams
 * 2. Creating Architecture Decision Records (ADRs)
 * 3. Breaking down requirements into epics, stories, and tasks
 * 4. Planning the first sprint
 */

// Types
export type {
  ArchitectureDoc,
  ArchitectureOverview,
  ArchitecturePattern,
  QualityAttribute,
  Component,
  ComponentType,
  Relationship,
  RelationshipType,
  DataModel,
  DataField,
  DataRelationship,
  Integration,
  IntegrationType,
  ArchitectureDiagram,
  DiagramType,
  ADR,
  ADRStatus,
  ADRConsequences,
  Alternative,
  ADRTemplate,
  BacklogResult,
  SprintConfig,
  TaskBreakdownStrategy,
  OrchestrateConfig,
  OrchestrateOutput,
  OrchestrateInput,
} from "./types.js";

export { DEFAULT_SPRINT_CONFIG, DEFAULT_ORCHESTRATE_CONFIG } from "./types.js";

// Architecture Generator
export {
  ArchitectureGenerator,
  generateArchitectureMarkdown,
  createArchitectureGenerator,
} from "./architecture.js";

// ADR Generator
export {
  ADRGenerator,
  generateADRMarkdown,
  generateADRIndexMarkdown,
  getADRFilename,
  createADRGenerator,
  ADR_TEMPLATES,
} from "./adr.js";

// Backlog Generator
export {
  BacklogGenerator,
  generateBacklogMarkdown,
  generateSprintMarkdown,
  createBacklogGenerator,
} from "./backlog.js";

// Executor
export {
  OrchestrateExecutor,
  createOrchestrateExecutor,
  runOrchestratePhase,
} from "./executor.js";

// Prompts (for customization)
export {
  ARCHITECT_SYSTEM_PROMPT,
  GENERATE_ARCHITECTURE_PROMPT,
  GENERATE_C4_DIAGRAMS_PROMPT,
  GENERATE_SEQUENCE_DIAGRAMS_PROMPT,
  GENERATE_ADRS_PROMPT,
  GENERATE_BACKLOG_PROMPT,
  PLAN_SPRINT_PROMPT,
  ESTIMATE_TASK_PROMPT,
  fillPrompt,
} from "./prompts.js";
