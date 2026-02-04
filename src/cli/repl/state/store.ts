/**
 * Project State Store
 *
 * Persistent storage for project state in .coco/state.json
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ProjectState,
  StateFile,
  StateManager,
  CocoPhase,
} from './types.js';
import { PHASE_METADATA } from './types.js';

/** Current state version */
const STATE_VERSION = 1;

/** Default empty state */
const DEFAULT_STATE: ProjectState = {
  path: '',
  currentPhase: 'none',
  completedPhases: [],
  version: STATE_VERSION,
  updatedAt: new Date().toISOString(),
};

/**
 * Get state file path
 */
function getStatePath(projectPath: string): string {
  return path.join(projectPath, '.coco', 'state.json');
}

/**
 * Create a state manager
 */
export function createStateManager(): StateManager {
  /**
   * Load state from disk
   */
  async function load(projectPath: string): Promise<ProjectState> {
    const statePath = getStatePath(projectPath);
    
    try {
      const content = await fs.readFile(statePath, 'utf-8');
      const file = JSON.parse(content) as StateFile;
      
      // Validate version
      if (file.version !== STATE_VERSION) {
        // Could add migration logic here
        console.warn(`State version mismatch: ${file.version} vs ${STATE_VERSION}`);
      }
      
      return {
        ...DEFAULT_STATE,
        ...file.state,
        path: projectPath,
      };
    } catch (error) {
      // State file doesn't exist, return default
      return {
        ...DEFAULT_STATE,
        path: projectPath,
      };
    }
  }

  /**
   * Save state to disk
   */
  async function save(state: ProjectState): Promise<void> {
    const statePath = getStatePath(state.path);
    
    // Ensure .coco directory exists
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    
    const file: StateFile = {
      version: STATE_VERSION,
      state: {
        ...state,
        updatedAt: new Date().toISOString(),
      },
    };
    
    await fs.writeFile(statePath, JSON.stringify(file, null, 2), 'utf-8');
  }

  /**
   * Clear state for a project
   */
  async function clear(projectPath: string): Promise<void> {
    const statePath = getStatePath(projectPath);
    
    try {
      await fs.unlink(statePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Check if state exists
   */
  async function exists(projectPath: string): Promise<boolean> {
    const statePath = getStatePath(projectPath);
    
    try {
      await fs.access(statePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update current phase
   */
  async function updatePhase(projectPath: string, phase: CocoPhase): Promise<void> {
    const state = await load(projectPath);
    state.currentPhase = phase;
    await save(state);
  }

  /**
   * Mark phase as completed
   */
  async function completePhase(projectPath: string, phase: CocoPhase): Promise<void> {
    const state = await load(projectPath);
    
    if (!state.completedPhases.includes(phase)) {
      state.completedPhases.push(phase);
    }
    
    // Update current phase to next
    const metadata = PHASE_METADATA[phase];
    if (metadata.nextPhase !== 'none') {
      state.currentPhase = metadata.nextPhase;
    }
    
    await save(state);
  }

  /**
   * Get next suggested phase
   */
  async function getNextPhase(projectPath: string): Promise<CocoPhase> {
    const state = await load(projectPath);
    return PHASE_METADATA[state.currentPhase].nextPhase;
  }

  /**
   * Get contextual suggestion
   */
  async function getSuggestion(projectPath: string): Promise<string> {
    const state = await load(projectPath);
    const metadata = PHASE_METADATA[state.currentPhase];
    
    switch (state.currentPhase) {
      case 'none':
        return `Run ${metadata.command} to create a project specification`;
      
      case 'converge':
        if (state.specification) {
          return `Specification "${state.specification.name}" created. Run ${metadata.command} to design architecture`;
        }
        return `Run ${metadata.command} to design architecture`;
      
      case 'orchestrate':
        if (state.architecture) {
          return `Architecture with ${state.architecture.components} components defined. Run ${metadata.command} to start implementation`;
        }
        return `Run ${metadata.command} to start implementation`;
      
      case 'complete':
        if (state.sprint) {
          const { tasksCompleted, tasksTotal, currentSprint } = state.sprint;
          return `Sprint ${currentSprint}: ${tasksCompleted}/${tasksTotal} tasks completed. Run ${metadata.command} to continue`;
        }
        return `Run ${metadata.command} to continue implementation`;
      
      case 'output':
        return `Project ready! Run ${metadata.command} to generate CI/CD and documentation`;
      
      default:
        return `Run ${metadata.command}`;
    }
  }

  return {
    load,
    save,
    clear,
    exists,
    updatePhase,
    completePhase,
    getNextPhase,
    getSuggestion,
  };
}

/**
 * Singleton state manager instance
 */
let globalStateManager: StateManager | null = null;

/**
 * Get or create global state manager
 */
export function getStateManager(): StateManager {
  if (!globalStateManager) {
    globalStateManager = createStateManager();
  }
  return globalStateManager;
}

/**
 * Format state for display
 */
export function formatStateStatus(state: ProjectState): string {
  const { emoji, name } = PHASE_METADATA[state.currentPhase];
  const parts: string[] = [`${emoji} ${name}`];
  
  if (state.specification) {
    parts.push(`📋 ${state.specification.name}`);
  }
  
  if (state.sprint) {
    parts.push(`🔨 Sprint ${state.sprint.currentSprint}`);
  }
  
  return parts.join(' | ');
}

/**
 * Get state summary for welcome banner
 */
export function getStateSummary(state: ProjectState): {
  spec: boolean;
  architecture: boolean;
  implementation: boolean;
} {
  return {
    spec: state.completedPhases.includes('converge'),
    architecture: state.completedPhases.includes('orchestrate'),
    implementation: state.completedPhases.includes('complete'),
  };
}
