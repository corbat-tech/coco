/**
 * Version check module
 * Checks for new versions on npm and notifies the user
 */

import os from "node:os";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import chalk from "chalk";
import { VERSION } from "../../version.js";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/@corbat-tech/coco";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;
const CACHE_DIR = path.join(os.homedir(), ".coco");
const CACHE_FILE = path.join(CACHE_DIR, "version-check-cache.json");

interface VersionCache {
  latestVersion: string;
  checkedAt: number;
}

interface NpmPackageInfo {
  "dist-tags"?: {
    latest?: string;
  };
}

/**
 * Compare semver versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  // Strip pre-release suffix (e.g. "-rc.1", "-alpha") before parsing so that
  // Number("0-rc.1") → NaN is avoided. Pre-release is intentionally ignored.
  const partsA = a
    .replace(/^v/, "")
    .split(".")
    .map((p) => Number(p.replace(/-.*$/, "")));
  const partsB = b
    .replace(/^v/, "")
    .split(".")
    .map((p) => Number(p.replace(/-.*$/, "")));

  for (let i = 0; i < 3; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

/**
 * Get cached version info from the file-based cache at ~/.coco/version-check-cache.json
 */
async function getCachedVersion(): Promise<VersionCache | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const result = JSON.parse(raw) as unknown;
    // Validate shape before trusting the cached data
    if (
      typeof result !== "object" ||
      result === null ||
      typeof (result as Record<string, unknown>)["latestVersion"] !== "string" ||
      typeof (result as Record<string, unknown>)["checkedAt"] !== "number"
    ) {
      return null;
    }
    return result as VersionCache;
  } catch {
    // This module is advisory — any cache read failure (ENOENT, EACCES, SyntaxError, etc.)
    // is silently treated as a cache miss so startup is never blocked.
    return null;
  }
}

/**
 * Persist version cache to ~/.coco/version-check-cache.json
 */
async function setCachedVersion(cache: VersionCache): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache), "utf-8");
  } catch {
    // Silently ignore write errors (read-only fs, permissions, etc.)
  }
}

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(NPM_REGISTRY_URL, {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as NpmPackageInfo;
      return data["dist-tags"]?.latest ?? null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Network error, timeout, etc. - silently fail
    return null;
  }
}

/**
 * Check for updates and return update info if available
 * Returns null if no update available or check failed
 */
export async function checkForUpdates(): Promise<{
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
} | null> {
  // Set COCO_NO_UPDATE_CHECK=1 (or any truthy value) to skip the update check entirely
  if (process.env["COCO_NO_UPDATE_CHECK"]) return null;

  // Check cache first
  const cached = await getCachedVersion();
  const now = Date.now();

  if (cached && now - cached.checkedAt < CHECK_INTERVAL_MS) {
    // Use cached version
    if (compareVersions(cached.latestVersion, VERSION) > 0) {
      return {
        currentVersion: VERSION,
        latestVersion: cached.latestVersion,
        updateCommand: getUpdateCommand(),
      };
    }
    return null;
  }

  // Fetch latest version
  const latestVersion = await fetchLatestVersion();

  if (latestVersion) {
    // Cache the result
    await setCachedVersion({
      latestVersion,
      checkedAt: now,
    });

    if (compareVersions(latestVersion, VERSION) > 0) {
      return {
        currentVersion: VERSION,
        latestVersion,
        updateCommand: getUpdateCommand(),
      };
    }
  }

  return null;
}

/**
 * Get the appropriate update command based on how coco was installed.
 * Detection priority:
 *   1. npm_config_user_agent env var (set by all major package managers when invoking scripts)
 *   2. Substring match on process.argv[1] (fallback for global installs / direct invocations)
 */
function getUpdateCommand(): string {
  // Priority 1: use the user-agent env var injected by the package manager.
  // This is more reliable than argv matching because it is set explicitly by the PM itself
  // and does not produce false positives from paths that coincidentally contain PM names
  // (e.g. a path like "/home/user/yarn-pnpm-bridge/coco" would confuse pure argv checks).
  const userAgent = process.env["npm_config_user_agent"] ?? "";
  if (userAgent.includes("pnpm")) {
    return "pnpm add -g @corbat-tech/coco@latest";
  }
  if (userAgent.includes("yarn")) {
    // yarn global is not supported in Yarn v2+ (Berry); npm is the reliable fallback
    return "npm install -g @corbat-tech/coco@latest";
  }
  if (userAgent.includes("bun")) {
    return "bun add -g @corbat-tech/coco@latest";
  }

  // Priority 2: fall back to argv[1] substring check for direct / global invocations
  // where npm_config_user_agent may not be set.
  const execPath = process.argv[1] || "";
  if (execPath.includes("pnpm")) {
    return "pnpm add -g @corbat-tech/coco@latest";
  }
  if (execPath.includes("yarn")) {
    // yarn global is not supported in Yarn v2+ (Berry); npm is the reliable fallback
    return "npm install -g @corbat-tech/coco@latest";
  }
  if (execPath.includes("bun")) {
    return "bun add -g @corbat-tech/coco@latest";
  }

  // Default to npm
  return "npm install -g @corbat-tech/coco@latest";
}

/**
 * Print the update available banner to the console.
 * Shared by interactive and background notifications.
 */
export function printUpdateBanner(updateInfo: {
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
}): void {
  console.log();
  console.log(
    chalk.yellow(
      `  \u2B06 Update available: ${chalk.dim(updateInfo.currentVersion)} \u2192 ${chalk.green.bold(updateInfo.latestVersion)}`,
    ),
  );
  console.log(chalk.dim(`  Run: ${chalk.white(updateInfo.updateCommand)}`));
  console.log();
}

/**
 * Check for updates interactively before starting the REPL.
 * If an update is found, prompts the user to exit and run the update command.
 * Returns true to continue starting coco, or exits the process if the user chooses to update.
 */
export async function checkForUpdatesInteractive(): Promise<void> {
  const updateInfo = await checkForUpdates();
  if (!updateInfo) return;

  const p = await import("@clack/prompts");

  printUpdateBanner(updateInfo);

  const answer = await p.confirm({
    message: "Exit now to update?",
    initialValue: false,
  });

  if (!p.isCancel(answer) && answer) {
    console.log();
    console.log(chalk.dim(`  Running: ${updateInfo.updateCommand}`));
    console.log();

    try {
      const { execa } = await import("execa");
      const [cmd, ...args] = updateInfo.updateCommand.split(" ");
      if (!cmd) return;
      await execa(cmd, args, { stdio: "inherit", timeout: 120_000 });
      console.log();
      console.log(chalk.green("  \u2713 Updated! Run coco again to start the new version."));
      console.log();
      process.exit(0);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("EACCES") || msg.includes("permission")) {
        console.log(chalk.red("  \u2717 Permission denied. Try with sudo:"));
        console.log(chalk.white(`  sudo ${updateInfo.updateCommand}`));
      } else {
        console.log(chalk.red(`  \u2717 Update failed: ${msg}`));
      }
      return;
    }
  }
}

/**
 * Check for updates in background and print notification
 * This is fire-and-forget - doesn't block startup
 */
export function checkForUpdatesInBackground(callback?: () => void): void {
  checkForUpdates()
    .then((updateInfo) => {
      if (updateInfo) {
        printUpdateBanner(updateInfo);
      }
      callback?.();
    })
    .catch(() => {
      // Silently ignore errors
      callback?.();
    });
}
