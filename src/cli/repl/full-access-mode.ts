/**
 * Full-Access Mode - Auto-approve all commands within project directory
 *
 * When enabled, Coco can execute any command within the project directory
 * without asking for permission, EXCEPT for dangerous commands that are
 * explicitly blacklisted.
 *
 * Toggle with /full-access command.
 */

import chalk from "chalk";
import fs from "node:fs/promises";
import { CONFIG_PATHS } from "../../config/paths.js";

/**
 * Full-access mode state
 */
let fullAccessEnabled = false;

/**
 * Dangerous commands that are NEVER auto-approved, even in full-access mode
 */
const DANGEROUS_COMMANDS = [
  // Destructive filesystem operations
  "rm -rf /",
  "rm -rf /*",
  "rm -rf ~",
  "rm -rf ~/*",
  "rm -rf $HOME",
  "rm -rf .",
  "rm -rf ..",
  "rm -rf ../*",
  "> /dev/sda",
  "dd if=/dev/zero",
  "mkfs",
  "format",

  // System modifications
  "sudo rm",
  "sudo dd",
  "sudo mkfs",
  "sudo format",
  "shutdown",
  "reboot",
  "init 0",
  "init 6",
  "systemctl poweroff",
  "systemctl reboot",

  // Privilege escalation
  "sudo su",
  "su -",
  "sudo -i",

  // Fork bombs and resource exhaustion
  ":(){ :|:& };:",
  "while true; do",
  "for((;;));do",

  // Network attacks
  "nc -e",
  "ncat -e",
  "/bin/bash -i",
  "/bin/sh -i",

  // Package manager dangers
  "npm publish",
  "pnpm publish",
  "yarn publish",
  "pip install --user",
  "gem install",

  // Docker/container escapes
  "docker run --privileged",
  "docker exec --privileged",

  // Git force operations on main/master
  "git push --force origin main",
  "git push --force origin master",
  "git push -f origin main",
  "git push -f origin master",
  "git reset --hard origin",
  "git clean -fdx /",
];

/**
 * Check if full-access mode is enabled
 */
export function isFullAccessMode(): boolean {
  return fullAccessEnabled;
}

/**
 * Set full-access mode state
 */
export function setFullAccessMode(enabled: boolean): void {
  fullAccessEnabled = enabled;
}

/**
 * Toggle full-access mode, returns new state
 */
export function toggleFullAccessMode(): boolean {
  fullAccessEnabled = !fullAccessEnabled;
  return fullAccessEnabled;
}

/**
 * Check if a command is dangerous and should never be auto-approved
 */
export function isDangerousCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();

  // Check against blacklist
  for (const dangerous of DANGEROUS_COMMANDS) {
    if (normalized.includes(dangerous.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a command should be auto-approved in full-access mode
 * Returns true if the command is safe to run without asking
 */
export function shouldAutoApprove(command: string, cwd: string): boolean {
  if (!fullAccessEnabled) {
    return false;
  }

  // Never auto-approve dangerous commands
  if (isDangerousCommand(command)) {
    return false;
  }

  // Command must be operating within the project directory
  // This is enforced by the tool sandbox, but we double-check here
  const isWithinProject = cwd.startsWith(process.cwd());
  if (!isWithinProject) {
    return false;
  }

  return true;
}

/**
 * Load full-access mode preference from config
 */
export async function loadFullAccessPreference(): Promise<boolean> {
  try {
    const content = await fs.readFile(CONFIG_PATHS.config, "utf-8");
    const config = JSON.parse(content);
    if (typeof config.fullAccessMode === "boolean") {
      fullAccessEnabled = config.fullAccessMode;
      return config.fullAccessMode;
    }
  } catch {
    // No config or parse error - default is off
  }
  return false;
}

/**
 * Save full-access mode preference to config
 */
export async function saveFullAccessPreference(enabled: boolean): Promise<void> {
  try {
    let config: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(CONFIG_PATHS.config, "utf-8");
      config = JSON.parse(content);
    } catch {
      // File doesn't exist yet
    }
    config.fullAccessMode = enabled;
    await fs.writeFile(CONFIG_PATHS.config, JSON.stringify(config, null, 2) + "\n");
  } catch {
    // Silently fail
  }
}

/**
 * Format warning message for dangerous command
 */
export function formatDangerousCommandWarning(command: string): string {
  return (
    chalk.red.bold("⚠️  DANGEROUS COMMAND DETECTED\n") +
    chalk.yellow(`Command: ${command}\n`) +
    chalk.dim("This command is blacklisted and will never be auto-approved.\n") +
    chalk.dim("Even in full-access mode, dangerous operations require manual confirmation.")
  );
}
