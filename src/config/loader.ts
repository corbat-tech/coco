/**
 * Configuration loader for Corbat-Coco
 */

import fs from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";
import {
  CocoConfigSchema,
  createDefaultConfigObject,
  type CocoConfig,
} from "./schema.js";
import { ConfigError } from "../utils/errors.js";

/**
 * Load configuration from file
 */
export async function loadConfig(configPath?: string): Promise<CocoConfig> {
  const resolvedPath = configPath || findConfigPathSync();

  try {
    const content = await fs.readFile(resolvedPath, "utf-8");
    const parsed = JSON5.parse(content);

    const result = CocoConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      throw new ConfigError("Invalid configuration", {
        issues,
        configPath: resolvedPath,
      });
    }

    return result.data;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Config file doesn't exist, return defaults
      return createDefaultConfig("my-project");
    }
    throw new ConfigError("Failed to load configuration", {
      configPath: resolvedPath,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Save configuration to file
 */
export async function saveConfig(
  config: CocoConfig,
  configPath?: string
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
      configPath: configPath || findConfigPathSync(),
    });
  }

  const resolvedPath = configPath || findConfigPathSync();
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
  language: "typescript" | "python" | "go" | "rust" | "java" = "typescript"
): CocoConfig {
  return createDefaultConfigObject(projectName, language);
}

/**
 * Find the configuration file path
 */
export async function findConfigPath(cwd?: string): Promise<string | undefined> {
  // Check environment variable
  const envPath = process.env["COCO_CONFIG_PATH"];
  if (envPath) {
    try {
      await fs.access(envPath);
      return envPath;
    } catch {
      // Continue to look for default
    }
  }

  // Check in provided directory
  const basePath = cwd || process.cwd();
  const configPath = path.join(basePath, ".coco", "config.json");

  try {
    await fs.access(configPath);
    return configPath;
  } catch {
    return undefined;
  }
}

/**
 * Find the configuration file path (sync, for internal use)
 */
function findConfigPathSync(): string {
  // Check environment variable
  const envPath = process.env["COCO_CONFIG_PATH"];
  if (envPath) {
    return envPath;
  }

  // Default to current directory
  return path.join(process.cwd(), ".coco", "config.json");
}

/**
 * Check if configuration exists
 */
export async function configExists(configPath?: string): Promise<boolean> {
  const resolvedPath = configPath || findConfigPathSync();
  try {
    await fs.access(resolvedPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a specific configuration value by path
 */
export function getConfigValue<T>(
  config: CocoConfig,
  path: string
): T | undefined {
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
export function setConfigValue<T>(
  config: CocoConfig,
  configPath: string,
  value: T
): CocoConfig {
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
export function mergeWithDefaults(
  partial: Partial<CocoConfig>,
  projectName: string
): CocoConfig {
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
