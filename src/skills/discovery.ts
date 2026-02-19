/**
 * Multi-scope Skill Discovery
 *
 * Discovers skills across three scopes:
 * - builtin: Native skills compiled into Coco
 * - global: ~/.coco/skills/
 * - project: <project>/.coco/skills/, .agents/skills/, .claude/skills/
 *
 * Higher-priority scopes override lower-priority ones for the same skill ID.
 * For project skills, directories are scanned in ascending priority order:
 *   .claude/skills/ (Claude compat) < .agents/skills/ (shared standard) < .coco/skills/ (native)
 * This means .coco/skills/ always wins when the same skill exists in multiple directories.
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

/** Project skills directory names (scanned in ascending priority; later entries override earlier) */
const PROJECT_SKILLS_DIRNAMES = [
  ".claude/skills", // Claude compat — read for migration/interop (lowest project priority)
  ".agents/skills", // Shared cross-agent standard (medium priority)
  ".coco/skills", // Coco native — authoritative (highest project priority)
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
  // Scans in ascending priority: .claude/skills/ < .agents/skills/ < .coco/skills/
  // .coco/skills/ is Coco's native dir and always wins for the same skill ID
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

/** Maximum nesting depth for namespace directories (1 level of namespacing) */
const MAX_NESTING_DEPTH = 1;

/**
 * Scan a directory for skills
 *
 * Each immediate subdirectory is a potential skill.
 * Also supports one level of nesting for namespace/monorepo structures
 * (e.g., skills/owner/skill-name/SKILL.md).
 *
 * Security: Symlinks are skipped to prevent directory traversal attacks and
 * infinite loops. Only real directories are scanned.
 */
export async function scanSkillsDirectory(
  dir: string,
  scope: SkillScope,
): Promise<SkillMetadata[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    // Only scan real directories — skip symlinks to prevent traversal/loops
    const skillDirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink());

    const results: (SkillMetadata | null)[] = [];

    for (const entry of skillDirs) {
      const entryPath = path.join(dir, entry.name);

      // Double-check: skip symlinked directories (some Node versions don't
      // report isSymbolicLink() correctly on dirent)
      try {
        const stat = await fs.lstat(entryPath);
        if (stat.isSymbolicLink()) continue;
      } catch {
        continue;
      }

      // Try loading directly (flat structure: skills/my-skill/SKILL.md)
      const directResult = await loadSkillFromDirectory(entryPath, scope);
      if (directResult) {
        results.push(directResult);
        continue;
      }

      // Try nested scan (namespace structure: skills/owner/skill-name/SKILL.md)
      // Limited to MAX_NESTING_DEPTH level(s) to prevent deep traversal
      const nestedResults = await scanNestedSkills(entryPath, scope, 0);
      results.push(...nestedResults);
    }

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

/**
 * Scan nested namespace directories for skills with depth limiting.
 * Only scans real directories (symlinks skipped).
 */
async function scanNestedSkills(
  dir: string,
  scope: SkillScope,
  depth: number,
): Promise<(SkillMetadata | null)[]> {
  if (depth >= MAX_NESTING_DEPTH) return [];

  try {
    const subEntries = await fs.readdir(dir, { withFileTypes: true });
    const subDirs = subEntries.filter((e) => e.isDirectory() && !e.isSymbolicLink());

    const results = await Promise.all(
      subDirs.map(async (sub) => {
        const subPath = path.join(dir, sub.name);
        // Skip symlinks (double check via lstat)
        try {
          const stat = await fs.lstat(subPath);
          if (stat.isSymbolicLink()) return null;
        } catch {
          return null;
        }
        return loadSkillFromDirectory(subPath, scope);
      }),
    );
    return results;
  } catch {
    // Not a directory or can't read — skip
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
