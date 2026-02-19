/**
 * Markdown Skill Loader
 *
 * Parses SKILL.md files following the industry-standard Agent Skills format:
 * - YAML frontmatter for metadata
 * - Markdown body for instructions
 * - Optional references/, scripts/, templates/ subdirectories
 */

import matter from "gray-matter";
import type { SkillMetadata, MarkdownSkillContent, SkillScope } from "../types.js";
import { SkillFrontmatterSchema, resolveCategory } from "../types.js";
import { getLogger } from "../../utils/logger.js";
import fs from "node:fs/promises";
import path from "node:path";

const SKILL_FILENAME = "SKILL.md";

/**
 * Check if a directory contains a SKILL.md file
 */
export async function isMarkdownSkill(skillDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(skillDir, SKILL_FILENAME));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load only skill metadata from a SKILL.md file (lightweight, ~50 tokens)
 *
 * Only parses the YAML frontmatter, skips the markdown body.
 * Used at startup for eager discovery.
 */
export async function loadMarkdownMetadata(
  skillDir: string,
  scope: SkillScope,
): Promise<SkillMetadata | null> {
  try {
    const skillPath = path.join(skillDir, SKILL_FILENAME);
    const raw = await fs.readFile(skillPath, "utf-8");
    const { data } = matter(raw);

    const parsed = SkillFrontmatterSchema.safeParse(data);
    if (!parsed.success) {
      return null;
    }

    const fm = parsed.data;
    const dirName = path.basename(skillDir);

    return {
      id: toKebabCase(fm.name || dirName),
      name: fm.name || dirName,
      description: fm.description,
      version: fm.version,
      category: resolveCategory(fm.metadata?.category),
      kind: "markdown",
      scope,
      path: skillDir,
      globs: fm.globs ? (Array.isArray(fm.globs) ? fm.globs : [fm.globs]) : undefined,
      // Merge tags: top-level takes priority, then metadata.tags
      tags: mergeTags(fm.tags, fm.metadata?.tags),
      // Author: top-level takes priority
      author: fm.author ?? fm.metadata?.author,
      // New skills.sh standard fields
      disableModelInvocation: fm["disable-model-invocation"],
      allowedTools: parseAllowedTools(fm["allowed-tools"]),
      argumentHint: fm["argument-hint"],
      compatibility: fm.compatibility,
      model: fm.model,
      context: fm.context,
    };
  } catch (error) {
    const logger = getLogger();
    logger.warn(
      `[Skills] Failed to load metadata from ${skillDir}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Load full skill content from a SKILL.md directory (lazy, on demand)
 *
 * Reads the complete markdown body and scans for supporting files.
 */
export async function loadMarkdownContent(
  skillDir: string,
): Promise<MarkdownSkillContent | null> {
  try {
    const skillPath = path.join(skillDir, SKILL_FILENAME);
    const raw = await fs.readFile(skillPath, "utf-8");
    const { content } = matter(raw);

    const references = await listSubdirectory(skillDir, "references");
    const scripts = await listSubdirectory(skillDir, "scripts");
    const templates = await listSubdirectory(skillDir, "templates");

    return {
      instructions: content.trim(),
      references,
      scripts,
      templates,
    };
  } catch (error) {
    const logger = getLogger();
    logger.warn(
      `[Skills] Failed to load content from ${skillDir}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** List files in a skill subdirectory */
async function listSubdirectory(skillDir: string, subdir: string): Promise<string[]> {
  try {
    const dir = path.join(skillDir, subdir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/** Merge tags from top-level and metadata, deduplicating */
function mergeTags(topLevel?: string | string[], nested?: string[]): string[] | undefined {
  const tags = new Set<string>();
  if (topLevel) {
    const arr = Array.isArray(topLevel) ? topLevel : topLevel.split(/[,\s]+/).filter(Boolean);
    for (const t of arr) tags.add(t.trim());
  }
  if (nested) {
    for (const t of nested) tags.add(t.trim());
  }
  return tags.size > 0 ? Array.from(tags) : undefined;
}

/** Parse allowed-tools from string or array format */
function parseAllowedTools(tools?: string | string[]): string[] | undefined {
  if (!tools) return undefined;
  if (Array.isArray(tools)) return tools;
  // Parse space/comma-separated: "Bash, Read, Write" or "Bash Read Write"
  return tools.split(/[,\s]+/).filter(Boolean);
}

/** Convert a string to kebab-case for use as skill ID */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")     // trim leading/trailing hyphens
    .replace(/-{2,}/g, "-")       // collapse consecutive hyphens
    .slice(0, 64);                // max 64 chars per standard
}

