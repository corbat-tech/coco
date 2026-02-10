/**
 * Ship Step: Branch
 *
 * Creates a feature branch if the user is currently on the default branch.
 * Uses smart branch name generation based on changes.
 * If already on a feature branch, uses that one.
 */

import * as p from "@clack/prompts";
import { gitCheckoutTool, gitBranchTool } from "../../../../../../tools/git.js";
import { recommendBranchTool } from "../../../../../../tools/git-enhanced.js";
import type { ShipContext, ShipStepResult } from "../types.js";

export async function runBranch(ctx: ShipContext): Promise<ShipStepResult> {
  const start = performance.now();
  const { currentBranch, defaultBranch } = ctx.profile;

  // Already on a feature branch — use it
  if (currentBranch !== defaultBranch && currentBranch !== "master") {
    ctx.branchName = currentBranch;
    return {
      step: "branch",
      status: "passed",
      message: `Using current branch \`${currentBranch}\``,
      durationMs: performance.now() - start,
    };
  }

  // On default branch — need to create a feature branch
  p.log.info("Currently on the default branch. Creating a feature branch...");

  // Generate a branch name suggestion
  let suggestion = "feat/ship-changes";
  try {
    const rec = await recommendBranchTool.execute({
      task: "ship current changes",
    });
    suggestion = rec.recommendedBranch;
  } catch {
    // Use fallback
  }

  const branchName = await p.text({
    message: "Branch name:",
    initialValue: suggestion,
    validate: (value: string | undefined) => {
      if (!value?.trim()) return "Branch name is required";
      if (!/^[a-zA-Z0-9._/-]+$/.test(value)) return "Invalid branch name characters";
      return undefined;
    },
  });

  if (p.isCancel(branchName)) {
    return {
      step: "branch",
      status: "cancelled",
      message: "Branch creation cancelled",
      durationMs: performance.now() - start,
    };
  }

  // Check if branch already exists
  const existing = await gitBranchTool.execute({ cwd: ctx.cwd });
  if (existing.branches.includes(branchName)) {
    // Switch to existing branch
    await gitCheckoutTool.execute({
      cwd: ctx.cwd,
      branch: branchName,
      create: false,
    });
  } else {
    // Create and switch
    await gitCheckoutTool.execute({
      cwd: ctx.cwd,
      branch: branchName,
      create: true,
    });
  }

  ctx.branchName = branchName;
  return {
    step: "branch",
    status: "passed",
    message: `Branch \`${branchName}\` ready`,
    durationMs: performance.now() - start,
  };
}
