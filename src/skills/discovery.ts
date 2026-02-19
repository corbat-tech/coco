/**
 * Multi-scope Skill Discovery
 *
 * Discovers skills across three scopes:
 * - builtin: Native skills compiled into Coco
 * - global: ~/.coco/skills/
 * - project: <project>/.claude/skills/ and <project>/.coco/skills/
 *
 * Higher-priority scopes override lower-priority ones for the same skill ID.
 * For project skills, .claude/skills/ (industry standard) takes priority over
 * .coco/skills/ (coco-specific) when both directories contain the same skill ID.
 */

import type { SkillMetadata, SkillScope } from "./types.js";
import { SCOPE_PRIORITY } from "./types.js";
import { loadSkillFromDirectory } from "./loader/index.js";
import { nativeSkillToMetadata, type LegacySkill } from "./loader/typescript-loader.js";
import { COCO_HOME } from "../config/paths.js";
import { getLogger } from "../utils/logger.js";
import fs from "node:fs/promises";
import path from "node:path";

/** Default global skills directory */
const GLOBAL_SKILLS_DIR = path.join(COCO_HOME, "skills");

/** Project skills directory names (scanned in order; later entries override earlier) */
const PROJECT_SKILLS_DIRNAMES = [
  ".coco/skills",    // Coco convention (lower priority)
  ".claude/skills",  // Industry standard (higher priority)
];

/** Options for skill discovery */
export interface DiscoveryOptions {
  /** Override for global skills directory */
  globalDir?: string;
  /** Override for project skills directory */
  projectDir?: string;
}

/**
 * Discover all skills across all scopes
 *
 * Scans global and project directories for SKILL.md files,
 * wraps builtin native skills, and deduplicates by priority.
 *
 * @param projectPath - Root path of the current project
 * @param builtinSkills - Array of builtin native skills to include
 * @param options - Override directories for global/project skill paths
 * @returns Deduplicated array of SkillMetadata, sorted by name
 */
export async function discoverAllSkills(
  projectPath: string,
  builtinSkills: LegacySkill[] = [],
  options?: DiscoveryOptions | string,
): Promise<SkillMetadata[]> {
  // Backward compat: accept a plain string as globalDir override
  const opts: DiscoveryOptions =
    typeof options === "string" ? { globalDir: options } : (options ?? {});

  const allSkills = new Map<string, SkillMetadata>();

  // 1. Register builtin skills (lowest priority)
  for (const skill of builtinSkills) {
    const meta = nativeSkillToMetadata(skill, "builtin");
    allSkills.set(meta.id, meta);
  }

  // 2. Scan global skills directory
  const resolvedGlobalDir = opts.globalDir ?? GLOBAL_SKILLS_DIR;
  const globalSkills = await scanSkillsDirectory(resolvedGlobalDir, "global");
  for (const meta of globalSkills) {
    applyWithPriority(allSkills, meta);
  }

  // 3. Scan project skills directories (highest priority)
  // Support both .claude/skills/ (industry standard) and .coco/skills/ (coco-specific)
  // .claude/skills/ takes priority over .coco/skills/ for the same skill ID
  const projectDirs = opts.projectDir
    ? [opts.projectDir]
    : PROJECT_SKILLS_DIRNAMES.map((d) => path.join(projectPath, d));

  for (const dir of projectDirs) {
    const projectSkills = await scanSkillsDirectory(dir, "project");
    for (const meta of projectSkills) {
      applyWithPriority(allSkills, meta);
    }
  }

  // Return sorted by name
  return Array.from(allSkills.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scan a directory for skills
 *
 * Each immediate subdirectory is a potential skill.
 */
export async function scanSkillsDirectory(
  dir: string,
  scope: SkillScope,
): Promise<SkillMetadata[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory());

    const results = await Promise.all(
      skillDirs.map((entry) => loadSkillFromDirectory(path.join(dir, entry.name), scope)),
    );

    return results.filter((meta): meta is SkillMetadata => meta !== null);
  } catch (error) {
    // Directory doesn't exist is fine; log other errors for debugging
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const logger = getLogger();
      logger.warn(
        `[Skills] Failed to scan directory ${dir}:`,
        error instanceof Error ? error.message : error,
      );
    }
    return [];
  }
}

/** Apply a skill to the map, respecting scope priority */
function applyWithPriority(map: Map<string, SkillMetadata>, meta: SkillMetadata): void {
  const existing = map.get(meta.id);
  if (!existing || SCOPE_PRIORITY[meta.scope] > SCOPE_PRIORITY[existing.scope]) {
    map.set(meta.id, meta);
  }
}
