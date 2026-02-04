/**
 * Context management exports
 * Provides automatic context window management and compaction
 */

// Manager
export {
  ContextManager,
  createContextManager,
  DEFAULT_CONTEXT_CONFIG,
  type ContextManagerConfig,
  type ContextUsageStats,
} from "./manager.js";

// Compactor
export {
  ContextCompactor,
  createContextCompactor,
  DEFAULT_COMPACTOR_CONFIG,
  type CompactorConfig,
  type CompactionResult,
} from "./compactor.js";
