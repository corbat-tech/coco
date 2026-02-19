/**
 * TypeScript Native Skill Loader
 *
 * Adapts existing native Skill objects (from the REPL skills system)
 * into the unified skill type system. This is a thin wrapper that
 * converts existing skills without requiring changes to their code.
 */

import type { SkillMetadata, NativeSkillContent, LoadedSkill, SkillScope } from "../types.js";
import { resolveCategory } from "../types.js";
import { toKebabCase } from "./markdown-loader.js";

/** The existing REPL Skill interface (duplicated here to avoid circular deps) */
export interface LegacySkill {
  name: string;
  description: string;
  usage?: string;
  aliases?: string[];
  category?: string;
  execute: (
    args: string,
    context: unknown,
  ) => Promise<{ success: boolean; output?: string; error?: string; shouldExit?: boolean }>;
}

/**
 * Convert a legacy REPL Skill to SkillMetadata
 */
export function nativeSkillToMetadata(skill: LegacySkill, scope: SkillScope): SkillMetadata {
  const category = resolveCategory(skill.category);

  return {
    id: toKebabCase(skill.name),
    name: skill.name,
    description: skill.description,
    version: "1.0.0",
    category,
    kind: "native",
    scope,
    path: "",
    aliases: skill.aliases,
  };
}

/**
 * Convert a legacy REPL Skill to a fully LoadedSkill
 */
export function nativeSkillToLoaded(skill: LegacySkill, scope: SkillScope): LoadedSkill {
  const metadata = nativeSkillToMetadata(skill, scope);
  const content: NativeSkillContent = {
    execute: skill.execute as NativeSkillContent["execute"],
  };
  return { metadata, content };
}
