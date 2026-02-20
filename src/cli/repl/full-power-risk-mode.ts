/**
 * Full-Power-Risk Mode
 *
 * An opt-in mode for autonomous development where the agent can perform
 * git operations, installs, docker commands, etc. without asking for each one.
 *
 * NEVER auto-approves truly destructive commands (FULL_POWER_BLOCKED).
 *
 * Toggle with /full-power-risk [on|off|status]
 */

import fs from "node:fs/promises";
import { CONFIG_PATHS } from "../../config/paths.js";

let fullPowerRiskEnabled = false;

/**
 * Patterns that are ALWAYS blocked, even in full-power-risk mode.
 * These cover supply-chain injection, filesystem destruction, and kernel tricks.
 */
export const FULL_POWER_BLOCKED: RegExp[] = [
  // Filesystem destruction — root or home
  /\brm\s+-rf\s+\/(?!\w)/, // rm -rf /
  /\bsudo\s+rm\s+-rf/, // sudo rm -rf anything
  /\bdd\s+if=.*of=\/dev\//, // dd to device
  /\bmkfs\./, // format filesystem partition
  // Supply-chain injection
  /\bcurl\s+.*\|\s*(ba)?sh/, // curl | sh
  /\bwget\s+.*\|\s*(ba)?sh/, // wget | sh
  // Code injection primitives
  /`[^`]*`/, // backtick substitution
  /\beval\s+/, // eval
  // Excessive permissions
  /\bchmod\s+777/, // world-writable
  /\bchown\s+root/, // chown to root
  // Write to sensitive system paths
  />\s*\/etc\//, // overwrite /etc/ files
  />\s*\/root\//, // overwrite /root/ files
  // Fork bomb / kernel tricks
  /:\s*\(\s*\)\s*\{/, // :(){ :|:& };: fork bomb pattern
];

/**
 * Returns true if full-power-risk mode is currently enabled.
 */
export function isFullPowerRiskMode(): boolean {
  return fullPowerRiskEnabled;
}

/**
 * Enable or disable full-power-risk mode.
 */
export function setFullPowerRiskMode(enabled: boolean): void {
  fullPowerRiskEnabled = enabled;
}

/**
 * Toggle full-power-risk mode and return the new state.
 */
export function toggleFullPowerRiskMode(): boolean {
  fullPowerRiskEnabled = !fullPowerRiskEnabled;
  return fullPowerRiskEnabled;
}

/**
 * Returns true if the command is absolutely blocked even in full-power-risk mode.
 */
export function isFullPowerBlocked(command: string): boolean {
  return FULL_POWER_BLOCKED.some((pattern) => pattern.test(command));
}

/**
 * In full-power-risk mode, return true if the command should be auto-approved.
 * A command is auto-approved when:
 *   1. full-power-risk mode is enabled
 *   2. it is NOT in FULL_POWER_BLOCKED
 */
export function shouldFullPowerApprove(command: string): boolean {
  if (!fullPowerRiskEnabled) return false;
  return !isFullPowerBlocked(command);
}

/**
 * Load persisted full-power-risk preference from config.
 */
export async function loadFullPowerRiskPreference(): Promise<boolean> {
  try {
    const content = await fs.readFile(CONFIG_PATHS.config, "utf-8");
    const config = JSON.parse(content) as Record<string, unknown>;
    if (typeof config.fullPowerRiskMode === "boolean") {
      fullPowerRiskEnabled = config.fullPowerRiskMode;
      return config.fullPowerRiskMode;
    }
  } catch {
    // No config or parse error — default is off
  }
  return false;
}

/**
 * Persist full-power-risk mode preference to config.
 */
export async function saveFullPowerRiskPreference(enabled: boolean): Promise<void> {
  try {
    let config: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(CONFIG_PATHS.config, "utf-8");
      config = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // File doesn't exist yet
    }
    config.fullPowerRiskMode = enabled;
    await fs.writeFile(CONFIG_PATHS.config, JSON.stringify(config, null, 2) + "\n");
  } catch {
    // Silently fail — preference is not critical
  }
}
