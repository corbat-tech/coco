/**
 * Skill Loader Orchestrator
 *
 * Detects the type of skill in a directory and delegates
 * to the appropriate loader (markdown or typescript).
 */

import type { SkillMetadata, LoadedSkill, SkillScope } from "../types.js";
import { isMarkdownSkill, loadMarkdownMetadata, loadMarkdownContent } from "./markdown-loader.js";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Load skill metadata from a directory (auto-detects skill kind)
 *
 * Checks for SKILL.md first (markdown skill), then index.ts/js (native).
 * Returns null if the directory doesn't contain a valid skill.
 */
export async function loadSkillFromDirectory(
  skillDir: string,
  scope: SkillScope,
): Promise<SkillMetadata | null> {
  // Check for SKILL.md (markdown skill)
  if (await isMarkdownSkill(skillDir)) {
    return loadMarkdownMetadata(skillDir, scope);
  }

  // Check for native TypeScript skill (index.ts or index.js)
  const hasTs = await fileExists(path.join(skillDir, "index.ts"));
  const hasJs = await fileExists(path.join(skillDir, "index.js"));

  if (hasTs || hasJs) {
    // For now, native skills from filesystem are not supported.
    // Native skills must be registered programmatically via nativeSkillToLoaded().
    // This can be extended later to support dynamic TS skill loading.
    return null;
  }

  return null;
}

/**
 * Load full skill content by metadata
 *
 * Uses the metadata's kind and path to load the appropriate content.
 */
export async function loadFullSkill(metadata: SkillMetadata): Promise<LoadedSkill | null> {
  if (metadata.kind === "markdown") {
    const content = await loadMarkdownContent(metadata.path);
    if (!content) return null;
    return { metadata, content };
  }

  // Native skills are pre-cached in UnifiedSkillRegistry.discoverAndRegister().
  // loadSkill() checks cache first, so this code path should not be reached for
  // native skills. If it is, log a warning and return null gracefully.
  const { getLogger } = await import("../../utils/logger.js");
  getLogger().warn(`[Skills] loadFullSkill called for non-markdown skill: ${metadata.id} (kind: ${metadata.kind})`);
  return null;
}

/** Check if a file exists */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Re-exports for convenience
export { isMarkdownSkill, loadMarkdownMetadata, loadMarkdownContent } from "./markdown-loader.js";
export { nativeSkillToMetadata, nativeSkillToLoaded } from "./typescript-loader.js";
