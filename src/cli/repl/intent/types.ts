/**
 * Intent Recognition Types
 *
 * Types for the natural language intent detection system.
 */

/**
 * Supported intent types
 */
export type IntentType =
  | "plan" // Architecture and planning
  | "build" // Build/implementation
  | "task" // Single task execution
  | "init" // Project initialization
  | "output" // Generate CI/CD and docs
  | "status" // Check project status
  | "trust" // Trust management
  | "ship" // Ship/release workflow
  | "open" // Open files or execute scripts
  | "help" // Help request
  | "exit" // Exit REPL
  | "chat"; // General chat (default)

/**
 * Extracted entities from user input
 */
export interface IntentEntities {
  /** Sprint number if mentioned */
  sprint?: number;
  /** Task ID or description */
  taskId?: string;
  taskDescription?: string;
  /** Technology stack mentioned */
  techStack?: string[];
  /** Project name for init */
  projectName?: string;
  /** Flags like --dry-run, --yes */
  flags?: string[];
  /** Additional arguments */
  args?: string[];
}

/**
 * Recognized intent with confidence
 */
export interface Intent {
  /** Type of intent */
  type: IntentType;
  /** Confidence score (0-1) */
  confidence: number;
  /** Extracted entities */
  entities: IntentEntities;
  /** Original raw input */
  raw: string;
  /** Matched pattern (for debugging) */
  matchedPattern?: string;
}

/**
 * Intent recognizer interface
 */
export interface IntentRecognizer {
  /**
   * Recognize intent from user input
   */
  recognize(input: string): Promise<Intent>;
}

/**
 * Pattern definition for intent matching
 */
export interface IntentPattern {
  /** Pattern type */
  type: IntentType;
  /** Regular expressions to match */
  patterns: RegExp[];
  /** Base confidence for this pattern */
  baseConfidence: number;
  /** Whether this is an exact match pattern */
  exactMatch?: boolean;
}

/**
 * Configuration for intent recognition
 */
export interface IntentConfig {
  /** Minimum confidence threshold to consider an intent valid */
  minConfidence: number;
  /** Whether to auto-execute high-confidence intents */
  autoExecute: boolean;
  /** Confidence threshold for auto-execution */
  autoExecuteThreshold: number;
  /** Intent types that should always ask for confirmation */
  alwaysConfirm: IntentType[];
  /** User preferences for auto-execution per intent type */
  autoExecutePreferences: Partial<Record<IntentType, boolean>>;
}

/**
 * Result of intent resolution
 */
export interface IntentResolution {
  /** Whether to execute the intent as a command */
  execute: boolean;
  /** The command to execute (if any) */
  command?: string;
  /** Arguments for the command */
  args?: string[];
  /** Whether to remember this choice */
  remember?: boolean;
}
