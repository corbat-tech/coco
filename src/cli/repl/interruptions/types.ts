/**
 * Types for the interruption classification and processing system
 *
 * @module cli/repl/interruptions/types
 */

/**
 * Type of interruption the user is sending
 */
export enum InterruptionType {
  /** Stop/cancel the current execution immediately */
  Abort = "abort",
  /** Modify the current task (add/change something) */
  Modify = "modify",
  /** Correct an error or mistake */
  Correct = "correct",
  /** Provide additional context/information for current or next turn */
  Info = "info",
}

/**
 * A classified interruption
 */
export interface ClassifiedInterruption {
  /** Original message text */
  text: string;
  /** Classified type */
  type: InterruptionType;
  /** Confidence of classification (0-1) */
  confidence: number;
  /** Timestamp when the message was captured */
  timestamp: number;
}

/**
 * Result of processing interruptions
 */
export interface ProcessingResult {
  /** Whether the agent should abort its current execution */
  shouldAbort: boolean;
  /** Messages to append to the next agent turn as context */
  contextMessages: string[];
  /** Summary of what was processed */
  summary: string;
}

/**
 * User-selected action for an interruption (from the action selector menu)
 */
export enum InterruptionAction {
  /** Modify the current task — inject as priority context in the current turn */
  Modify = "modify",
  /** Queue the message for the next agent turn */
  Queue = "queue",
  /** Abort the current execution immediately */
  Abort = "abort",
}

/**
 * An interruption with both classification and user-selected action
 */
export interface ActionedInterruption extends ClassifiedInterruption {
  /** The action the user selected (or auto-selected) */
  action: InterruptionAction;
}
