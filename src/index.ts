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
export type {
  Orchestrator,
  OrchestratorConfig,
  ProjectState,
  Progress,
} from "./orchestrator/types.js";

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

// Reusable agent runtime
export {
  AgentRuntime,
  AGENT_MODES,
  DefaultRuntimeTurnRunner,
  ToolCallingRuntimeTurnRunner,
  ProviderRegistry,
  InMemoryEventLog,
  InMemoryRuntimeSessionStore,
  FileRuntimeSessionStore,
  DefaultPermissionPolicy,
  FileEventLog,
  createAgentRuntime,
  createDefaultRuntimeTurnRunner,
  createToolCallingRuntimeTurnRunner,
  getAgentMode,
  isAgentMode,
  listAgentModes,
  createProviderRegistry,
  createEventLog,
  createFileRuntimeSessionStore,
  createFileEventLog,
  createRuntimeHttpServer,
  createRuntimeSessionStore,
  createPermissionPolicy,
  createMcpToolPolicy,
  createAgentFromBlueprint,
  createBaseBlueprint,
  createSafeToolRegistry,
  mapActionModeToRuntimeMode,
  defaultPublicGuardrails,
  redactSecrets,
  runGuardrails,
  validateStructuredOutput,
  createInMemoryKnowledgeRetriever,
  formatRetrievedSourcesForPrompt,
  InMemoryKnowledgeRetriever,
  createWorkflowCatalog,
  createWorkflowEngine,
  createWorkflowRegistry,
  createAgentArtifact,
  createSummaryArtifact,
  DEFAULT_WORKFLOWS,
  normalizeAgentRunResult,
  SharedWorkspaceState,
  validateAgentCapabilities,
  validateAgentGraph,
  workflowToAgentGraph,
  WorkflowCatalog,
  WorkflowEngine,
  WorkflowRegistry,
  type ToolCallingRuntimeTurnRunnerOptions,
} from "./runtime/index.js";
export type {
  AgentModeDefinition,
  AgentModeId,
  AgentActionMode,
  AgentArtifact,
  AgentArtifactKind,
  AgentBudget,
  AgentBlueprint,
  AgentCapability,
  AgentDeploymentSurface,
  AgentGateDefinition,
  AgentGateKind,
  AgentGraphDefinition,
  AgentGraphEdge,
  AgentGraphNode,
  AgentGraphValidationIssue,
  AgentGraphValidationResult,
  AgentMaturity,
  AgentPreset,
  AgentRole,
  AgentRunResult,
  AgentRunStatus,
  AgentRuntimeFactoryOptions,
  AgentRuntimeOptions,
  AgentRuntimeSnapshot,
  ApprovalPolicy,
  BlueprintAgent,
  EventLog,
  GuardrailConfig,
  GuardrailFinding,
  GuardrailResult,
  GuardrailSeverity,
  GuardrailStage,
  InMemoryKnowledgeDocument,
  KnowledgeRetriever,
  MemoryConfig,
  ObservabilityConfig,
  PermissionDecision,
  PermissionPolicy,
  ProviderRuntimeSelection,
  ReasoningEffort,
  RetrievedSource,
  RetrievalOptions,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeMode,
  RuntimeHttpServerOptions,
  RuntimeSession,
  RuntimeSessionCreateOptions,
  RuntimeSessionStore,
  RuntimeToolExecutionInput,
  RuntimeToolExecutionResult,
  RuntimeTurnContext,
  RuntimeTurnInput,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent,
  RuntimeTurnRunner,
  SecretRedactionConfig,
  TopicBoundaryConfig,
  AgentSurface,
  ExtensionRisk,
  McpToolPolicy,
  RecipeManifest,
  RecipeStep,
  SkillManifest,
  SharedWorkspaceStateSnapshot,
  AgentTask as RuntimeAgentTask,
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowPlan,
  WorkflowRetryPolicy,
  WorkflowRunContext,
  WorkflowRunInput,
  WorkflowRunResult,
  WorkflowRunStatus,
  WorkflowRisk,
  WorkflowStepDefinition,
} from "./runtime/index.js";

// Tools
export {
  ToolRegistry,
  createToolRegistry,
  registerAllTools,
  createFullToolRegistry,
} from "./tools/index.js";
export {
  createCodingToolRegistry,
  createCustomerSupportToolRegistry,
  createNoToolRegistry,
  createPublicWebToolRegistry,
  createRagToolRegistry,
  createSupportRagToolRegistry,
  type HumanEscalationHandler,
  type HumanEscalationInput,
  type HumanEscalationOutput,
  type SupportDraftHandler,
  type SupportDraftInput,
  type SupportDraftOutput,
  type SupportRagToolRegistryOptions,
} from "./tools/profiles.js";

// Reusable agent presets and adapters
export {
  AGENT_PRESETS,
  appointmentBookingAssistantPreset,
  codingAgentPreset,
  customerSupportAssistantPreset,
  internalOpsAssistantPreset,
  publicWebsiteAssistantPreset,
  ragKnowledgeAssistantPreset,
  salesIntakeAssistantPreset,
  supportRagAssistantPreset,
  type AppointmentPresetConfig,
  type BrandPresetConfig,
  type RagPresetConfig,
  type SupportRagPresetConfig,
} from "./presets/index.js";
export {
  createHttpAssistantAdapter,
  createStreamingHttpAssistantAdapter,
  createWebhookAssistantAdapter,
  type ChannelAdapter,
  type ChannelInput,
  type ChannelOutput,
  type HttpAssistantAdapter,
  type StreamingHttpAssistantAdapter,
} from "./adapters/index.js";

// Utilities
export { CocoError, ConfigError, PhaseError, TaskError } from "./utils/errors.js";
export { createLogger } from "./utils/logger.js";
export { installProxyDispatcher } from "./utils/proxy.js";
