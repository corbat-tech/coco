/**
 * Git context module for the REPL
 *
 * Provides branch, dirty state, and sync info with a 3s timeout.
 */

import { simpleGit } from "simple-git";
import chalk from "chalk";

export interface GitContext {
  branch: string;
  isDirty: boolean;
  staged: number;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
}

/**
 * Obtains git context with a 3s timeout.
 * Returns null if not a git repo or git is too slow.
 */
export async function getGitContext(projectPath: string): Promise<GitContext | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const git = simpleGit({ baseDir: projectPath, abort: controller.signal });
    const status = await git.status();
    clearTimeout(timer);
    return {
      branch: status.current ?? "HEAD",
      isDirty: !status.isClean(),
      staged: status.staged.length,
      modified: status.modified.length,
      untracked: status.not_added.length,
      ahead: status.ahead,
      behind: status.behind,
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Full line for welcome header: 🌿 feat/vscode-ext • +2 ~3 ?1 ↑1
 */
export function formatGitLine(ctx: GitContext): string {
  const branchColor = ctx.isDirty ? chalk.yellow : chalk.green;
  const parts = [chalk.dim("🌿 ") + branchColor(ctx.branch)];
  const changes: string[] = [];
  if (ctx.staged > 0) changes.push(chalk.green(`+${ctx.staged}`));
  if (ctx.modified > 0) changes.push(chalk.yellow(`~${ctx.modified}`));
  if (ctx.untracked > 0) changes.push(chalk.dim(`?${ctx.untracked}`));
  if (ctx.ahead > 0) changes.push(chalk.cyan(`↑${ctx.ahead}`));
  if (ctx.behind > 0) changes.push(chalk.red(`↓${ctx.behind}`));
  if (changes.length > 0) parts.push(changes.join(" "));
  return parts.join(" • ");
}

/**
 * Compact version for status bar: branch ● (if dirty)
 */
export function formatGitShort(ctx: GitContext): string {
  const branch = ctx.isDirty ? chalk.yellow(ctx.branch) : chalk.green(ctx.branch);
  const dirty = ctx.isDirty ? chalk.yellow(" ●") : "";
  return chalk.dim("🌿 ") + branch + dirty;
}
