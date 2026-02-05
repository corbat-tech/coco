/**
 * Version check module
 * Checks for new versions on npm and notifies the user
 */

import chalk from "chalk";
import { VERSION } from "../../version.js";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/corbat-coco";
const CACHE_KEY = "corbat-coco-version-check";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  const partsA = a.replace(/^v/, "").split(".").map(Number);
  const partsB = b.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

/**
 * Get cached version info from environment or temp storage
 */
function getCachedVersion(): VersionCache | null {
  try {
    // Use a simple in-memory approach via environment variable
    // This is reset each session but that's fine - we check at most once per day
    const cached = process.env[CACHE_KEY];
    if (cached) {
      return JSON.parse(cached) as VersionCache;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Set cached version info
 */
function setCachedVersion(cache: VersionCache): void {
  process.env[CACHE_KEY] = JSON.stringify(cache);
}

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const response = await fetch(NPM_REGISTRY_URL, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as NpmPackageInfo;
    return data["dist-tags"]?.latest ?? null;
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
  // Check cache first
  const cached = getCachedVersion();
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
    setCachedVersion({
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
 * Get the appropriate update command based on how coco was installed
 */
function getUpdateCommand(): string {
  // Check if installed globally via npm/pnpm
  const execPath = process.argv[1] || "";

  if (execPath.includes("pnpm")) {
    return "pnpm add -g corbat-coco@latest";
  }
  if (execPath.includes("yarn")) {
    return "yarn global add corbat-coco@latest";
  }
  if (execPath.includes("bun")) {
    return "bun add -g corbat-coco@latest";
  }

  // Default to npm
  return "npm install -g corbat-coco@latest";
}

/**
 * Print update notification if available
 * Non-blocking - runs check in background
 */
export function printUpdateNotification(updateInfo: {
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
}): void {
  console.log();
  console.log(
    chalk.yellow(`  ⬆️  Update available: ${chalk.dim(updateInfo.currentVersion)} → ${chalk.green(updateInfo.latestVersion)}`),
  );
  console.log(chalk.dim(`     Run: ${chalk.white(updateInfo.updateCommand)}`));
  console.log();
}

/**
 * Check for updates in background and print notification
 * This is fire-and-forget - doesn't block startup
 */
export function checkForUpdatesInBackground(callback?: () => void): void {
  checkForUpdates()
    .then((updateInfo) => {
      if (updateInfo) {
        printUpdateNotification(updateInfo);
      }
      callback?.();
    })
    .catch(() => {
      // Silently ignore errors
      callback?.();
    });
}
