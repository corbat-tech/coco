/**
 * Config migrations for Corbat-Coco
 * Handles schema versioning and automatic migrations
 */

import { z } from "zod";

/**
 * Config version type
 */
export type ConfigVersion = `${number}.${number}.${number}`;

/**
 * Migration function type
 */
export type MigrationFn = (config: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migration definition
 */
export interface Migration {
  /** Version this migration upgrades FROM */
  fromVersion: ConfigVersion;
  /** Version this migration upgrades TO */
  toVersion: ConfigVersion;
  /** Description of what this migration does */
  description: string;
  /** Migration function */
  migrate: MigrationFn;
  /** Optional rollback function */
  rollback?: MigrationFn;
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  fromVersion: ConfigVersion;
  toVersion: ConfigVersion;
  migrationsApplied: string[];
  warnings: string[];
  config: Record<string, unknown>;
  error?: string;
}

/**
 * Parse version string
 */
export function parseVersion(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match || match.length < 4) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return [
    parseInt(match[1] as string, 10),
    parseInt(match[2] as string, 10),
    parseInt(match[3] as string, 10),
  ];
}

/**
 * Compare two versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: ConfigVersion, b: ConfigVersion): number {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

/**
 * Check if version a is less than version b
 */
export function isVersionLessThan(a: ConfigVersion, b: ConfigVersion): boolean {
  return compareVersions(a, b) < 0;
}

/**
 * Config version schema
 */
export const configVersionSchema = z.string().regex(
  /^\d+\.\d+\.\d+$/,
  "Version must be in semver format (e.g., 1.0.0)"
) as z.ZodType<ConfigVersion>;

/**
 * Migration registry
 */
export class MigrationRegistry {
  private migrations: Migration[] = [];

  /**
   * Register a migration
   */
  register(migration: Migration): void {
    // Validate versions
    parseVersion(migration.fromVersion);
    parseVersion(migration.toVersion);

    // Check that toVersion > fromVersion
    if (compareVersions(migration.fromVersion, migration.toVersion) >= 0) {
      throw new Error(
        `Migration toVersion (${migration.toVersion}) must be greater than fromVersion (${migration.fromVersion})`
      );
    }

    this.migrations.push(migration);
    // Keep migrations sorted by fromVersion
    this.migrations.sort((a, b) => compareVersions(a.fromVersion, b.fromVersion));
  }

  /**
   * Get all registered migrations
   */
  getAll(): readonly Migration[] {
    return this.migrations;
  }

  /**
   * Find migrations needed to go from one version to another
   */
  findMigrationPath(fromVersion: ConfigVersion, toVersion: ConfigVersion): Migration[] {
    if (compareVersions(fromVersion, toVersion) >= 0) {
      return []; // No migration needed
    }

    const path: Migration[] = [];
    let currentVersion = fromVersion;

    while (compareVersions(currentVersion, toVersion) < 0) {
      // Find migration from current version
      const migration = this.migrations.find(
        m => m.fromVersion === currentVersion
      );

      if (!migration) {
        // Try to find a migration that can handle this version
        const compatibleMigration = this.migrations.find(
          m =>
            compareVersions(m.fromVersion, currentVersion) <= 0 &&
            compareVersions(m.toVersion, currentVersion) > 0
        );

        if (!compatibleMigration) {
          throw new Error(
            `No migration path found from ${currentVersion} to ${toVersion}`
          );
        }

        path.push(compatibleMigration);
        currentVersion = compatibleMigration.toVersion;
      } else {
        path.push(migration);
        currentVersion = migration.toVersion;
      }

      // Safety check to prevent infinite loops
      if (path.length > 100) {
        throw new Error("Migration path too long, possible circular dependency");
      }
    }

    return path;
  }

  /**
   * Apply migrations to a config
   */
  migrate(
    config: Record<string, unknown>,
    fromVersion: ConfigVersion,
    toVersion: ConfigVersion
  ): MigrationResult {
    const result: MigrationResult = {
      success: false,
      fromVersion,
      toVersion,
      migrationsApplied: [],
      warnings: [],
      config: { ...config },
    };

    try {
      const path = this.findMigrationPath(fromVersion, toVersion);

      if (path.length === 0) {
        result.success = true;
        return result;
      }

      let currentConfig = { ...config };

      for (const migration of path) {
        try {
          currentConfig = migration.migrate(currentConfig);
          result.migrationsApplied.push(
            `${migration.fromVersion} -> ${migration.toVersion}: ${migration.description}`
          );
        } catch (error) {
          result.error = `Migration ${migration.fromVersion} -> ${migration.toVersion} failed: ${
            error instanceof Error ? error.message : String(error)
          }`;
          return result;
        }
      }

      result.config = currentConfig;
      result.success = true;
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Rollback migrations
   */
  rollback(
    config: Record<string, unknown>,
    fromVersion: ConfigVersion,
    toVersion: ConfigVersion
  ): MigrationResult {
    const result: MigrationResult = {
      success: false,
      fromVersion,
      toVersion,
      migrationsApplied: [],
      warnings: [],
      config: { ...config },
    };

    try {
      // Find reverse path
      const forwardPath = this.findMigrationPath(toVersion, fromVersion);

      if (forwardPath.length === 0) {
        result.success = true;
        return result;
      }

      // Check all migrations have rollback
      const migrationsWithoutRollback = forwardPath.filter(m => !m.rollback);
      if (migrationsWithoutRollback.length > 0) {
        result.error = `Cannot rollback: migrations without rollback function: ${
          migrationsWithoutRollback.map(m => `${m.fromVersion}->${m.toVersion}`).join(", ")
        }`;
        return result;
      }

      let currentConfig = { ...config };

      // Apply rollbacks in reverse order
      for (const migration of forwardPath.reverse()) {
        try {
          currentConfig = migration.rollback!(currentConfig);
          result.migrationsApplied.push(
            `${migration.toVersion} -> ${migration.fromVersion}: rollback ${migration.description}`
          );
        } catch (error) {
          result.error = `Rollback ${migration.toVersion} -> ${migration.fromVersion} failed: ${
            error instanceof Error ? error.message : String(error)
          }`;
          return result;
        }
      }

      result.config = currentConfig;
      result.success = true;
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Clear all migrations
   */
  clear(): void {
    this.migrations = [];
  }
}

/**
 * Global migration registry
 */
let globalRegistry: MigrationRegistry | null = null;

/**
 * Get the global migration registry
 */
export function getMigrationRegistry(): MigrationRegistry {
  if (!globalRegistry) {
    globalRegistry = new MigrationRegistry();
  }
  return globalRegistry;
}

/**
 * Create a new migration registry
 */
export function createMigrationRegistry(): MigrationRegistry {
  return new MigrationRegistry();
}

/**
 * Helper to define a migration
 */
export function defineMigration(migration: Migration): Migration {
  return migration;
}

/**
 * Extract version from config object
 */
export function extractConfigVersion(config: Record<string, unknown>): ConfigVersion | null {
  const version = config.version ?? config._version ?? config.configVersion;
  if (typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version)) {
    return version as ConfigVersion;
  }
  return null;
}

/**
 * Set version in config object
 */
export function setConfigVersion(
  config: Record<string, unknown>,
  version: ConfigVersion
): Record<string, unknown> {
  return {
    ...config,
    version,
  };
}

/**
 * Auto-migrate config to latest version
 */
export function autoMigrate(
  config: Record<string, unknown>,
  latestVersion: ConfigVersion,
  registry?: MigrationRegistry
): MigrationResult {
  const reg = registry ?? getMigrationRegistry();
  const currentVersion = extractConfigVersion(config) ?? ("0.0.0" as ConfigVersion);

  return reg.migrate(config, currentVersion, latestVersion);
}
