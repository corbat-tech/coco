/**
 * Version Detector
 *
 * Multi-language version file detection, reading, writing, and bump logic.
 * Supports Node (package.json), Rust (Cargo.toml), Python (pyproject.toml), Go (tags only).
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../../../../../utils/files.js";
import type { VersionFile, VersionBump, ProjectStack } from "./types.js";

// ============================================================================
// Detection
// ============================================================================

const VERSION_FILES: Array<{
  file: string;
  stack: ProjectStack;
  field: string;
}> = [
  { file: "package.json", stack: "node", field: "version" },
  { file: "Cargo.toml", stack: "rust", field: "version" },
  { file: "pyproject.toml", stack: "python", field: "version" },
  { file: "pom.xml", stack: "java", field: "version" },
];

/**
 * Detect the version file in a project directory.
 */
export async function detectVersionFile(cwd: string): Promise<VersionFile | null> {
  for (const { file, stack, field } of VERSION_FILES) {
    const fullPath = path.join(cwd, file);
    if (await fileExists(fullPath)) {
      const version = await readVersionFromFile(fullPath, stack, field);
      if (version) {
        return { path: file, stack, currentVersion: version, field };
      }
    }
  }
  return null;
}

// ============================================================================
// Read version
// ============================================================================

async function readVersionFromFile(
  fullPath: string,
  stack: ProjectStack,
  field: string,
): Promise<string | null> {
  const content = await readFile(fullPath, "utf-8");

  switch (stack) {
    case "node": {
      const pkg = JSON.parse(content) as Record<string, unknown>;
      return typeof pkg[field] === "string" ? (pkg[field] as string) : null;
    }
    case "rust":
    case "python": {
      // TOML: look for version = "x.y.z" (simple regex, not full TOML parser)
      const match = content.match(new RegExp(`^${field}\\s*=\\s*"([^"]+)"`, "m"));
      return match?.[1] ?? null;
    }
    case "java": {
      // Maven pom.xml: <version>x.y.z</version> at project level
      const match = content.match(/<version>([^<]+)<\/version>/);
      return match?.[1] ?? null;
    }
    default:
      return null;
  }
}

// ============================================================================
// Bump version
// ============================================================================

/**
 * Bump a semver version string.
 */
export function bumpVersion(current: string, bump: VersionBump): string {
  // Strip leading 'v' if present
  const clean = current.replace(/^v/, "");
  const parts = clean.split(".");
  const major = parseInt(parts[0] ?? "0", 10);
  const minor = parseInt(parts[1] ?? "0", 10);
  const patch = parseInt(parts[2] ?? "0", 10);

  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

// ============================================================================
// Write version
// ============================================================================

/**
 * Update the version in the version file.
 */
export async function writeVersion(
  cwd: string,
  versionFile: VersionFile,
  newVersion: string,
): Promise<void> {
  const fullPath = path.join(cwd, versionFile.path);
  const content = await readFile(fullPath, "utf-8");

  let updated: string;

  switch (versionFile.stack) {
    case "node": {
      const pkg = JSON.parse(content) as Record<string, unknown>;
      pkg[versionFile.field] = newVersion;
      updated = JSON.stringify(pkg, null, 2) + "\n";
      break;
    }
    case "rust":
    case "python": {
      updated = content.replace(
        new RegExp(`^(${versionFile.field}\\s*=\\s*")([^"]+)(")`, "m"),
        `$1${newVersion}$3`,
      );
      break;
    }
    case "java": {
      // Replace first <version> occurrence
      let replaced = false;
      updated = content.replace(/<version>([^<]+)<\/version>/, () => {
        if (replaced) return `<version>${newVersion}</version>`;
        replaced = true;
        return `<version>${newVersion}</version>`;
      });
      break;
    }
    default:
      return;
  }

  await writeFile(fullPath, updated, "utf-8");
}

// ============================================================================
// Bump type detection from commit messages
// ============================================================================

/**
 * Analyze commit messages to determine the appropriate version bump.
 *
 * Rules:
 *   - "BREAKING CHANGE" or "!" after type → major
 *   - "feat:" or "feature:" → minor
 *   - Everything else → patch
 *   - Returns the highest bump level found.
 */
export function detectBumpFromCommits(commitMessages: string[]): VersionBump {
  let bump: VersionBump = "patch";

  for (const msg of commitMessages) {
    const lower = msg.toLowerCase();

    // Major: breaking changes
    if (lower.includes("breaking change") || /^[a-z]+(\([^)]*\))?!:/.test(msg)) {
      return "major"; // Immediately return — can't go higher
    }

    // Minor: new features
    if (/^feat(\([^)]*\))?:/.test(msg) || /^feature(\([^)]*\))?:/.test(msg)) {
      bump = "minor";
    }
  }

  return bump;
}
