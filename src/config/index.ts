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
