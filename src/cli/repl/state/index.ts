/**
 * Project State Module
 *
 * State tracking and management for REPL projects.
 */

export type {
  ProjectState,
  StateStore,
  StateManager,
  StateFile,
  CocoPhase,
  PhaseMetadata,
  SpecificationSummary,
  ArchitectureSummary,
  SprintProgress,
} from './types.js';

export {
  PHASE_METADATA,
} from './types.js';

export {
  createStateManager,
  getStateManager,
  formatStateStatus,
  getStateSummary,
} from './store.js';
