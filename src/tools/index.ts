/**
 * Tool exports for Corbat-Coco
 */

// Registry
export {
  ToolRegistry,
  getToolRegistry,
  createToolRegistry,
  defineTool,
  type ToolDefinition,
  type ToolCategory,
  type ToolResult,
} from "./registry.js";

// File tools
export {
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
  fileExistsTool,
  listDirTool,
  deleteFileTool,
  copyFileTool,
  moveFileTool,
  treeTool,
  fileTools,
} from "./file.js";

// Bash tools
export {
  bashExecTool,
  bashBackgroundTool,
  commandExistsTool,
  getEnvTool,
  bashTools,
} from "./bash.js";

// Git tools
export {
  gitStatusTool,
  gitDiffTool,
  gitAddTool,
  gitCommitTool,
  gitLogTool,
  gitBranchTool,
  gitCheckoutTool,
  gitPushTool,
  gitPullTool,
  gitInitTool,
  gitTools,
} from "./git.js";

// Git simple tools
export { checkProtectedBranchTool, simpleAutoCommitTool, gitSimpleTools } from "./git-simple.js";

// Simple agent tools
export {
  spawnSimpleAgentTool,
  checkAgentCapabilityTool,
  simpleAgentTools,
} from "./simple-agent.js";

// Test tools
export {
  runTestsTool,
  getCoverageTool,
  runTestFileTool,
  testTools,
  type TestResult,
  type TestFailure,
  type CoverageResult,
} from "./test.js";

// Quality tools
export {
  runLinterTool,
  analyzeComplexityTool,
  calculateQualityTool,
  qualityTools,
  type LintResult,
  type LintIssue,
  type ComplexityResult,
  type FileComplexity,
  type FunctionComplexity,
} from "./quality.js";

// Search tools
export {
  grepTool,
  findInFileTool,
  searchTools,
  type SearchMatch,
  type SearchResult,
} from "./search.js";

// HTTP tools
export { httpFetchTool, httpJsonTool, httpTools, type HttpResponse } from "./http.js";

// Build tools
export {
  runScriptTool,
  installDepsTool,
  makeTool,
  tscTool,
  buildTools,
  type PackageManager,
  type BuildResult,
} from "./build.js";

// Permissions tools
export {
  managePermissionsTool,
  permissionsTools,
  getRiskLevel,
  getRiskDescription,
  getEffectDescription,
  type RiskLevel,
} from "./permissions.js";

// Web tools
export {
  webSearchTool,
  webFetchTool,
  webTools,
  type WebSearchOutput,
  type WebSearchResultItem,
  type WebFetchOutput,
} from "./web.js";

// Diff tools (visual)
export { showDiffTool, diffTools } from "./diff.js";

// Review tools
export {
  reviewCodeTool,
  reviewTools,
  type ReviewResult,
  type ReviewFinding,
  type ReviewSummary,
  type ReviewSeverity,
  type ReviewCategory,
} from "./review.js";

// Codebase map tools
export {
  codebaseMapTool,
  codebaseMapTools,
  type CodebaseMapOutput,
  type FileMapEntry,
  type CodeDefinition,
  type DefinitionType,
} from "./codebase-map.js";

// Memory tools
export {
  createMemoryTool,
  recallMemoryTool,
  listMemoriesTool,
  memoryTools,
  type Memory,
} from "./memory.js";

// Checkpoint tools
export {
  createCheckpointTool,
  restoreCheckpointTool,
  listCheckpointsTool,
  checkpointTools,
  type Checkpoint,
} from "./checkpoint.js";

// Semantic search tools
export {
  semanticSearchTool,
  semanticSearchTools,
  type SemanticSearchOutput,
  type SemanticSearchResultItem,
} from "./semantic-search.js";

// Diagram tools
export { generateDiagramTool, diagramTools, type DiagramOutput } from "./diagram.js";

// PDF tools
export { readPdfTool, pdfTools, type PdfReadOutput } from "./pdf.js";

// Image tools
export { readImageTool, imageTools, type ImageReadOutput } from "./image.js";

// Database tools
export {
  sqlQueryTool,
  inspectSchemaTool,
  databaseTools,
  type SqlQueryOutput,
  type SchemaInspectOutput,
} from "./database.js";

// AST validator tools
export {
  validateCodeTool,
  findMissingImportsTool,
  astValidatorTools,
  type ValidationResult,
} from "./ast-validator.js";

// Code analyzer tools
export {
  analyzeFileTool,
  analyzeDirectoryTool,
  codeAnalyzerTools,
  type CodeAnalysisResult,
  type FunctionInfo,
  type ClassInfo,
  type ImportInfo,
  type ExportInfo,
} from "./code-analyzer.js";

// Agent coordinator tools
export {
  createAgentPlanTool,
  delegateTaskTool,
  aggregateResultsTool,
  agentCoordinatorTools,
  type AgentTask,
  type ExecutionStrategy,
} from "./agent-coordinator.js";

// Smart suggestions tools
export {
  suggestImprovementsTool,
  calculateCodeScoreTool,
  smartSuggestionsTools,
  type CodeSuggestion,
} from "./smart-suggestions.js";

// Context enhancer tools
export {
  addContextTool,
  getRelevantContextTool,
  recordLearningTool,
  getLearnedPatternsTool,
  contextEnhancerTools,
  type ContextItem,
  type LearningEntry,
} from "./context-enhancer.js";

// Skill enhancer tools
export {
  discoverSkillsTool,
  validateSkillTool,
  createCustomToolTool,
  skillEnhancerTools,
  type SkillDefinition,
} from "./skill-enhancer.js";

// Git enhanced tools
export {
  analyzeRepoHealthTool,
  getCommitStatsTool,
  recommendBranchTool,
  gitEnhancedTools,
} from "./git-enhanced.js";

// GitHub CLI tools
export {
  ghCheckAuthTool,
  ghRepoInfoTool,
  ghPrCreateTool,
  ghPrMergeTool,
  ghPrChecksTool,
  ghPrListTool,
  ghReleaseCreateTool,
  githubTools,
  type PRCheck,
} from "./github.js";

// Open / Execute tools
export { openFileTool, openTools, type OpenFileOutput } from "./open.js";

/**
 * Register all tools with a registry
 */
import { ToolRegistry, type ToolDefinition } from "./registry.js";
import { fileTools } from "./file.js";
import { bashTools } from "./bash.js";
import { gitTools } from "./git.js";
import { testTools } from "./test.js";
import { qualityTools } from "./quality.js";
import { searchTools } from "./search.js";
import { httpTools } from "./http.js";
import { buildTools } from "./build.js";
import { permissionsTools } from "./permissions.js";
import { webTools } from "./web.js";
import { codebaseMapTools } from "./codebase-map.js";
import { memoryTools } from "./memory.js";
import { checkpointTools } from "./checkpoint.js";
import { diffTools } from "./diff.js";
import { reviewTools } from "./review.js";
import { semanticSearchTools } from "./semantic-search.js";
import { diagramTools } from "./diagram.js";
import { pdfTools } from "./pdf.js";
import { imageTools } from "./image.js";
import { databaseTools } from "./database.js";
import { gitSimpleTools } from "./git-simple.js";
import { simpleAgentTools } from "./simple-agent.js";
import { astValidatorTools } from "./ast-validator.js";
import { codeAnalyzerTools } from "./code-analyzer.js";
import { agentCoordinatorTools } from "./agent-coordinator.js";
import { smartSuggestionsTools } from "./smart-suggestions.js";
import { contextEnhancerTools } from "./context-enhancer.js";
import { skillEnhancerTools } from "./skill-enhancer.js";
import { gitEnhancedTools } from "./git-enhanced.js";
import { githubTools } from "./github.js";
import { openTools } from "./open.js";
import { authorizePathTools } from "./authorize-path.js";

export function registerAllTools(registry: ToolRegistry): void {
  const allTools = [
    ...fileTools,
    ...bashTools,
    ...gitTools,
    ...gitSimpleTools,
    ...simpleAgentTools,
    ...testTools,
    ...qualityTools,
    ...searchTools,
    ...httpTools,
    ...buildTools,
    ...permissionsTools,
    ...webTools,
    ...codebaseMapTools,
    ...memoryTools,
    ...checkpointTools,
    ...diffTools,
    ...reviewTools,
    ...semanticSearchTools,
    ...diagramTools,
    ...pdfTools,
    ...imageTools,
    ...databaseTools,
    ...astValidatorTools,
    ...codeAnalyzerTools,
    ...agentCoordinatorTools,
    ...smartSuggestionsTools,
    ...contextEnhancerTools,
    ...skillEnhancerTools,
    ...gitEnhancedTools,
    ...githubTools,
    ...openTools,
    ...authorizePathTools,
  ];

  for (const tool of allTools) {
    // Use type assertion since tools have different generic parameters
    // but all conform to the base ToolDefinition interface
    registry.register(tool as ToolDefinition<unknown, unknown>);
  }
}

/**
 * Create a registry with all tools registered
 */
export function createFullToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerAllTools(registry);
  return registry;
}
