/**
 * Phase types for Corbat-Coco
 */

/**
 * Project phases
 */
export type Phase = "idle" | "converge" | "orchestrate" | "complete" | "output";

/**
 * Result of phase execution
 */
export interface PhaseResult {
  phase: Phase;
  success: boolean;
  artifacts: PhaseArtifact[];
  error?: string;
  metrics?: PhaseMetrics;
}

/**
 * Artifact produced by a phase
 */
export interface PhaseArtifact {
  type: ArtifactType;
  path: string;
  description: string;
}

/**
 * Types of artifacts
 */
export type ArtifactType =
  | "specification"
  | "architecture"
  | "adr"
  | "diagram"
  | "backlog"
  | "code"
  | "test"
  | "documentation"
  | "cicd"
  | "deployment";

/**
 * Phase execution metrics
 */
export interface PhaseMetrics {
  startTime: Date;
  endTime: Date;
  durationMs: number;
  llmCalls: number;
  tokensUsed: number;
}

/**
 * Phase executor interface
 */
export interface PhaseExecutor {
  name: string;
  description: string;

  /**
   * Check if the phase can start given current state
   */
  canStart(context: PhaseContext): boolean;

  /**
   * Execute the phase
   */
  execute(context: PhaseContext): Promise<PhaseResult>;

  /**
   * Check if the phase can complete
   */
  canComplete(context: PhaseContext): boolean;

  /**
   * Create a checkpoint for recovery
   */
  checkpoint(context: PhaseContext): Promise<PhaseCheckpoint>;

  /**
   * Restore from a checkpoint
   */
  restore(checkpoint: PhaseCheckpoint, context: PhaseContext): Promise<void>;
}

/**
 * Context passed to phase executors
 */
export interface PhaseContext {
  projectPath: string;
  config: PhaseConfig;
  state: PhaseState;
  tools: PhaseTools;
  llm: LLMInterface;
}

/**
 * Phase-specific configuration
 */
export interface PhaseConfig {
  quality: {
    minScore: number;
    minCoverage: number;
    maxIterations: number;
    convergenceThreshold: number;
  };
  timeouts: {
    phaseTimeout: number;
    taskTimeout: number;
    llmTimeout: number;
  };
}

/**
 * Phase state (what the phase has produced so far)
 */
export interface PhaseState {
  artifacts: PhaseArtifact[];
  progress: number;
  checkpoint: PhaseCheckpoint | null;
}

/**
 * Tools available to phases
 */
export interface PhaseTools {
  file: FileTools;
  bash: BashTools;
  git: GitTools;
  test: TestTools;
  quality: QualityTools;
}

/**
 * LLM interface for phases
 */
export interface LLMInterface {
  chat(messages: Message[]): Promise<ChatResponse>;
  chatWithTools(messages: Message[], tools: ToolDefinition[]): Promise<ChatWithToolsResponse>;
}

/**
 * Phase checkpoint for recovery
 */
export interface PhaseCheckpoint {
  phase: Phase;
  timestamp: Date;
  state: PhaseState;
  resumePoint: string;
}

// Tool interfaces (simplified)
export interface FileTools {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  glob(pattern: string): Promise<string[]>;
}

export interface BashTools {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
}

export interface GitTools {
  status(): Promise<GitStatus>;
  commit(message: string, files?: string[]): Promise<void>;
  push(): Promise<void>;
}

export interface TestTools {
  run(pattern?: string): Promise<TestResult>;
  coverage(): Promise<CoverageResult>;
}

export interface QualityTools {
  lint(files: string[]): Promise<LintResult>;
  complexity(files: string[]): Promise<ComplexityResult>;
  security(files: string[]): Promise<SecurityResult>;
}

// Additional types
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatWithToolsResponse extends ChatResponse {
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitStatus {
  branch: string;
  clean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: TestFailure[];
}

export interface TestFailure {
  name: string;
  message: string;
  stack?: string;
}

export interface CoverageResult {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

export interface LintResult {
  errors: number;
  warnings: number;
  issues: LintIssue[];
}

export interface LintIssue {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
  rule: string;
}

export interface ComplexityResult {
  averageComplexity: number;
  maxComplexity: number;
  files: FileComplexity[];
}

export interface FileComplexity {
  file: string;
  complexity: number;
  functions: FunctionComplexity[];
}

export interface FunctionComplexity {
  name: string;
  complexity: number;
  line: number;
}

export interface SecurityResult {
  vulnerabilities: number;
  issues: SecurityIssue[];
}

export interface SecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  type: string;
  message: string;
  file?: string;
  line?: number;
}
