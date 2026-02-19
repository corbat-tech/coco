/**
 * Markdown Skill Loader
 *
 * Parses SKILL.md files following the industry-standard Agent Skills format:
 * - YAML frontmatter for metadata
 * - Markdown body for instructions
 * - Optional references/, scripts/, templates/ subdirectories
 */

import matter from "gray-matter";
import type { SkillMetadata, MarkdownSkillContent, SkillScope, SkillCategory } from "../types.js";
import { SkillFrontmatterSchema } from "../types.js";
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
      tags: fm.metadata?.tags,
      author: fm.metadata?.author,
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

/** Convert a string to kebab-case for use as skill ID */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

/** Map a string category to a valid SkillCategory, defaulting to "custom" */
function resolveCategory(category?: string): SkillCategory {
  const valid: Set<string> = new Set([
    "general",
    "git",
    "model",
    "coco",
    "debug",
    "custom",
    "coding",
    "testing",
    "deployment",
    "documentation",
    "workflow",
  ]);
  if (category && valid.has(category)) {
    return category as SkillCategory;
  }
  return "custom";
}
