/**
 * Allowed Paths Store
 *
 * Manages additional directories that the user has explicitly authorized
 * for file operations beyond the project root (process.cwd()).
 *
 * Security invariants preserved:
 * - System paths (/etc, /var, etc.) are NEVER allowed
 * - Sensitive file patterns (.env, .pem, etc.) still require confirmation
 * - Null byte injection is still blocked
 * - Symlink validation is still active
 * - Each path must be explicitly authorized by the user
 */

import path from "node:path";
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
  return [...sessionAllowedPaths];
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
export function addAllowedPathToSession(dirPath: string, level: "read" | "write"): void {
  const absolute = path.resolve(dirPath);

  // Don't add duplicates
  if (sessionAllowedPaths.some((e) => path.normalize(e.path) === path.normalize(absolute))) {
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
}

// --- Persistence ---

/**
 * Load persisted allowed paths for a project into the session
 */
export async function loadAllowedPaths(projectPath: string): Promise<void> {
  currentProjectPath = path.resolve(projectPath);
  const store = await loadStore();
  const entries = store.projects[currentProjectPath] ?? [];

  // Merge persisted paths into session (avoid duplicates)
  for (const entry of entries) {
    addAllowedPathToSession(entry.path, entry.level);
  }
}

/**
 * Persist an allowed path for the current project
 */
export async function persistAllowedPath(dirPath: string, level: "read" | "write"): Promise<void> {
  if (!currentProjectPath) return;

  const absolute = path.resolve(dirPath);
  const store = await loadStore();

  if (!store.projects[currentProjectPath]) {
    store.projects[currentProjectPath] = [];
  }

  const entries = store.projects[currentProjectPath]!;
  const normalized = path.normalize(absolute);

  // Don't add duplicates
  if (entries.some((e) => path.normalize(e.path) === normalized)) {
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
