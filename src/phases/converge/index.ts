/**
 * CONVERGE Phase - Discovery and Specification
 *
 * This phase is responsible for:
 * 1. Gathering requirements through conversation
 * 2. Asking clarifying questions
 * 3. Making and confirming assumptions
 * 4. Generating the project specification document
 */

// Types
export type {
  DiscoverySession,
  DiscoveryStatus,
  DiscoveryMessage,
  Requirement,
  RequirementCategory,
  RequirementPriority,
  Question,
  QuestionCategory,
  Clarification,
  Assumption,
  TechDecision,
  TechArea,
  Specification,
  ProjectOverview,
  RequirementsSection,
  TechnicalSection,
  AssumptionsSection,
  Risk,
  DiscoveryConfig,
  InputAnalysis,
  ProjectType,
} from "./types.js";

// Discovery Engine
export {
  DiscoveryEngine,
  createDiscoveryEngine,
  DEFAULT_DISCOVERY_CONFIG,
} from "./discovery.js";

// Specification Generator
export {
  SpecificationGenerator,
  createSpecificationGenerator,
  validateSpecification,
  DEFAULT_SPEC_CONFIG,
  type SpecificationConfig,
} from "./specification.js";

// Persistence
export {
  SessionPersistence,
  SessionManager,
  createSessionManager,
  getPersistencePaths,
  createCheckpoint,
  type PersistencePaths,
  type ConvergeCheckpoint,
  type ConvergeStep,
} from "./persistence.js";

// Executor
export {
  ConvergeExecutor,
  createConvergeExecutor,
  runConvergePhase,
  DEFAULT_CONVERGE_CONFIG,
  type ConvergeConfig,
} from "./executor.js";

// Prompts (for customization)
export {
  DISCOVERY_SYSTEM_PROMPT,
  INITIAL_ANALYSIS_PROMPT,
  GENERATE_QUESTIONS_PROMPT,
  PROCESS_ANSWER_PROMPT,
  GENERATE_SPEC_PROMPT,
  EXTRACT_REQUIREMENTS_PROMPT,
  fillPrompt,
  createMessage,
  buildConversation,
} from "./prompts.js";
