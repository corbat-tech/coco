/**
 * Configuration module for Corbat-Coco
 */

export {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  configExists,
  getConfigValue,
  setConfigValue,
  mergeWithDefaults,
} from "./loader.js";

export { findConfigPath } from "./loader.js";
export type { CocoConfig, ProviderConfig, QualityConfig, PersistenceConfig } from "./schema.js";

// Config watcher for hot reload
export {
  ConfigWatcher,
  createConfigWatcher,
  watchConfig,
  type ConfigWatcherOptions,
  type ConfigWatcherEvents,
} from "./watcher.js";

// Config diff utility
export {
  diffConfigs,
  formatDiff,
  hasBreakingChanges,
  type DiffEntry,
  type DiffResult,
  type DiffOptions,
  type DiffOperation,
} from "./diff.js";

// Schema documentation generator
export {
  generateSchemaDocs,
  generateDocs,
  formatDocsAsMarkdown,
  formatDocsAsPlainText,
  type FieldDoc,
  type SchemaDoc,
  type DocOptions,
} from "./docs.js";

// Config migrations
export {
  MigrationRegistry,
  getMigrationRegistry,
  createMigrationRegistry,
  defineMigration,
  parseVersion,
  compareVersions,
  isVersionLessThan,
  extractConfigVersion,
  setConfigVersion,
  autoMigrate,
  configVersionSchema,
  type ConfigVersion,
  type Migration,
  type MigrationFn,
  type MigrationResult,
} from "./migrations.js";
