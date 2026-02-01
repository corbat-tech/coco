/**
 * COMPLETE Phase - Task Execution with Quality Iteration
 *
 * This phase is responsible for:
 * 1. Executing tasks with code generation
 * 2. Reviewing code quality
 * 3. Iterating until quality converges
 * 4. Managing version history
 */

// Types
export type {
  TaskExecutionResult,
  TaskExecutionContext,
  QualityConfig,
  CodeGenerationRequest,
  CodeGenerationResponse,
  GeneratedFile,
  CodeReviewResult,
  ReviewIssue,
  ReviewSuggestion,
  TestExecutionResult,
  TestFailureDetail,
  IterationResult,
  ConvergenceCheck,
  SprintExecutionResult,
  CompleteConfig,
  CompleteProgress,
  VersionDiff,
  RollbackRequest,
  TaskState,
  StateTransition,
} from "./types.js";

export { DEFAULT_QUALITY_CONFIG, DEFAULT_COMPLETE_CONFIG } from "./types.js";

// Code Generator
export { CodeGenerator, createCodeGenerator } from "./generator.js";

// Code Reviewer
export { CodeReviewer, createCodeReviewer } from "./reviewer.js";

// Task Iterator
export { TaskIterator, createTaskIterator } from "./iterator.js";

// Executor
export { CompleteExecutor, createCompleteExecutor } from "./executor.js";

// Prompts (for customization)
export {
  CODE_GENERATION_SYSTEM_PROMPT,
  CODE_REVIEW_SYSTEM_PROMPT,
  GENERATE_CODE_PROMPT,
  REVIEW_CODE_PROMPT,
  IMPROVE_CODE_PROMPT,
  GENERATE_TESTS_PROMPT,
  ANALYZE_FAILURES_PROMPT,
  SHOULD_CONTINUE_PROMPT,
  PROJECT_CONTEXT_PROMPT,
  fillPrompt,
  buildPreviousCodeSection,
  buildFeedbackSection,
} from "./prompts.js";
