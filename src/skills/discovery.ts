/**
 * Multi-scope Skill Discovery
 *
 * Discovers skills across three scopes:
 * - builtin: Native skills compiled into Coco
 * - global: ~/.coco/skills/, ~/.agents/skills/, and compat directories from other agents
 * - project: .agents/skills/ (native), .claude/skills/, .codex/skills/, .gemini/skills/, .opencode/skills/ (compat)
 *
 * Higher-priority scopes override lower-priority ones for the same skill ID.
 * For project skills, directories are scanned in ascending priority order:
 *   .claude/skills/ (Claude compat) < .codex/skills/ < .gemini/skills/ < .opencode/skills/ < .agents/skills/
 * This means .agents/skills/ wins when the same skill exists in multiple project directories.
 */

import type { SkillMetadata, SkillScope } from "./types.js";
import { SCOPE_PRIORITY } from "./types.js";
import { loadSkillFromDirectory } from "./loader/index.js";
import { nativeSkillToMetadata, type LegacySkill } from "./loader/typescript-loader.js";
import { COCO_HOME } from "../config/paths.js";
import { getLogger } from "../utils/logger.js";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** Default global skills directories (scanned in ascending priority order). */
const GLOBAL_SKILLS_DIRS = [
  path.join(homedir(), ".codex", "skills"), // Codex CLI legacy compat
  path.join(homedir(), ".gemini", "skills"), // Gemini CLI compat
  path.join(homedir(), ".opencode", "skills"), // OpenCode compat
  path.join(homedir(), ".claude", "skills"), // Claude Code compat
  path.join(homedir(), ".agents", "skills"), // shared cross-agent standard
  path.join(COCO_HOME, "skills"), // Coco native global directory (authoritative for Coco)
];

/**
 * Project skills directory names (scanned in ascending priority; later entries override earlier).
 *
 * Priority rationale:
 *  - .claude/skills   — Claude Code compatibility (lowest)
 *  - .codex/skills    — Codex CLI (OpenAI) compatibility
 *  - .gemini/skills   — Gemini CLI (Google) compatibility
 *  - .opencode/skills — OpenCode compatibility
 *  - .agents/skills   — Native: the cross-agent standard Coco writes to (highest)
 *
 * When the same skill ID appears in multiple directories, the later entry wins.
 * .agents/skills/ is authoritative because it is the shared, agent-neutral standard
 * (same reason Coco uses AGENTS.md as the primary instruction file).
 */
const PROJECT_SKILLS_DIRNAMES = [
  ".claude/skills", // Claude Code compat — read for migration/interop
  ".codex/skills", // Codex CLI (OpenAI) compat
  ".gemini/skills", // Gemini CLI (Google) compat
  ".opencode/skills", // OpenCode compat
  ".agents/skills", // Native — cross-agent standard, authoritative (highest priority)
];

/** Options for skill discovery */
export interface DiscoveryOptions {
  /** Override for global skills directory (legacy; use globalDirs) */
  globalDir?: string;
  /** Override for global skills directories */
  globalDirs?: string[];
  /** Override for project skills directory (legacy; use projectDirs) */
  projectDir?: string;
  /** Override for project skills directories */
  projectDirs?: string[];
}

/** Resolved skill discovery directories, in ascending priority order. */
export interface ResolvedDiscoveryDirs {
  globalDirs: string[];
  projectDirs: string[];
}

/** Backward compatible options parser. */
function parseDiscoveryOptions(options?: DiscoveryOptions | string): DiscoveryOptions {
  // Backward compat: accept a plain string as globalDir override
  return typeof options === "string" ? { globalDir: options } : (options ?? {});
}

/** Expand "~" in user-provided paths and remove duplicate/empty entries. */
function normalizeDirectories(dirs: string[], relativeBaseDir?: string): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  const home = homedir();

  for (const dir of dirs) {
    const trimmed = dir.trim();
    if (!trimmed) continue;

    const expanded =
      trimmed === "~"
        ? home
        : trimmed.startsWith("~/")
          ? path.join(home, trimmed.slice(2))
          : trimmed;
    const resolved = path.isAbsolute(expanded)
      ? path.resolve(expanded)
      : path.resolve(relativeBaseDir ?? process.cwd(), expanded);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    normalized.push(resolved);
  }

  return normalized;
}

/** Resolve global and project discovery directories from options and defaults. */
export function resolveDiscoveryDirs(
  projectPath: string,
  options?: DiscoveryOptions | string,
): ResolvedDiscoveryDirs {
  const opts = parseDiscoveryOptions(options);

  const globalDirs = normalizeDirectories(
    opts.globalDirs && opts.globalDirs.length > 0
      ? opts.globalDirs
      : opts.globalDir
        ? [opts.globalDir]
        : GLOBAL_SKILLS_DIRS,
  );

  const projectDirs = normalizeDirectories(
    opts.projectDirs && opts.projectDirs.length > 0
      ? opts.projectDirs
      : opts.projectDir
        ? [opts.projectDir]
        : PROJECT_SKILLS_DIRNAMES.map((d) => path.join(projectPath, d)),
    projectPath,
  );

  return { globalDirs, projectDirs };
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
  const allSkills = new Map<string, SkillMetadata>();
  const { globalDirs, projectDirs } = resolveDiscoveryDirs(projectPath, options);

  // 1. Register builtin skills (lowest priority)
  for (const skill of builtinSkills) {
    const meta = nativeSkillToMetadata(skill, "builtin");
    allSkills.set(meta.id, meta);
  }

  // 2. Scan global skills directories (ascending priority)
  for (const dir of globalDirs) {
    const globalSkills = await scanSkillsDirectory(dir, "global");
    for (const meta of globalSkills) {
      applyWithPriority(allSkills, meta);
    }
  }

  // 3. Scan project skills directories (ascending priority, highest overall)
  // Scans in ascending priority: .claude/ < .codex/ < .gemini/ < .opencode/ < .agents/
  // .agents/skills/ is the native dir and always wins for the same skill ID
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

/**
 * Apply a skill to the map, respecting scope priority.
 *
 * Uses >= so that within the same scope, later-scanned directories override
 * earlier ones. PROJECT_SKILLS_DIRNAMES is ordered ascending by priority, so
 * the last directory scanned (.agents/skills/) wins over the first (.claude/skills/).
 */
function applyWithPriority(map: Map<string, SkillMetadata>, meta: SkillMetadata): void {
  const existing = map.get(meta.id);
  if (!existing || SCOPE_PRIORITY[meta.scope] >= SCOPE_PRIORITY[existing.scope]) {
    map.set(meta.id, meta);
  }
}
