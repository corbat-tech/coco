/**
 * Ship Step: Merge & Release
 *
 * Asks the user if they want to merge the PR to main,
 * create a tag, and publish a GitHub release.
 * Handles squash merge with a descriptive message (no co-authored-by).
 */

import * as p from "@clack/prompts";
import { ghPrMergeTool, ghReleaseCreateTool } from "../../../../../../tools/github.js";
import { gitCheckoutTool, gitPullTool } from "../../../../../../tools/git.js";
import { bashExecTool } from "../../../../../../tools/bash.js";
import { sanitizeCommitMessage } from "../commit-message.js";
import { generateChangelogEntries } from "../changelog.js";
import type { ShipContext, ShipStepResult } from "../types.js";

export async function runMergeRelease(ctx: ShipContext): Promise<ShipStepResult> {
  const start = performance.now();

  if (!ctx.prNumber) {
    return {
      step: "merge-release",
      status: "skipped",
      message: "No PR to merge",
      durationMs: performance.now() - start,
    };
  }

  const tagName = ctx.newVersion ? `v${ctx.newVersion}` : undefined;

  // Ask user for confirmation
  const mergeMsg = tagName
    ? `Merge PR #${ctx.prNumber} to ${ctx.profile.defaultBranch} and create release ${tagName}?`
    : `Merge PR #${ctx.prNumber} to ${ctx.profile.defaultBranch}?`;

  const confirm = await p.confirm({
    message: mergeMsg,
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    return {
      step: "merge-release",
      status: "skipped",
      message: "Merge skipped — PR remains open",
      details: ctx.prUrl,
      durationMs: performance.now() - start,
    };
  }

  // 1. Squash merge
  const mergeSubject = sanitizeCommitMessage(
    ctx.commitMessage?.split("\n")[0] ?? `Merge PR #${ctx.prNumber}`,
  );

  try {
    await ghPrMergeTool.execute({
      number: ctx.prNumber,
      method: "squash",
      deleteBranch: true,
      subject: mergeSubject,
      cwd: ctx.cwd,
    });
    p.log.success(`PR #${ctx.prNumber} merged to ${ctx.profile.defaultBranch}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      step: "merge-release",
      status: "failed",
      message: `Merge failed: ${msg}`,
      durationMs: performance.now() - start,
    };
  }

  // 2. Switch to main and pull
  try {
    await gitCheckoutTool.execute({
      cwd: ctx.cwd,
      branch: ctx.profile.defaultBranch,
    });
    await gitPullTool.execute({ cwd: ctx.cwd });
  } catch {
    p.log.warn("Could not switch to main — continuing with release anyway");
  }

  // 3. Create tag and release (if version was bumped)
  if (tagName) {
    try {
      // Create and push tag
      await bashExecTool.execute({
        command: `git tag ${tagName}`,
        cwd: ctx.cwd,
      });
      await bashExecTool.execute({
        command: `git push origin ${tagName}`,
        cwd: ctx.cwd,
      });
      p.log.success(`Tag ${tagName} created and pushed`);

      // Generate release notes
      let releaseNotes = `Release ${tagName}`;
      try {
        const logResult = await bashExecTool.execute({
          command: `git log $(git describe --tags --abbrev=0 ${tagName}^ 2>/dev/null || echo "HEAD~10")..${tagName} --oneline`,
          cwd: ctx.cwd,
        });
        const commits = logResult.stdout.trim().split("\n").filter(Boolean);
        const entries = generateChangelogEntries(commits.map((c) => c.replace(/^[a-f0-9]+ /, "")));
        if (entries.length > 0) {
          releaseNotes = entries.map((e) => `- ${e}`).join("\n");
        }
      } catch {
        // Use simple release notes
      }

      releaseNotes = sanitizeCommitMessage(releaseNotes);

      // Create GitHub release
      const release = await ghReleaseCreateTool.execute({
        tag: tagName,
        title: tagName,
        notes: releaseNotes,
        cwd: ctx.cwd,
      });

      p.log.success(`Release created: ${release.url}`);

      return {
        step: "merge-release",
        status: "passed",
        message: `Merged, tagged ${tagName}, and released`,
        details: release.url,
        durationMs: performance.now() - start,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      p.log.warn(`Release creation failed: ${msg}`);
      return {
        step: "merge-release",
        status: "passed",
        message: `Merged PR #${ctx.prNumber} (release failed: ${msg})`,
        durationMs: performance.now() - start,
      };
    }
  }

  return {
    step: "merge-release",
    status: "passed",
    message: `Merged PR #${ctx.prNumber} to ${ctx.profile.defaultBranch}`,
    durationMs: performance.now() - start,
  };
}
