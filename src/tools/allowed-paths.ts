/**
 * Allowed Paths Store
 *
 * Manages additional directories that the user has explicitly authorized
 * for file operations beyond the project root (process.cwd()).
 *
 * Stores canonical destinations authorized by the user. The synchronous
 * membership helper is only a lexical lookup; file operations must also use
 * the canonical path policy before performing an effect.
 */

import path from "node:path";
import { realpathSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import { CONFIG_PATHS } from "../config/paths.js";

/**
 * Persisted allowed paths per project
 */
interface AllowedPathsStore {
  version: number;
  /** Map of project path -> array of allowed extra paths */
  projects: Record<string, AllowedPathEntry[]>;
}

export interface AllowedPathEntry {
  /** Absolute path to the allowed directory */
  path: string;
  /** When it was authorized */
  authorizedAt: string;
  /** Permission level */
  level: "read" | "write";
}

const STORE_FILE = path.join(CONFIG_PATHS.home, "allowed-paths.json");

const DEFAULT_STORE: AllowedPathsStore = {
  version: 1,
  projects: {},
};

/**
 * Runtime allowed paths for the current session.
 * This is the source of truth checked by isPathAllowed().
 */
let sessionAllowedPaths: AllowedPathEntry[] = [];

/**
 * Current project path (set during initialization)
 */
let currentProjectPath: string = "";

/**
 * Get current session allowed paths (for display/commands)
 */
export function getAllowedPaths(): AllowedPathEntry[] {
  return sessionAllowedPaths.map((entry) => ({ ...entry }));
}

/**
 * Check if a given absolute path falls within any allowed path
 */
export function isWithinAllowedPath(
  absolutePath: string,
  operation: "read" | "write" | "delete",
): boolean {
  const normalizedTarget = path.normalize(absolutePath);

  for (const entry of sessionAllowedPaths) {
    const normalizedAllowed = path.normalize(entry.path);

    // Check if target is within the allowed directory
    if (
      normalizedTarget === normalizedAllowed ||
      normalizedTarget.startsWith(normalizedAllowed + path.sep)
    ) {
      // For write/delete operations, check that the entry allows writes
      if (operation === "read") return true;
      if (entry.level === "write") return true;
    }
  }

  return false;
}

/**
 * Add an allowed path to the current session
 */
export function addAllowedPathToSession(
  dirPath: string,
  level: "read" | "write",
  expectedDestination?: string,
): void {
  const absolute = canonicalizeAllowedDirectory(dirPath, expectedDestination);
  addCanonicalGrant(absolute, level);
}

function addCanonicalGrant(absolute: string, level: "read" | "write"): void {
  const existing = sessionAllowedPaths.find((e) => e.path === absolute);
  if (existing) {
    if (level === "write") existing.level = "write";
    return;
  }

  sessionAllowedPaths.push({
    path: absolute,
    authorizedAt: new Date().toISOString(),
    level,
  });
}

/**
 * Remove an allowed path from the current session
 */
export function removeAllowedPathFromSession(dirPath: string): boolean {
  const absolute = path.resolve(dirPath);
  const normalized = path.normalize(absolute);
  const before = sessionAllowedPaths.length;
  sessionAllowedPaths = sessionAllowedPaths.filter((e) => path.normalize(e.path) !== normalized);
  return sessionAllowedPaths.length < before;
}

/**
 * Clear all session allowed paths
 */
export function clearSessionAllowedPaths(): void {
  sessionAllowedPaths = [];
  currentProjectPath = "";
}

/** Resolve before displaying a grant prompt, then retain this exact destination. */
export function canonicalizeAllowedDirectory(
  dirPath: string,
  expectedDestination?: string,
): string {
  const canonical = realpathSync(path.resolve(dirPath));
  if (expectedDestination !== undefined && canonical !== expectedDestination) {
    throw new Error("Directory destination changed after confirmation; authorize it again.");
  }
  if (!statSync(canonical).isDirectory()) throw new Error(`Not a directory: ${dirPath}`);
  return canonical;
}

// --- Persistence ---

/**
 * Load persisted allowed paths for a project into the session
 */
export async function loadAllowedPaths(projectPath: string): Promise<void> {
  const project = path.resolve(projectPath);
  if (currentProjectPath !== project) sessionAllowedPaths = [];
  currentProjectPath = project;
  const store = await loadStore();
  if (currentProjectPath !== project) return;
  const entries = store.projects[project] ?? [];

  // Merge persisted paths into session (avoid duplicates)
  for (const entry of entries) {
    if (!entry || typeof entry.path !== "string" || !["read", "write"].includes(entry.level))
      continue;
    try {
      // Old aliases have no recorded destination. Require reauthorization instead
      // of turning a retargeted link into a new grant when loading preferences.
      const canonical = canonicalizeAllowedDirectory(entry.path);
      if (canonical !== path.resolve(entry.path)) continue;
      addCanonicalGrant(canonical, entry.level);
    } catch {
      // Missing/inaccessible stored directories grant no authority.
    }
  }
}

/**
 * Persist an allowed path for the current project
 */
export async function persistAllowedPath(
  dirPath: string,
  level: "read" | "write",
  expectedDestination?: string,
): Promise<void> {
  const project = currentProjectPath;
  if (!project) return;

  const absolute = canonicalizeAllowedDirectory(dirPath, expectedDestination);
  const store = await loadStore();

  if (!store.projects[project]) {
    store.projects[project] = [];
  }

  const entries = store.projects[project]!;
  const normalized = path.normalize(absolute);

  // Don't add duplicates
  const existing = entries.find((e) => path.normalize(e.path) === normalized);
  if (existing) {
    if (existing.level === "read" && level === "write") {
      existing.level = "write";
      existing.authorizedAt = new Date().toISOString();
      await saveStore(store);
    }
    return;
  }

  entries.push({
    path: absolute,
    authorizedAt: new Date().toISOString(),
    level,
  });

  await saveStore(store);
}

/**
 * Remove a persisted allowed path
 */
export async function removePersistedAllowedPath(dirPath: string): Promise<boolean> {
  if (!currentProjectPath) return false;

  const absolute = path.resolve(dirPath);
  const normalized = path.normalize(absolute);
  const store = await loadStore();
  const entries = store.projects[currentProjectPath];

  if (!entries) return false;

  const before = entries.length;
  store.projects[currentProjectPath] = entries.filter((e) => path.normalize(e.path) !== normalized);

  if (store.projects[currentProjectPath]!.length < before) {
    await saveStore(store);
    return true;
  }

  return false;
}

// --- Internal ---

async function loadStore(): Promise<AllowedPathsStore> {
  try {
    const content = await fs.readFile(STORE_FILE, "utf-8");
    return { ...DEFAULT_STORE, ...JSON.parse(content) };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

async function saveStore(store: AllowedPathsStore): Promise<void> {
  try {
    await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
    await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    // Silently fail
  }
}
