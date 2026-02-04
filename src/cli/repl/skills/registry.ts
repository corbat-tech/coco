/**
 * Skill Registry
 *
 * Central registry for managing and executing skills (slash commands).
 * Supports skill registration, alias resolution, and execution.
 */

import type {
  Skill,
  SkillContext,
  SkillResult,
  SkillInfo,
  SkillCategory,
} from "./types.js";

/**
 * Registry for managing skills (slash commands)
 *
 * @description Central registry for registering, looking up, and executing skills.
 * Skills are identified by name and can have aliases for convenience. The registry
 * supports conflict detection and category-based organization.
 *
 * @example
 * ```typescript
 * const registry = new SkillRegistry();
 *
 * // Register a custom skill
 * registry.register({
 *   name: 'greet',
 *   description: 'Say hello',
 *   aliases: ['hello', 'hi'],
 *   execute: async (args) => ({ success: true, message: `Hello, ${args || 'world'}!` }),
 * });
 *
 * // Execute by name or alias
 * const result = await registry.execute('hi', 'Claude', context);
 * ```
 */
export class SkillRegistry {
  /** Map of skill name to skill definition */
  private skills: Map<string, Skill> = new Map();
  /** Map of alias to primary skill name */
  private aliases: Map<string, string> = new Map();

  /**
   * Register a skill with the registry
   *
   * @description Adds a skill to the registry along with its aliases. Validates
   * that neither the skill name nor any aliases conflict with existing entries.
   *
   * @param skill - Skill definition to register
   * @throws Error if skill name conflicts with existing skill or alias
   * @throws Error if any alias conflicts with existing skill or alias
   */
  register(skill: Skill): void {
    // Check for name conflict
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill '${skill.name}' is already registered`);
    }
    if (this.aliases.has(skill.name)) {
      throw new Error(
        `Skill name '${skill.name}' conflicts with existing alias`
      );
    }

    // Register the skill
    this.skills.set(skill.name, skill);

    // Register aliases
    if (skill.aliases) {
      for (const alias of skill.aliases) {
        if (this.skills.has(alias)) {
          throw new Error(
            `Alias '${alias}' for skill '${skill.name}' conflicts with existing skill`
          );
        }
        if (this.aliases.has(alias)) {
          const existingSkill = this.aliases.get(alias);
          throw new Error(
            `Alias '${alias}' for skill '${skill.name}' conflicts with alias for skill '${existingSkill}'`
          );
        }
        this.aliases.set(alias, skill.name);
      }
    }
  }

  /**
   * Unregister a skill from the registry
   * @param name - Name of the skill to unregister
   * @returns true if skill was found and removed
   */
  unregister(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }

    // Remove aliases
    if (skill.aliases) {
      for (const alias of skill.aliases) {
        this.aliases.delete(alias);
      }
    }

    // Remove skill
    this.skills.delete(name);
    return true;
  }

  /**
   * Get a skill by name or alias
   * @param nameOrAlias - Skill name or alias
   * @returns Skill if found, undefined otherwise
   */
  get(nameOrAlias: string): Skill | undefined {
    // Try direct lookup
    let skill = this.skills.get(nameOrAlias);
    if (skill) {
      return skill;
    }

    // Try alias resolution
    const primaryName = this.aliases.get(nameOrAlias);
    if (primaryName) {
      skill = this.skills.get(primaryName);
    }

    return skill;
  }

  /**
   * Check if a skill exists
   * @param nameOrAlias - Skill name or alias
   * @returns true if skill exists
   */
  has(nameOrAlias: string): boolean {
    return this.skills.has(nameOrAlias) || this.aliases.has(nameOrAlias);
  }

  /**
   * Get all registered skills
   * @returns Array of all skills
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill info for all registered skills
   * @returns Array of skill info objects
   */
  getAllInfo(): SkillInfo[] {
    return this.getAll().map((skill) => ({
      name: skill.name,
      description: skill.description,
      usage: skill.usage ?? `/${skill.name}`,
      allNames: [skill.name, ...(skill.aliases ?? [])],
      category: skill.category ?? "general",
    }));
  }

  /**
   * Get skills grouped by category
   *
   * @description Returns all skills organized by their category. Skills without
   * an explicit category are grouped under 'general'.
   *
   * @returns Map of category name to array of skills in that category
   */
  getByCategory(): Map<SkillCategory, Skill[]> {
    const byCategory = new Map<SkillCategory, Skill[]>();

    for (const skill of this.skills.values()) {
      const category = skill.category ?? "general";
      const existing = byCategory.get(category) ?? [];
      existing.push(skill);
      byCategory.set(category, existing);
    }

    return byCategory;
  }

  /**
   * Execute a skill by name or alias
   *
   * @description Looks up and executes a skill, handling errors gracefully.
   * Returns an error result if the skill is not found or throws during execution.
   *
   * @param nameOrAlias - Skill name or alias to execute
   * @param args - Arguments string to pass to the skill
   * @param context - Execution context with session and config
   * @returns Skill result with success status and output or error message
   *
   * @example
   * ```typescript
   * const result = await registry.execute('help', '', context);
   * if (result.success) {
   *   console.log(result.message);
   * }
   * ```
   */
  async execute(
    nameOrAlias: string,
    args: string,
    context: SkillContext
  ): Promise<SkillResult> {
    const skill = this.get(nameOrAlias);

    if (!skill) {
      return {
        success: false,
        error: `Unknown command: /${nameOrAlias}. Type /help for available commands.`,
      };
    }

    try {
      return await skill.execute(args, context);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Error executing /${skill.name}: ${message}`,
      };
    }
  }

  /**
   * Resolve an alias to its primary skill name
   * @param alias - Alias to resolve
   * @returns Primary skill name or undefined
   */
  resolveAlias(alias: string): string | undefined {
    // If it's a primary name, return it
    if (this.skills.has(alias)) {
      return alias;
    }
    // Otherwise, try alias resolution
    return this.aliases.get(alias);
  }

  /**
   * Get the number of registered skills
   *
   * @returns Total count of registered skills (not including aliases)
   */
  get size(): number {
    return this.skills.size;
  }
}

/**
 * Create a new skill registry
 *
 * @description Factory function for creating an empty SkillRegistry.
 * Use this for testing or when you need a registry without built-in skills.
 *
 * @returns New empty SkillRegistry instance
 *
 * @example
 * ```typescript
 * const registry = createSkillRegistry();
 * registry.register(myCustomSkill);
 * ```
 */
export function createSkillRegistry(): SkillRegistry {
  return new SkillRegistry();
}
