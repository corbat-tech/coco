/**
 * Skills System
 *
 * Central module for the skills/slash commands system.
 * Provides a registry for managing and executing skills.
 */

// Export types
export type { Skill, SkillContext, SkillResult, SkillCategory, SkillInfo } from "./types.js";

// Export registry
export { SkillRegistry, createSkillRegistry } from "./registry.js";

// Export builtin skills
export { createHelpSkill, clearSkill, statusSkill, compactSkill, reviewSkill, diffSkill } from "./builtin/index.js";

// Import for factory function
import { SkillRegistry } from "./registry.js";
import { createHelpSkill, clearSkill, statusSkill, compactSkill, reviewSkill, diffSkill } from "./builtin/index.js";

/**
 * Create a skill registry with all built-in skills registered
 * @returns SkillRegistry with default skills
 */
export function createDefaultRegistry(): SkillRegistry {
  const registry = new SkillRegistry();

  // Register built-in skills
  // Note: help skill needs registry reference for dynamic help
  registry.register(createHelpSkill(registry));
  registry.register(clearSkill);
  registry.register(statusSkill);
  registry.register(compactSkill);
  registry.register(reviewSkill);
  registry.register(diffSkill);

  return registry;
}
