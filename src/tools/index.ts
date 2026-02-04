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
export {
  httpFetchTool,
  httpJsonTool,
  httpTools,
  type HttpResponse,
} from "./http.js";

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

export function registerAllTools(registry: ToolRegistry): void {
  const allTools = [
    ...fileTools,
    ...bashTools,
    ...gitTools,
    ...testTools,
    ...qualityTools,
    ...searchTools,
    ...httpTools,
    ...buildTools,
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
