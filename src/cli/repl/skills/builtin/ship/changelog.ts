/**
 * Changelog Utilities
 *
 * Detects changelog files and inserts new version entries
 * following the keep-a-changelog or conventional format.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../../../../../utils/files.js";
import type { ChangelogFile } from "./types.js";

// ============================================================================
// Detection
// ============================================================================

const CHANGELOG_NAMES = [
  "CHANGELOG.md",
  "Changelog.md",
  "changelog.md",
  "CHANGES.md",
  "HISTORY.md",
];

/**
 * Detect a changelog file in the project directory.
 */
export async function detectChangelog(cwd: string): Promise<ChangelogFile | null> {
  for (const name of CHANGELOG_NAMES) {
    const fullPath = path.join(cwd, name);
    if (await fileExists(fullPath)) {
      const content = await readFile(fullPath, "utf-8");
      const format = detectFormat(content);
      return { path: name, format };
    }
  }
  return null;
}

function detectFormat(content: string): ChangelogFile["format"] {
  if (content.includes("All notable changes") || content.includes("keepachangelog")) {
    return "keep-a-changelog";
  }
  if (/^## \[\d+\.\d+\.\d+\]/m.test(content)) {
    return "keep-a-changelog";
  }
  if (/^## \d+\.\d+\.\d+/m.test(content)) {
    return "conventional";
  }
  return "custom";
}

// ============================================================================
// Insertion
// ============================================================================

/**
 * Insert a new version entry into an existing changelog file.
 *
 * Inserts right after the first `## ` heading (to put the new version
 * at the top, below the title/preamble).
 */
export async function insertChangelogEntry(
  cwd: string,
  changelog: ChangelogFile,
  version: string,
  entries: string[],
  date?: string,
): Promise<void> {
  const fullPath = path.join(cwd, changelog.path);
  const content = await readFile(fullPath, "utf-8");
  const dateStr = date ?? new Date().toISOString().slice(0, 10);

  const entry = buildEntry(changelog.format, version, entries, dateStr);

  // Find the first ## heading and insert after the line before it
  const lines = content.split("\n");
  let insertIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    // Skip the title (# Changelog)
    if (lines[i]!.startsWith("# ") && !lines[i]!.startsWith("## ")) {
      continue;
    }
    // Insert before the first ## section
    if (lines[i]!.startsWith("## ")) {
      insertIndex = i;
      break;
    }
  }

  if (insertIndex === -1) {
    // No existing version sections found, append after title
    insertIndex = lines.findIndex((l) => l.startsWith("# ")) + 1;
    if (insertIndex === 0) insertIndex = 0; // No title, insert at top
  }

  lines.splice(insertIndex, 0, entry);
  await writeFile(fullPath, lines.join("\n"), "utf-8");
}

function buildEntry(
  format: ChangelogFile["format"],
  version: string,
  entries: string[],
  date: string,
): string {
  const lines: string[] = [];

  if (format === "keep-a-changelog") {
    lines.push(`\n## [${version}] - ${date}\n`);
  } else {
    lines.push(`\n## ${version} (${date})\n`);
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      lines.push(`- ${entry}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate changelog bullet points from commit messages.
 */
export function generateChangelogEntries(commitMessages: string[]): string[] {
  return commitMessages
    .map((msg) => {
      // Strip conventional commit prefix for cleaner entries
      const cleaned = msg.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "").trim();
      // Capitalize first letter
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    })
    .filter((entry) => entry.length > 0);
}
