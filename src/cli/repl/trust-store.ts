/**
 * Project Trust Store
 *
 * Manages project trust permissions with persistence.
 */

import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_PATHS } from "../../config/paths.js";

/**
 * Trust approval levels
 */
export type TrustLevel = "read" | "write" | "full";

/**
 * Project trust information
 */
export interface ProjectTrust {
  /** Absolute path to project */
  path: string;
  /** When approval was granted */
  approvedAt: string;
  /** Approval level */
  approvalLevel: TrustLevel;
  /** Trusted tools for this project */
  toolsTrusted: string[];
  /** Last access timestamp */
  lastAccessed: string;
}

/**
 * Trust store configuration
 */
export interface TrustStoreConfig {
  /** Store version */
  version: number;
  /** Trusted projects by path */
  projects: Record<string, ProjectTrust>;
  /** Global settings */
  globalSettings: {
    /** Auto-approve read-only access */
    autoApproveReadOnly: boolean;
    /** Default approval level */
    defaultApprovalLevel: TrustLevel;
  };
}

/**
 * Default trust store
 */
const DEFAULT_TRUST_STORE: TrustStoreConfig = {
  version: 1,
  projects: {},
  globalSettings: {
    autoApproveReadOnly: false,
    defaultApprovalLevel: "write",
  },
};

/**
 * Trust store file path
 */
export const TRUST_STORE_PATH = CONFIG_PATHS.projects;

/**
 * Ensure directory exists
 */
async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

/**
 * Load trust store from disk
 */
export async function loadTrustStore(
  storePath: string = TRUST_STORE_PATH,
): Promise<TrustStoreConfig> {
  try {
    await access(storePath);
    const content = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(content) as TrustStoreConfig;

    // Validate and merge with defaults
    return {
      ...DEFAULT_TRUST_STORE,
      ...parsed,
      globalSettings: {
        ...DEFAULT_TRUST_STORE.globalSettings,
        ...parsed.globalSettings,
      },
    };
  } catch {
    return { ...DEFAULT_TRUST_STORE };
  }
}

/**
 * Save trust store to disk
 */
export async function saveTrustStore(
  store: TrustStoreConfig,
  storePath: string = TRUST_STORE_PATH,
): Promise<void> {
  await ensureDir(storePath);
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf-8");
}

/**
 * Check if project is trusted
 */
export function isProjectTrusted(store: TrustStoreConfig, projectPath: string): boolean {
  const normalizedPath = normalizePath(projectPath);
  const trust = store.projects[normalizedPath];

  if (!trust) return false;

  // Check if approval level is valid
  return ["read", "write", "full"].includes(trust.approvalLevel);
}

/**
 * Get project trust level
 */
export function getProjectTrustLevel(
  store: TrustStoreConfig,
  projectPath: string,
): TrustLevel | null {
  const normalizedPath = normalizePath(projectPath);
  const trust = store.projects[normalizedPath];

  return trust?.approvalLevel ?? null;
}

/**
 * Add or update project trust
 */
export async function addProjectTrust(
  store: TrustStoreConfig,
  projectPath: string,
  level: TrustLevel,
  tools: string[] = [],
  storePath: string = TRUST_STORE_PATH,
): Promise<void> {
  const normalizedPath = normalizePath(projectPath);
  const now = new Date().toISOString();

  store.projects[normalizedPath] = {
    path: normalizedPath,
    approvedAt: store.projects[normalizedPath]?.approvedAt ?? now,
    approvalLevel: level,
    toolsTrusted: tools,
    lastAccessed: now,
  };

  await saveTrustStore(store, storePath);
}

/**
 * Remove project trust
 */
export async function removeProjectTrust(
  store: TrustStoreConfig,
  projectPath: string,
  storePath: string = TRUST_STORE_PATH,
): Promise<boolean> {
  const normalizedPath = normalizePath(projectPath);

  if (!(normalizedPath in store.projects)) {
    return false;
  }

  delete store.projects[normalizedPath];
  await saveTrustStore(store, storePath);
  return true;
}

/**
 * Update last accessed timestamp
 */
export async function updateLastAccessed(
  store: TrustStoreConfig,
  projectPath: string,
  storePath: string = TRUST_STORE_PATH,
): Promise<void> {
  const normalizedPath = normalizePath(projectPath);
  const trust = store.projects[normalizedPath];

  if (trust) {
    trust.lastAccessed = new Date().toISOString();
    await saveTrustStore(store, storePath);
  }
}

/**
 * List all trusted projects
 */
export function listTrustedProjects(store: TrustStoreConfig): ProjectTrust[] {
  return Object.values(store.projects).sort(
    (a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime(),
  );
}

/**
 * Check if trust level allows operation
 */
export function canPerformOperation(
  store: TrustStoreConfig,
  projectPath: string,
  operation: "read" | "write" | "execute",
): boolean {
  const level = getProjectTrustLevel(store, projectPath);

  if (!level) return false;

  const permissions: Record<TrustLevel, string[]> = {
    read: ["read"],
    write: ["read", "write"],
    full: ["read", "write", "execute"],
  };

  return permissions[level]?.includes(operation) ?? false;
}

/**
 * Normalize path for consistent storage
 */
function normalizePath(path: string): string {
  // Resolve to absolute path
  return join(path);
}

/**
 * Create trust store manager
 */
export function createTrustStore(storePath: string = TRUST_STORE_PATH) {
  let store: TrustStoreConfig | null = null;

  return {
    /**
     * Initialize store
     */
    async init(): Promise<void> {
      store = await loadTrustStore(storePath);
    },

    /**
     * Check if project is trusted
     */
    isTrusted(projectPath: string): boolean {
      if (!store) throw new Error("Trust store not initialized");
      return isProjectTrusted(store, projectPath);
    },

    /**
     * Get trust level
     */
    getLevel(projectPath: string): TrustLevel | null {
      if (!store) throw new Error("Trust store not initialized");
      return getProjectTrustLevel(store, projectPath);
    },

    /**
     * Add trust
     */
    async addTrust(projectPath: string, level: TrustLevel, tools?: string[]): Promise<void> {
      if (!store) throw new Error("Trust store not initialized");
      await addProjectTrust(store, projectPath, level, tools, storePath);
    },

    /**
     * Remove trust
     */
    async removeTrust(projectPath: string): Promise<boolean> {
      if (!store) throw new Error("Trust store not initialized");
      return removeProjectTrust(store, projectPath, storePath);
    },

    /**
     * Update last accessed
     */
    async touch(projectPath: string): Promise<void> {
      if (!store) throw new Error("Trust store not initialized");
      await updateLastAccessed(store, projectPath, storePath);
    },

    /**
     * List trusted projects
     */
    list(): ProjectTrust[] {
      if (!store) throw new Error("Trust store not initialized");
      return listTrustedProjects(store);
    },

    /**
     * Check operation permission
     */
    can(projectPath: string, operation: "read" | "write" | "execute"): boolean {
      if (!store) throw new Error("Trust store not initialized");
      return canPerformOperation(store, projectPath, operation);
    },

    /**
     * Get global settings
     */
    getSettings(): TrustStoreConfig["globalSettings"] {
      if (!store) throw new Error("Trust store not initialized");
      return { ...store.globalSettings };
    },

    /**
     * Update global settings
     */
    async updateSettings(settings: Partial<TrustStoreConfig["globalSettings"]>): Promise<void> {
      if (!store) throw new Error("Trust store not initialized");
      store.globalSettings = { ...store.globalSettings, ...settings };
      await saveTrustStore(store, storePath);
    },
  };
}

export type TrustStore = ReturnType<typeof createTrustStore>;
