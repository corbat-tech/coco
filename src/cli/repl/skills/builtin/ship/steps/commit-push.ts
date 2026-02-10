/**
 * Ship Step: Commit & Push
 *
 * Stages all changes, generates a commit message (with AI co-author
 * lines stripped), lets the user review/edit, commits, and pushes.
 */

import * as p from "@clack/prompts";
import {
  gitAddTool,
  gitCommitTool,
  gitPushTool,
  gitDiffTool,
  gitStatusTool,
} from "../../../../../../tools/git.js";
import { sanitizeCommitMessage, inferCommitType, formatCommitMessage } from "../commit-message.js";
import type { ShipContext, ShipStepResult } from "../types.js";

export async function runCommitPush(ctx: ShipContext): Promise<ShipStepResult> {
  const start = performance.now();

  // 1. Check if there's anything to commit
  const status = await gitStatusTool.execute({ cwd: ctx.cwd });
  const hasChanges =
    !status.isClean ||
    status.staged.length > 0 ||
    status.modified.length > 0 ||
    status.untracked.length > 0;

  if (!hasChanges) {
    return {
      step: "commit-push",
      status: "skipped",
      message: "Nothing to commit",
      durationMs: performance.now() - start,
    };
  }

  // 2. Stage all changes
  await gitAddTool.execute({ cwd: ctx.cwd, files: ["."] });

  // 3. Generate commit message
  let message: string;

  if (ctx.options.commitMessage) {
    message = sanitizeCommitMessage(ctx.options.commitMessage);
  } else {
    // Get changed files for type inference
    const diff = await gitDiffTool.execute({ cwd: ctx.cwd, staged: true });
    const changedFiles = diff.diff
      .split("\n")
      .filter((l) => l.startsWith("diff --git"))
      .map((l) => {
        const match = l.match(/b\/(.+)$/);
        return match?.[1] ?? "";
      })
      .filter(Boolean);

    const { type, scope } = inferCommitType(changedFiles);
    const versionSuffix = ctx.newVersion ? ` (v${ctx.newVersion})` : "";

    // Build a descriptive summary
    const description =
      changedFiles.length <= 3
        ? changedFiles.map((f) => f.split("/").pop()).join(", ")
        : `${changedFiles.length} files changed`;

    message = formatCommitMessage({
      type,
      scope,
      description: `${description}${versionSuffix}`,
      bullets:
        diff.filesChanged > 3
          ? [
              `${diff.insertions} insertions, ${diff.deletions} deletions across ${diff.filesChanged} files`,
            ]
          : undefined,
    });
  }

  // 4. Let user review/edit the message
  const edited = await p.text({
    message: "Commit message:",
    initialValue: message,
    validate: (value: string | undefined) => {
      if (!value?.trim()) return "Commit message is required";
      return undefined;
    },
  });

  if (p.isCancel(edited)) {
    return {
      step: "commit-push",
      status: "cancelled",
      message: "Commit cancelled",
      durationMs: performance.now() - start,
    };
  }

  // 5. Sanitize again (in case user re-added co-authored-by)
  const finalMessage = sanitizeCommitMessage(edited);
  ctx.commitMessage = finalMessage;

  // 6. Commit
  const commitResult = await gitCommitTool.execute({
    cwd: ctx.cwd,
    message: finalMessage,
  });

  // 7. Push
  try {
    await gitPushTool.execute({
      cwd: ctx.cwd,
      setUpstream: true,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // If push failed, try to diagnose
    if (msg.includes("rejected") || msg.includes("non-fast-forward")) {
      p.log.warn("Push rejected. Trying pull --rebase first...");
      try {
        const { bashExecTool } = await import("../../../../../../tools/bash.js");
        await bashExecTool.execute({
          command: "git pull --rebase origin " + (ctx.branchName ?? ""),
          cwd: ctx.cwd,
        });
        await gitPushTool.execute({ cwd: ctx.cwd, setUpstream: true });
      } catch (retryError) {
        const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
        return {
          step: "commit-push",
          status: "failed",
          message: `Push failed after rebase: ${retryMsg}`,
          durationMs: performance.now() - start,
        };
      }
    } else {
      return {
        step: "commit-push",
        status: "failed",
        message: `Push failed: ${msg}`,
        durationMs: performance.now() - start,
      };
    }
  }

  return {
    step: "commit-push",
    status: "passed",
    message: `Committed \`${commitResult.hash.slice(0, 7)}\` and pushed`,
    durationMs: performance.now() - start,
  };
}
