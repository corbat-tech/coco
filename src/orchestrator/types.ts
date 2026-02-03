import type { Phase, PhaseResult } from "../phases/types.js";
import type { QualityScores } from "../quality/types.js";

/**
 * Main orchestrator interface
 */
export interface Orchestrator {
  // Lifecycle
  initialize(projectPath: string): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;

  // Phase management
  getCurrentPhase(): Phase;
  transitionTo(phase: Phase): Promise<PhaseResult>;

  // State
  getState(): ProjectState;
  getProgress(): Progress;

  // Events
  on<K extends keyof OrchestratorEvents>(event: K, handler: OrchestratorEvents[K]): void;
  off<K extends keyof OrchestratorEvents>(event: K, handler: OrchestratorEvents[K]): void;
}

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  projectPath: string;
  provider: {
    type: "anthropic" | "openai" | "gemini" | "kimi";
    apiKey?: string;
    model: string;
    maxTokens?: number;
  };
  quality: {
    minScore: number;
    minCoverage: number;
    maxIterations: number;
    convergenceThreshold: number;
  };
  persistence: {
    checkpointInterval: number;
    maxCheckpoints: number;
  };
}

/**
 * Project state
 */
export interface ProjectState {
  // Metadata
  id: string;
  name: string;
  path: string;
  createdAt: Date;
  updatedAt: Date;

  // Phase
  currentPhase: Phase;
  phaseHistory: PhaseTransition[];

  // Tasks
  currentTask: TaskState | null;
  completedTasks: string[];
  pendingTasks: string[];

  // Quality
  lastScores: QualityScores | null;
  qualityHistory: QualityScores[];

  // Checkpoints
  lastCheckpoint: CheckpointRef | null;
}

/**
 * Phase transition record
 */
export interface PhaseTransition {
  from: Phase;
  to: Phase;
  timestamp: Date;
  reason: string;
}

/**
 * Current task state
 */
export interface TaskState {
  id: string;
  title: string;
  iteration: number;
  startedAt: Date;
  scores: QualityScores[];
}

/**
 * Checkpoint reference
 */
export interface CheckpointRef {
  id: string;
  timestamp: Date;
  phase: Phase;
  canResume: boolean;
}

/**
 * Progress information
 */
export interface Progress {
  phase: Phase;
  phaseProgress: number; // 0-1
  overallProgress: number; // 0-1

  // Current sprint
  sprint?: {
    id: string;
    tasksCompleted: number;
    tasksTotal: number;
    avgQuality: number;
  };

  // Current task
  task?: {
    id: string;
    title: string;
    iteration: number;
    currentScore: number;
  };

  // Time
  startedAt: Date;
  estimatedCompletion?: Date;
}

/**
 * Orchestrator events
 */
export interface OrchestratorEvents {
  "phase:start": (phase: Phase) => void;
  "phase:complete": (phase: Phase, result: PhaseResult) => void;
  "task:start": (taskId: string) => void;
  "task:iteration": (taskId: string, iteration: number, score: number) => void;
  "task:complete": (taskId: string, finalScore: number) => void;
  "checkpoint:created": (checkpointId: string) => void;
  "error": (error: Error) => void;
}
