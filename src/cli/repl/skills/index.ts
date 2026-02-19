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
export {
  createHelpSkill,
  clearSkill,
  statusSkill,
  compactSkill,
  reviewSkill,
  diffSkill,
  shipSkill,
  openSkill,
} from "./builtin/index.js";

// Import for factory function
import { SkillRegistry } from "./registry.js";
import {
  createHelpSkill,
  clearSkill,
  statusSkill,
  compactSkill,
  reviewSkill,
  diffSkill,
  shipSkill,
  openSkill,
} from "./builtin/index.js";

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
  registry.register(shipSkill);
  registry.register(openSkill);

  return registry;
}

/**
 * Get builtin skills as LegacySkill array for the unified skill discovery system.
 * This bridges the existing REPL skills into the new unified registry.
 */
export function getBuiltinSkillsForDiscovery(): Array<{
  name: string;
  description: string;
  aliases?: string[];
  category?: string;
  execute: (
    args: string,
    context: unknown,
  ) => Promise<{ success: boolean; output?: string; error?: string; shouldExit?: boolean }>;
}> {
  // Note: help skill excluded here (it needs registry reference)
  // It will be available via slash commands, not the unified discovery
  const builtins = [
    clearSkill,
    statusSkill,
    compactSkill,
    reviewSkill,
    diffSkill,
    shipSkill,
    openSkill,
  ];
  return builtins.map((s) => ({
    name: s.name,
    description: s.description,
    aliases: s.aliases,
    category: s.category,
    execute: s.execute as (
      args: string,
      context: unknown,
    ) => Promise<{ success: boolean; output?: string; error?: string; shouldExit?: boolean }>,
  }));
}
