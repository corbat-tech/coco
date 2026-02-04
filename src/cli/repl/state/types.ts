/**
 * Project State Types
 *
 * Types for tracking project state and progress in the REPL.
 */

import type { Backlog } from '../../../types/task.js';

/**
 * COCO Phase types
 */
export type CocoPhase = 'none' | 'converge' | 'orchestrate' | 'complete' | 'output';

/**
 * Project specification summary
 */
export interface SpecificationSummary {
  name: string;
  description: string;
  techStack: string[];
  generatedAt: string;
}

/**
 * Architecture summary
 */
export interface ArchitectureSummary {
  pattern: string;
  components: number;
  adrs: number;
  generatedAt: string;
}

/**
 * Sprint progress
 */
export interface SprintProgress {
  currentSprint: number;
  totalSprints: number;
  tasksCompleted: number;
  tasksTotal: number;
}

/**
 * Project state
 */
export interface ProjectState {
  /** Project path */
  path: string;
  /** Current phase */
  currentPhase: CocoPhase;
  /** Completed phases */
  completedPhases: CocoPhase[];
  /** Specification summary (if converged) */
  specification?: SpecificationSummary;
  /** Architecture summary (if orchestrated) */
  architecture?: ArchitectureSummary;
  /** Backlog (if orchestrated) */
  backlog?: Backlog;
  /** Sprint progress (if in complete phase) */
  sprint?: SprintProgress;
  /** Last checkpoint path */
  lastCheckpoint?: string;
  /** State version for migrations */
  version: number;
  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * State store interface
 */
export interface StateStore {
  /**
   * Load state for a project
   */
  load(projectPath: string): Promise<ProjectState>;
  
  /**
   * Save state for a project
   */
  save(state: ProjectState): Promise<void>;
  
  /**
   * Clear state for a project
   */
  clear(projectPath: string): Promise<void>;
  
  /**
   * Check if state exists
   */
  exists(projectPath: string): Promise<boolean>;
}

/**
 * State manager with additional operations
 */
export interface StateManager extends StateStore {
  /**
   * Update current phase
   */
  updatePhase(projectPath: string, phase: CocoPhase): Promise<void>;
  
  /**
   * Mark phase as completed
   */
  completePhase(projectPath: string, phase: CocoPhase): Promise<void>;
  
  /**
   * Get next suggested phase
   */
  getNextPhase(projectPath: string): Promise<CocoPhase>;
  
  /**
   * Get contextual suggestion
   */
  getSuggestion(projectPath: string): Promise<string>;
}

/**
 * State file structure (stored in .coco/state.json)
 */
export interface StateFile {
  version: number;
  state: ProjectState;
}

/**
 * Phase metadata
 */
export interface PhaseMetadata {
  name: string;
  description: string;
  emoji: string;
  command: string;
  nextPhase: CocoPhase;
}

/**
 * Phase metadata map
 */
export const PHASE_METADATA: Record<CocoPhase, PhaseMetadata> = {
  none: {
    name: 'None',
    description: 'No phases completed yet',
    emoji: '🆕',
    command: '/init',
    nextPhase: 'converge',
  },
  converge: {
    name: 'Converge',
    description: 'Project specification created',
    emoji: '📝',
    command: '/plan',
    nextPhase: 'orchestrate',
  },
  orchestrate: {
    name: 'Orchestrate',
    description: 'Architecture designed',
    emoji: '📐',
    command: '/build',
    nextPhase: 'complete',
  },
  complete: {
    name: 'Complete',
    description: 'Implementation in progress',
    emoji: '🔨',
    command: '/build',
    nextPhase: 'output',
  },
  output: {
    name: 'Output',
    description: 'Project ready for deployment',
    emoji: '🚀',
    command: '/output',
    nextPhase: 'none',
  },
};
