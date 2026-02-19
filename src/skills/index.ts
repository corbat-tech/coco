/**
 * Skills System - Public API
 *
 * Unified skill system supporting both SKILL.md (industry standard)
 * and native TypeScript skills.
 */

// Types
export type {
  SkillScope,
  SkillKind,
  SkillCategory,
  SkillMetadata,
  MarkdownSkillContent,
  NativeSkillContent,
  SkillContent,
  LoadedSkill,
  SkillExecutionContext,
  SkillExecutionResult,
  SkillMatch,
  SkillFrontmatter,
} from "./types.js";

export { SkillFrontmatterSchema, SCOPE_PRIORITY, isMarkdownContent, isNativeContent } from "./types.js";

// Registry
export { UnifiedSkillRegistry, createUnifiedSkillRegistry } from "./registry.js";
export type { SkillsRuntimeConfig } from "./registry.js";

// Discovery
export { discoverAllSkills, scanSkillsDirectory } from "./discovery.js";
export type { DiscoveryOptions } from "./discovery.js";

// Matcher
export { matchSkills, tokenize, stem, levenshtein } from "./matcher.js";
export type { MatchOptions } from "./matcher.js";

// Loaders
export {
  isMarkdownSkill,
  loadMarkdownMetadata,
  loadMarkdownContent,
  nativeSkillToMetadata,
  nativeSkillToLoaded,
  loadSkillFromDirectory,
  loadFullSkill,
} from "./loader/index.js";
