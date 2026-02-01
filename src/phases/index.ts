/**
 * Phase exports for Corbat-Coco
 */

// Core types
export type {
  Phase,
  PhaseResult,
  PhaseArtifact,
  ArtifactType,
  PhaseMetrics,
  PhaseExecutor,
  PhaseContext,
  PhaseConfig,
  PhaseState,
  PhaseTools,
  LLMInterface,
  PhaseCheckpoint,
  FileTools,
  BashTools,
  GitTools,
  TestTools,
  QualityTools,
  Message,
  ChatResponse,
  ToolDefinition,
  ChatWithToolsResponse,
  ToolCall,
  ExecOptions,
  ExecResult,
  GitStatus,
  TestResult,
  TestFailure,
  CoverageResult,
  LintResult,
  LintIssue,
  ComplexityResult,
  FileComplexity,
  FunctionComplexity,
  SecurityResult,
  SecurityIssue,
} from "./types.js";

// CONVERGE Phase - import specific exports to avoid conflicts
export {
  ConvergeExecutor,
  createConvergeExecutor,
  DEFAULT_CONVERGE_CONFIG,
  DiscoveryEngine,
  createDiscoveryEngine,
  SpecificationGenerator,
  createSpecificationGenerator,
  validateSpecification,
  SessionManager,
  createSessionManager,
} from "./converge/index.js";
export type {
  ConvergeConfig,
  DiscoverySession,
  Question,
  Requirement,
  Assumption,
  TechDecision,
  Specification,
  DiscoveryConfig,
  SpecificationConfig,
  ConvergeStep,
  ConvergeCheckpoint,
} from "./converge/index.js";

// ORCHESTRATE Phase - import specific exports to avoid conflicts
export {
  OrchestrateExecutor,
  createOrchestrateExecutor,
  DEFAULT_ORCHESTRATE_CONFIG,
  ArchitectureGenerator,
  generateArchitectureMarkdown,
  ADRGenerator,
  generateADRMarkdown,
  getADRFilename,
  generateADRIndexMarkdown,
  BacklogGenerator,
  generateBacklogMarkdown,
  generateSprintMarkdown,
} from "./orchestrate/index.js";
export type {
  OrchestrateConfig,
  ArchitectureDoc,
  ADR,
  BacklogResult,
  OrchestrateOutput,
  OrchestrateInput,
} from "./orchestrate/index.js";

// COMPLETE Phase - import specific exports to avoid conflicts
export {
  CompleteExecutor,
  createCompleteExecutor,
  DEFAULT_COMPLETE_CONFIG,
  TaskIterator,
  createTaskIterator,
  CodeReviewer,
  createCodeReviewer,
} from "./complete/index.js";
export type {
  CompleteConfig,
  CompleteProgress,
  TaskExecutionResult,
  SprintExecutionResult,
} from "./complete/index.js";

// OUTPUT Phase
export {
  OutputExecutor,
  createOutputExecutor,
  DEFAULT_OUTPUT_CONFIG,
  CICDGenerator,
  createDefaultCICDConfig,
  DockerGenerator,
  DocsGenerator,
} from "./output/index.js";
export type {
  OutputConfig,
  CICDConfig,
  CICDProvider,
  CICDFile,
  DocumentationSet,
  ProjectMetadata,
} from "./output/index.js";
