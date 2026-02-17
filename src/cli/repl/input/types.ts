/**
 * Types for concurrent input capture system
 *
 * @module cli/repl/input/types
 */

/**
 * A message captured from stdin during agent execution
 */
export interface QueuedMessage {
  /** The trimmed text content of the message */
  text: string;
  /** Unix timestamp (ms) when the message was captured */
  timestamp: number;
}

/**
 * Configuration for concurrent capture
 */
export interface CaptureConfig {
  /** Whether to emit a bell character on message capture (default: false) */
  bell: boolean;
  /** Maximum number of queued messages before oldest are dropped (default: 50) */
  maxQueueSize: number;
}

/**
 * State of the concurrent capture system
 */
export type CaptureState = "idle" | "capturing" | "stopped";

/**
 * Callback invoked when a complete message (line) is captured
 */
export type MessageCapturedCallback = (message: QueuedMessage) => void;
