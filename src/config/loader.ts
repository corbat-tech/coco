/**
 * Configuration loader for Corbat-Coco
 *
 * Supports hierarchical configuration with priority:
 * 1. Project config (<project>/.coco/config.json)
 * 2. Global config (~/.coco/config.json)
 * 3. Environment variables
 * 4. Built-in defaults
 */

import fs from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";
import { CocoConfigSchema, createDefaultConfigObject, type CocoConfig } from "./schema.js";
import { ConfigError } from "../utils/errors.js";
import { CONFIG_PATHS } from "./paths.js";

/**
 * Load configuration from file with hierarchical fallback
 *
 * Priority order:
 * 1. Explicit configPath parameter
 * 2. Project config (<cwd>/.coco/config.json)
 * 3. Global config (~/.coco/config.json)
 * 4. Built-in defaults
 */
export async function loadConfig(configPath?: string): Promise<CocoConfig> {
  // Start with defaults
  let config = createDefaultConfig("my-project");

  // Load global config first (lowest priority)
  const globalConfig = await loadConfigFile(CONFIG_PATHS.config);
  if (globalConfig) {
    config = deepMergeConfig(config, globalConfig);
  }

  // Load project config (higher priority)
  const projectConfigPath = configPath || getProjectConfigPath();
  const projectConfig = await loadConfigFile(projectConfigPath);
  if (projectConfig) {
    config = deepMergeConfig(config, projectConfig);
  }

  return config;
}

/**
 * Load a single config file, returning null if not found
 */
async function loadConfigFile(configPath: string): Promise<Partial<CocoConfig> | null> {
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = JSON5.parse(content);

    // Validate partial config
    const result = CocoConfigSchema.partial().safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      throw new ConfigError("Invalid configuration", {
        issues,
        configPath,
      });
    }

    return result.data;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null; // File doesn't exist
    }
    throw new ConfigError("Failed to load configuration", {
      configPath,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Deep merge configuration objects
 */
function deepMergeConfig(base: CocoConfig, override: Partial<CocoConfig>): CocoConfig {
  return {
    ...base,
    ...override,
    project: { ...base.project, ...override.project },
    provider: { ...base.provider, ...override.provider },
    quality: { ...base.quality, ...override.quality },
    persistence: { ...base.persistence, ...override.persistence },
  };
}

/**
 * Get the project config path (in current directory)
 */
function getProjectConfigPath(): string {
  return path.join(process.cwd(), ".coco", "config.json");
}

/**
 * Save configuration to file
 *
 * @param config - Configuration to save
 * @param configPath - Path to save to (defaults to project config)
 * @param global - If true, saves to global config instead
 */
export async function saveConfig(
  config: CocoConfig,
  configPath?: string,
  global: boolean = false,
): Promise<void> {
  // Validate configuration before saving
  const result = CocoConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new ConfigError("Cannot save invalid configuration", {
      issues,
      configPath: configPath || getProjectConfigPath(),
    });
  }

  // Determine save path
  const resolvedPath = configPath || (global ? CONFIG_PATHS.config : getProjectConfigPath());
  const dir = path.dirname(resolvedPath);

  await fs.mkdir(dir, { recursive: true });

  const content = JSON.stringify(result.data, null, 2);
  await fs.writeFile(resolvedPath, content, "utf-8");
}

/**
 * Create default configuration
 */
export function createDefaultConfig(
  projectName: string,
  language: "typescript" | "python" | "go" | "rust" | "java" = "typescript",
): CocoConfig {
  return createDefaultConfigObject(projectName, language);
}

/**
 * Find the configuration file path
 *
 * Returns the first config file found in priority order:
 * 1. Environment variable COCO_CONFIG_PATH
 * 2. Project config (<cwd>/.coco/config.json)
 * 3. Global config (~/.coco/config.json)
 */
export async function findConfigPath(cwd?: string): Promise<string | undefined> {
  // Check environment variable (highest priority)
  const envPath = process.env["COCO_CONFIG_PATH"];
  if (envPath) {
    try {
      await fs.access(envPath);
      return envPath;
    } catch {
      // Continue to look for default
    }
  }

  // Check project config
  const basePath = cwd || process.cwd();
  const projectConfigPath = path.join(basePath, ".coco", "config.json");

  try {
    await fs.access(projectConfigPath);
    return projectConfigPath;
  } catch {
    // Continue to global
  }

  // Check global config
  try {
    await fs.access(CONFIG_PATHS.config);
    return CONFIG_PATHS.config;
  } catch {
    return undefined;
  }
}

/**
 * Get paths to all config files that exist
 */
export async function findAllConfigPaths(cwd?: string): Promise<{
  global?: string;
  project?: string;
}> {
  const result: { global?: string; project?: string } = {};

  // Check global
  try {
    await fs.access(CONFIG_PATHS.config);
    result.global = CONFIG_PATHS.config;
  } catch {
    // Not found
  }

  // Check project
  const basePath = cwd || process.cwd();
  const projectConfigPath = path.join(basePath, ".coco", "config.json");
  try {
    await fs.access(projectConfigPath);
    result.project = projectConfigPath;
  } catch {
    // Not found
  }

  return result;
}

/**
 * Check if configuration exists
 *
 * @param scope - "project" | "global" | "any" (default: "any")
 */
export async function configExists(
  configPath?: string,
  scope: "project" | "global" | "any" = "any",
): Promise<boolean> {
  if (configPath) {
    try {
      await fs.access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  if (scope === "project" || scope === "any") {
    try {
      await fs.access(getProjectConfigPath());
      return true;
    } catch {
      if (scope === "project") return false;
    }
  }

  if (scope === "global" || scope === "any") {
    try {
      await fs.access(CONFIG_PATHS.config);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Get a specific configuration value by path
 */
export function getConfigValue<T>(config: CocoConfig, path: string): T | undefined {
  const keys = path.split(".");
  let current: unknown = config;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current as T;
}

/**
 * Set a specific configuration value by path
 */
export function setConfigValue<T>(config: CocoConfig, configPath: string, value: T): CocoConfig {
  const keys = configPath.split(".");
  const result = structuredClone(config);
  let current: Record<string, unknown> = result as unknown as Record<string, unknown>;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) continue;
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey) {
    current[lastKey] = value;
  }

  return result;
}

/**
 * Merge configuration with defaults
 */
export function mergeWithDefaults(partial: Partial<CocoConfig>, projectName: string): CocoConfig {
  const defaults = createDefaultConfig(projectName);
  return {
    ...defaults,
    ...partial,
    project: { ...defaults.project, ...partial.project },
    provider: { ...defaults.provider, ...partial.provider },
    quality: { ...defaults.quality, ...partial.quality },
    persistence: { ...defaults.persistence, ...partial.persistence },
  };
}
