/**
 * Types for the Prompt Enhancers system.
 *
 * Enhancers are modular behavioral directives injected into the system prompt
 * based on the type of user request. This makes the agent adapt its behavior
 * dynamically — applying verification protocols for code changes, debugging
 * discipline for bug fixes, etc.
 */

/**
 * Classification of user request intent.
 * Used to select which prompt enhancers to activate.
 */
export type RequestType =
  | "feature"
  | "bugfix"
  | "refactor"
  | "test"
  | "review"
  | "question"
  | "plan"
  | "debug"
  | "general";

/** All possible request types as a readonly array (for iteration/validation) */
export const ALL_REQUEST_TYPES: readonly RequestType[] = [
  "feature",
  "bugfix",
  "refactor",
  "test",
  "review",
  "question",
  "plan",
  "debug",
  "general",
] as const;

/**
 * A prompt enhancer — a modular behavioral directive that gets injected
 * into the system prompt when specific request types are detected.
 */
export interface PromptEnhancer {
  /** Unique identifier for this enhancer */
  name: string;

  /** Human-readable description of what this enhancer does */
  description: string;

  /** Which request types trigger this enhancer. Use "general" to trigger on ALL types. */
  triggers: readonly RequestType[];

  /** Injection priority — lower number means injected earlier in the prompt */
  priority: number;

  /** The prompt text to inject into the system prompt */
  content: string;

  /** Whether this enhancer is currently enabled */
  enabled: boolean;
}
