/**
 * Centralized configuration paths
 *
 * All Coco configuration is stored in ~/.coco/
 * This module provides consistent paths for all configuration files.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Base directory for all Coco configuration
 * ~/.coco/
 */
export const COCO_HOME = join(homedir(), ".coco");

/**
 * Configuration paths
 */
export const CONFIG_PATHS = {
  /** Base directory: ~/.coco/ */
  home: COCO_HOME,

  /** Main config file: ~/.coco/config.json (provider/model preferences) */
  config: join(COCO_HOME, "config.json"),

  /** Environment variables: ~/.coco/.env (API keys) */
  env: join(COCO_HOME, ".env"),

  /** Project trust settings: ~/.coco/projects.json */
  projects: join(COCO_HOME, "projects.json"),

  /** Trusted tools per project: ~/.coco/trusted-tools.json */
  trustedTools: join(COCO_HOME, "trusted-tools.json"),

  /** OAuth tokens directory: ~/.coco/tokens/ (e.g., openai.json) */
  tokens: join(COCO_HOME, "tokens"),

  /** Session history: ~/.coco/sessions/ */
  sessions: join(COCO_HOME, "sessions"),

  /** Logs directory: ~/.coco/logs/ */
  logs: join(COCO_HOME, "logs"),

  /** User-level memory file: ~/.coco/COCO.md */
  memory: join(COCO_HOME, "COCO.md"),
} as const;

/**
 * Get all paths as an object (for debugging/display)
 */
export function getAllPaths(): Record<string, string> {
  return { ...CONFIG_PATHS };
}

/**
 * Legacy path mappings (for migration)
 */
export const LEGACY_PATHS = {
  /** Old config location */
  oldConfig: join(homedir(), ".config", "corbat-coco"),
} as const;
