/**
 * Tests for config migrations
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MigrationRegistry,
  createMigrationRegistry,
  getMigrationRegistry,
  parseVersion,
  compareVersions,
  isVersionLessThan,
  defineMigration,
  extractConfigVersion,
  setConfigVersion,
  autoMigrate,
  type ConfigVersion,
} from "./migrations.js";

describe("parseVersion", () => {
  it("should parse valid version string", () => {
    const result = parseVersion("1.2.3");
    expect(result).toEqual([1, 2, 3]);
  });

  it("should parse version with zeros", () => {
    const result = parseVersion("0.0.0");
    expect(result).toEqual([0, 0, 0]);
  });

  it("should parse large version numbers", () => {
    const result = parseVersion("100.200.300");
    expect(result).toEqual([100, 200, 300]);
  });

  it("should throw for invalid format", () => {
    expect(() => parseVersion("1.2")).toThrow("Invalid version format");
    expect(() => parseVersion("1")).toThrow("Invalid version format");
    expect(() => parseVersion("1.2.3.4")).toThrow("Invalid version format");
    expect(() => parseVersion("a.b.c")).toThrow("Invalid version format");
    expect(() => parseVersion("")).toThrow("Invalid version format");
  });
});

describe("compareVersions", () => {
  it("should return 0 for equal versions", () => {
    expect(compareVersions("1.0.0" as ConfigVersion, "1.0.0" as ConfigVersion)).toBe(0);
    expect(compareVersions("2.3.4" as ConfigVersion, "2.3.4" as ConfigVersion)).toBe(0);
  });

  it("should return -1 when first version is less", () => {
    expect(compareVersions("1.0.0" as ConfigVersion, "2.0.0" as ConfigVersion)).toBe(-1);
    expect(compareVersions("1.0.0" as ConfigVersion, "1.1.0" as ConfigVersion)).toBe(-1);
    expect(compareVersions("1.0.0" as ConfigVersion, "1.0.1" as ConfigVersion)).toBe(-1);
  });

  it("should return 1 when first version is greater", () => {
    expect(compareVersions("2.0.0" as ConfigVersion, "1.0.0" as ConfigVersion)).toBe(1);
    expect(compareVersions("1.1.0" as ConfigVersion, "1.0.0" as ConfigVersion)).toBe(1);
    expect(compareVersions("1.0.1" as ConfigVersion, "1.0.0" as ConfigVersion)).toBe(1);
  });
});

describe("isVersionLessThan", () => {
  it("should return true when a < b", () => {
    expect(isVersionLessThan("1.0.0" as ConfigVersion, "2.0.0" as ConfigVersion)).toBe(true);
  });

  it("should return false when a >= b", () => {
    expect(isVersionLessThan("2.0.0" as ConfigVersion, "1.0.0" as ConfigVersion)).toBe(false);
    expect(isVersionLessThan("1.0.0" as ConfigVersion, "1.0.0" as ConfigVersion)).toBe(false);
  });
});

describe("MigrationRegistry", () => {
  let registry: MigrationRegistry;

  beforeEach(() => {
    registry = createMigrationRegistry();
  });

  describe("register", () => {
    it("should register a valid migration", () => {
      const migration = defineMigration({
        fromVersion: "1.0.0" as ConfigVersion,
        toVersion: "1.1.0" as ConfigVersion,
        description: "Add new field",
        migrate: (config) => ({ ...config, newField: "value" }),
      });

      registry.register(migration);

      expect(registry.getAll()).toHaveLength(1);
    });

    it("should throw if toVersion <= fromVersion", () => {
      const migration = defineMigration({
        fromVersion: "1.0.0" as ConfigVersion,
        toVersion: "0.9.0" as ConfigVersion,
        description: "Invalid",
        migrate: (config) => config,
      });

      expect(() => registry.register(migration)).toThrow("must be greater than");
    });

    it("should sort migrations by fromVersion", () => {
      registry.register({
        fromVersion: "2.0.0" as ConfigVersion,
        toVersion: "3.0.0" as ConfigVersion,
        description: "Second",
        migrate: (config) => config,
      });

      registry.register({
        fromVersion: "1.0.0" as ConfigVersion,
        toVersion: "2.0.0" as ConfigVersion,
        description: "First",
        migrate: (config) => config,
      });

      const all = registry.getAll();
      expect(all[0].fromVersion).toBe("1.0.0");
      expect(all[1].fromVersion).toBe("2.0.0");
    });
  });

  describe("findMigrationPath", () => {
    beforeEach(() => {
      registry.register({
        fromVersion: "1.0.0" as ConfigVersion,
        toVersion: "1.1.0" as ConfigVersion,
        description: "1.0 to 1.1",
        migrate: (config) => ({ ...config, v11: true }),
      });

      registry.register({
        fromVersion: "1.1.0" as ConfigVersion,
        toVersion: "2.0.0" as ConfigVersion,
        description: "1.1 to 2.0",
        migrate: (config) => ({ ...config, v20: true }),
      });
    });

    it("should find direct migration path", () => {
      const path = registry.findMigrationPath("1.0.0" as ConfigVersion, "1.1.0" as ConfigVersion);

      expect(path).toHaveLength(1);
      expect(path[0].fromVersion).toBe("1.0.0");
    });

    it("should find multi-step migration path", () => {
      const path = registry.findMigrationPath("1.0.0" as ConfigVersion, "2.0.0" as ConfigVersion);

      expect(path).toHaveLength(2);
      expect(path[0].fromVersion).toBe("1.0.0");
      expect(path[1].fromVersion).toBe("1.1.0");
    });

    it("should return empty path for same version", () => {
      const path = registry.findMigrationPath("1.0.0" as ConfigVersion, "1.0.0" as ConfigVersion);

      expect(path).toHaveLength(0);
    });

    it("should throw for impossible migration", () => {
      expect(() => {
        registry.findMigrationPath("1.0.0" as ConfigVersion, "5.0.0" as ConfigVersion);
      }).toThrow("No migration path found");
    });
  });

  describe("migrate", () => {
    beforeEach(() => {
      registry.register({
        fromVersion: "1.0.0" as ConfigVersion,
        toVersion: "1.1.0" as ConfigVersion,
        description: "Add field",
        migrate: (config) => ({ ...config, newField: "added" }),
      });

      registry.register({
        fromVersion: "1.1.0" as ConfigVersion,
        toVersion: "2.0.0" as ConfigVersion,
        description: "Rename field",
        migrate: (config) => {
          const { oldName, ...rest } = config as Record<string, unknown>;
          return { ...rest, renamedField: oldName };
        },
      });
    });

    it("should apply single migration", () => {
      const config = { existingField: "value" };

      const result = registry.migrate(config, "1.0.0" as ConfigVersion, "1.1.0" as ConfigVersion);

      expect(result.success).toBe(true);
      expect(result.config).toEqual({
        existingField: "value",
        newField: "added",
      });
      expect(result.migrationsApplied).toHaveLength(1);
    });

    it("should apply multiple migrations in order", () => {
      const config = { existingField: "value", oldName: "toRename" };

      const result = registry.migrate(config, "1.0.0" as ConfigVersion, "2.0.0" as ConfigVersion);

      expect(result.success).toBe(true);
      expect(result.config).toEqual({
        existingField: "value",
        newField: "added",
        renamedField: "toRename",
      });
      expect(result.migrationsApplied).toHaveLength(2);
    });

    it("should handle migration failure", () => {
      registry.register({
        fromVersion: "2.0.0" as ConfigVersion,
        toVersion: "2.1.0" as ConfigVersion,
        description: "Failing migration",
        migrate: () => {
          throw new Error("Migration failed");
        },
      });

      const result = registry.migrate({}, "2.0.0" as ConfigVersion, "2.1.0" as ConfigVersion);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Migration failed");
    });
  });

  describe("rollback", () => {
    beforeEach(() => {
      registry.register({
        fromVersion: "1.0.0" as ConfigVersion,
        toVersion: "1.1.0" as ConfigVersion,
        description: "Add field",
        migrate: (config) => ({ ...config, newField: "added" }),
        rollback: (config) => {
          const { newField: _newField, ...rest } = config as Record<string, unknown>;
          return rest;
        },
      });
    });

    it("should rollback with rollback function", () => {
      const config = { existingField: "value", newField: "added" };

      const result = registry.rollback(config, "1.1.0" as ConfigVersion, "1.0.0" as ConfigVersion);

      expect(result.success).toBe(true);
      expect(result.config).toEqual({ existingField: "value" });
    });

    it("should fail rollback without rollback function", () => {
      registry.register({
        fromVersion: "1.1.0" as ConfigVersion,
        toVersion: "2.0.0" as ConfigVersion,
        description: "No rollback",
        migrate: (config) => config,
      });

      const result = registry.rollback({}, "2.0.0" as ConfigVersion, "1.1.0" as ConfigVersion);

      expect(result.success).toBe(false);
      expect(result.error).toContain("without rollback function");
    });
  });

  describe("clear", () => {
    it("should remove all migrations", () => {
      registry.register({
        fromVersion: "1.0.0" as ConfigVersion,
        toVersion: "1.1.0" as ConfigVersion,
        description: "Test",
        migrate: (config) => config,
      });

      registry.clear();

      expect(registry.getAll()).toHaveLength(0);
    });
  });
});

describe("extractConfigVersion", () => {
  it("should extract version from config", () => {
    expect(extractConfigVersion({ version: "1.0.0" })).toBe("1.0.0");
    expect(extractConfigVersion({ _version: "2.0.0" })).toBe("2.0.0");
    expect(extractConfigVersion({ configVersion: "3.0.0" })).toBe("3.0.0");
  });

  it("should return null for missing version", () => {
    expect(extractConfigVersion({})).toBe(null);
    expect(extractConfigVersion({ other: "field" })).toBe(null);
  });

  it("should return null for invalid version format", () => {
    expect(extractConfigVersion({ version: "invalid" })).toBe(null);
    expect(extractConfigVersion({ version: 123 })).toBe(null);
  });
});

describe("setConfigVersion", () => {
  it("should set version in config", () => {
    const config = { field: "value" };

    const result = setConfigVersion(config, "1.0.0" as ConfigVersion);

    expect(result).toEqual({
      field: "value",
      version: "1.0.0",
    });
  });

  it("should override existing version", () => {
    const config = { version: "0.0.0" };

    const result = setConfigVersion(config, "1.0.0" as ConfigVersion);

    expect(result.version).toBe("1.0.0");
  });
});

describe("autoMigrate", () => {
  it("should migrate from extracted version to latest", () => {
    const registry = createMigrationRegistry();
    registry.register({
      fromVersion: "0.0.0" as ConfigVersion,
      toVersion: "1.0.0" as ConfigVersion,
      description: "Initial",
      migrate: (config) => ({ ...config, migrated: true }),
    });

    const config = {};
    const result = autoMigrate(config, "1.0.0" as ConfigVersion, registry);

    expect(result.success).toBe(true);
    expect(result.config).toEqual({ migrated: true });
  });

  it("should use version from config if present", () => {
    const registry = createMigrationRegistry();
    registry.register({
      fromVersion: "1.0.0" as ConfigVersion,
      toVersion: "2.0.0" as ConfigVersion,
      description: "Upgrade",
      migrate: (config) => ({ ...config, upgraded: true }),
    });

    const config = { version: "1.0.0" };
    const result = autoMigrate(config, "2.0.0" as ConfigVersion, registry);

    expect(result.success).toBe(true);
    expect(result.config).toEqual({ version: "1.0.0", upgraded: true });
  });
});

describe("getMigrationRegistry", () => {
  it("should return global registry", () => {
    const registry1 = getMigrationRegistry();
    const registry2 = getMigrationRegistry();

    expect(registry1).toBe(registry2);
  });
});
