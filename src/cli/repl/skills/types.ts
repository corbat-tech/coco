/**
 * Skills/Slash Commands Type Definitions
 *
 * Skills are self-contained commands that can be executed from the REPL.
 * They provide a way to extend the REPL with custom functionality.
 */

import type { ReplSession, ReplConfig } from "../types.js";
import type { LLMProvider } from "../../../providers/types.js";

/**
 * Context passed to skill execution
 */
export interface SkillContext {
  /** Current working directory */
  cwd: string;
  /** Active REPL session */
  session: ReplSession;
  /** LLM provider (optional, may not be available for all skills) */
  provider?: LLMProvider;
  /** Session configuration */
  config: ReplConfig;
}

/**
 * Result of skill execution
 */
export interface SkillResult {
  /** Whether the skill executed successfully */
  success: boolean;
  /** Output message to display to the user */
  output?: string;
  /** Error message if execution failed */
  error?: string;
  /** Whether the REPL should exit after this skill */
  shouldExit?: boolean;
}

/**
 * Skill definition
 *
 * Skills are modular, reusable commands that can be registered
 * with the SkillRegistry and executed via slash commands.
 */
export interface Skill {
  /** Primary name of the skill (e.g., "commit") */
  name: string;
  /** Short description shown in help */
  description: string;
  /** Usage example (e.g., "/commit -m 'message'") */
  usage?: string;
  /** Alternative names for the skill */
  aliases?: string[];
  /** Category for grouping in help display */
  category?: SkillCategory;
  /**
   * Execute the skill
   * @param args - Arguments passed to the skill as a single string
   * @param context - Execution context with session, cwd, etc.
   * @returns Result of execution
   */
  execute: (args: string, context: SkillContext) => Promise<SkillResult>;
}

/**
 * Skill categories for organization
 */
export type SkillCategory =
  | "general"
  | "git"
  | "model"
  | "coco"
  | "debug"
  | "custom";

/**
 * Skill metadata for display purposes
 */
export interface SkillInfo {
  /** Primary name */
  name: string;
  /** Description */
  description: string;
  /** Usage string */
  usage: string;
  /** All aliases including the primary name */
  allNames: string[];
  /** Category */
  category: SkillCategory;
}
