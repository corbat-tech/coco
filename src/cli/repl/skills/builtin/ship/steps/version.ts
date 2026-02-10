/**
 * Ship Step: Version & Changelog
 *
 * Determines the version bump type (patch/minor/major),
 * updates the version file, and updates the changelog.
 */

import * as p from "@clack/prompts";
import { gitLogTool } from "../../../../../../tools/git.js";
import { bashExecTool } from "../../../../../../tools/bash.js";
import {
  bumpVersion,
  writeVersion,
  detectBumpFromCommits,
} from "../version-detector.js";
import { insertChangelogEntry, generateChangelogEntries } from "../changelog.js";
import type { ShipContext, ShipStepResult, VersionBump } from "../types.js";

export async function runVersion(ctx: ShipContext): Promise<ShipStepResult> {
  const start = performance.now();

  // Skip if no version file or user opted out
  if (ctx.options.noVersion || !ctx.profile.versionFile) {
    return {
      step: "version",
      status: "skipped",
      message: ctx.options.noVersion
        ? "Version bump skipped (--no-version)"
        : "No version file detected",
      durationMs: performance.now() - start,
    };
  }

  const versionFile = ctx.profile.versionFile;
  const currentVersion = versionFile.currentVersion;

  // 1. Determine bump type
  let detectedBump: VersionBump = "patch";

  if (ctx.options.forceBump) {
    detectedBump = ctx.options.forceBump;
  } else {
    // Get commits since last tag
    let commitMessages: string[] = [];
    try {
      const lastTag = await bashExecTool.execute({
        command: "git describe --tags --abbrev=0 2>/dev/null || echo ''",
        cwd: ctx.cwd,
      });
      const tag = lastTag.stdout.trim();

      if (tag) {
        const log = await bashExecTool.execute({
          command: `git log ${tag}..HEAD --oneline`,
          cwd: ctx.cwd,
        });
        commitMessages = log.stdout.trim().split("\n").filter(Boolean);
      } else {
        // No tags, use recent commits
        const log = await gitLogTool.execute({ cwd: ctx.cwd, maxCount: 20 });
        commitMessages = log.commits.map((c) => c.message);
      }
    } catch {
      // Fallback to recent log
      const log = await gitLogTool.execute({ cwd: ctx.cwd, maxCount: 10 });
      commitMessages = log.commits.map((c) => c.message);
    }

    detectedBump = detectBumpFromCommits(commitMessages);
  }

  const newVersion = bumpVersion(currentVersion, detectedBump);

  // 2. Ask user to confirm
  const bumpChoice = await p.select({
    message: `Version bump: ${currentVersion} → ${newVersion} (${detectedBump}). Correct?`,
    options: [
      { value: detectedBump, label: `${detectedBump} → ${newVersion} (Recommended)` },
      ...(detectedBump !== "patch"
        ? [{ value: "patch" as const, label: `patch → ${bumpVersion(currentVersion, "patch")}` }]
        : []),
      ...(detectedBump !== "minor"
        ? [{ value: "minor" as const, label: `minor → ${bumpVersion(currentVersion, "minor")}` }]
        : []),
      ...(detectedBump !== "major"
        ? [{ value: "major" as const, label: `major → ${bumpVersion(currentVersion, "major")}` }]
        : []),
      { value: "skip" as const, label: "Skip version bump" },
    ],
  });

  if (p.isCancel(bumpChoice)) {
    return {
      step: "version",
      status: "cancelled",
      message: "Version bump cancelled",
      durationMs: performance.now() - start,
    };
  }

  if (bumpChoice === "skip") {
    return {
      step: "version",
      status: "skipped",
      message: "Version bump skipped by user",
      durationMs: performance.now() - start,
    };
  }

  const finalBump = bumpChoice as VersionBump;
  const finalVersion = bumpVersion(currentVersion, finalBump);
  ctx.newVersion = finalVersion;

  // 3. Write version
  await writeVersion(ctx.cwd, versionFile, finalVersion);
  p.log.success(`Updated ${versionFile.path}: ${currentVersion} → ${finalVersion}`);

  // 4. Update changelog if present
  if (ctx.profile.changelog && !ctx.options.noChangelog) {
    try {
      const log = await gitLogTool.execute({ cwd: ctx.cwd, maxCount: 30 });
      const entries = generateChangelogEntries(log.commits.map((c) => c.message));

      if (entries.length > 0) {
        await insertChangelogEntry(ctx.cwd, ctx.profile.changelog, finalVersion, entries);
        p.log.success(`Updated ${ctx.profile.changelog.path} with ${entries.length} entries`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      p.log.warn(`Could not update changelog: ${msg}`);
    }
  }

  return {
    step: "version",
    status: "passed",
    message: `Version bumped: ${currentVersion} → ${finalVersion} (${finalBump})`,
    durationMs: performance.now() - start,
  };
}
