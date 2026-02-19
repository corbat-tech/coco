/**
 * Unified Skill Types for Corbat-Coco
 *
 * Supports two kinds of skills:
 * - Markdown (SKILL.md): Industry-standard format from skills.sh, injected into LLM system prompt
 * - Native (TypeScript): Executable skills like /ship with deep runtime integration
 */

import { z } from "zod";

// ============================================================================
// Skill Scope
// ============================================================================

/** Where a skill was discovered */
export type SkillScope = "builtin" | "global" | "project";

/** Scope resolution priority (project > global > builtin) */
export const SCOPE_PRIORITY: Record<SkillScope, number> = {
  project: 3,
  global: 2,
  builtin: 1,
};

// ============================================================================
// Skill Kind
// ============================================================================

/** Two fundamental skill types */
export type SkillKind = "markdown" | "native";

// ============================================================================
// Skill Category
// ============================================================================

/** Extended categories (superset of existing REPL SkillCategory) */
export type SkillCategory =
  | "general"
  | "git"
  | "model"
  | "coco"
  | "debug"
  | "custom"
  | "coding"
  | "testing"
  | "deployment"
  | "documentation"
  | "workflow";

/** All valid skill categories as a runtime set */
export const VALID_CATEGORIES = new Set<string>([
  "general", "git", "model", "coco", "debug", "custom",
  "coding", "testing", "deployment", "documentation", "workflow",
]);

/** Resolve a string to a valid SkillCategory, defaulting to "general" */
export function resolveCategory(category?: string): SkillCategory {
  if (category && VALID_CATEGORIES.has(category)) {
    return category as SkillCategory;
  }
  return "general";
}

// ============================================================================
// SKILL.md Frontmatter Schema (industry standard from skills.sh)
// ============================================================================

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  version: z.string().default("1.0.0"),
  license: z.string().optional(),
  globs: z.union([z.string(), z.array(z.string())]).optional(),
  // skills.sh standard fields
  "disable-model-invocation": z.boolean().optional(),
  "allowed-tools": z.union([z.string(), z.array(z.string())]).optional(),
  "argument-hint": z.string().optional(),
  compatibility: z.string().max(500).optional(),
  model: z.string().optional(),
  context: z.enum(["fork", "agent", "inline"]).optional(),
  // Top-level tags/author (skills.sh style) — also accepted inside metadata
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  author: z.string().optional(),
  // Nested metadata (Coco style)
  metadata: z
    .object({
      author: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

// ============================================================================
// Skill Metadata (lightweight, loaded eagerly at startup)
// ============================================================================

/** Lightweight skill descriptor (~50 tokens each, loaded at startup) */
export interface SkillMetadata {
  /** Unique identifier (derived from name, kebab-case) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description -- used for semantic matching */
  description: string;
  /** Source repository or origin (e.g., "anthropics/skills", "local") */
  source?: string;
  /** Namespace prefix (derived from source directory structure) */
  namespace?: string;
  /** Version */
  version: string;
  /** Category for organization */
  category: SkillCategory;
  /** Kind of skill */
  kind: SkillKind;
  /** Where this skill was found */
  scope: SkillScope;
  /** Filesystem path to the skill root */
  path: string;
  /** Optional aliases for slash-command invocation */
  aliases?: string[];
  /** Optional glob patterns for auto-activation */
  globs?: string[];
  /** Tags for discovery */
  tags?: string[];
  /** Author information */
  author?: string;
  /** If true, this skill should NOT be auto-activated by the matcher */
  disableModelInvocation?: boolean;
  /** Tools this skill is allowed to use */
  allowedTools?: string[];
  /** Argument hint for CLI autocomplete */
  argumentHint?: string;
  /** Environment compatibility notes */
  compatibility?: string;
  /** Model override for this skill */
  model?: string;
  /** Execution context */
  context?: "fork" | "agent" | "inline";
}

// ============================================================================
// Loaded Skill Content (loaded lazily on demand)
// ============================================================================

/** Fully loaded markdown skill content */
export interface MarkdownSkillContent {
  /** The full markdown instructions */
  instructions: string;
  /** Paths to reference files, if any */
  references: string[];
  /** Paths to script files, if any */
  scripts: string[];
  /** Paths to template files, if any */
  templates: string[];
}

/** Fully loaded native skill content */
export interface NativeSkillContent {
  /** The execute function */
  execute: (args: string, context: SkillExecutionContext) => Promise<SkillExecutionResult>;
}

/** Union of loaded skill content */
export type SkillContent = MarkdownSkillContent | NativeSkillContent;

/** A skill with content loaded */
export interface LoadedSkill {
  metadata: SkillMetadata;
  content: SkillContent;
}

// ============================================================================
// Execution Types (compatible with existing REPL Skill types)
// ============================================================================

/** Context for skill execution */
export interface SkillExecutionContext {
  cwd: string;
  session?: unknown;
  provider?: unknown;
  config?: unknown;
}

/** Result of skill execution */
export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  shouldExit?: boolean;
  /** If true, the output should be run as a subagent prompt (for context: fork/agent skills) */
  shouldFork?: boolean;
}

// ============================================================================
// Skill Match Result
// ============================================================================

/** Result of matching user input against available skills */
export interface SkillMatch {
  skill: SkillMetadata;
  /** Relevance score 0-1 */
  score: number;
  /** Why this skill matched */
  reason: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/** Check if content is markdown skill content */
export function isMarkdownContent(content: SkillContent): content is MarkdownSkillContent {
  return "instructions" in content;
}

/** Check if content is native skill content */
export function isNativeContent(content: SkillContent): content is NativeSkillContent {
  return "execute" in content;
}
