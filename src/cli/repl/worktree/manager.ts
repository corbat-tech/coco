/**
 * Git Worktree Manager
 *
 * Manages the lifecycle of git worktrees for parallel agent isolation.
 * Each agent can work in its own worktree to avoid file conflicts.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type {
  Worktree,
  CreateWorktreeOptions,
  MergeWorktreeOptions,
  MergeResult,
} from "./types.js";
import { getLogger } from "../../../utils/logger.js";

const execFileAsync = promisify(execFile);

/**
 * Default directory for worktrees (relative to git root)
 */
const WORKTREES_DIR = ".worktrees";

/**
 * WorktreeManager — creates, tracks, and cleans up git worktrees
 */
export class WorktreeManager {
  private worktrees: Map<string, Worktree> = new Map();
  private projectRoot: string;
  private logger = getLogger();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Create a new git worktree for an agent
   *
   * @param name - Human-readable name for the worktree
   * @param options - Creation options
   * @returns The created worktree instance
   */
  async create(name: string, options: CreateWorktreeOptions = {}): Promise<Worktree> {
    const id = randomUUID();
    const branchPrefix = options.branchPrefix ?? "coco-agent";
    const branchName = `${branchPrefix}/${name}-${id.slice(0, 8)}`;
    const worktreePath = path.join(this.projectRoot, WORKTREES_DIR, `${name}-${id.slice(0, 8)}`);

    const worktree: Worktree = {
      id,
      name,
      path: worktreePath,
      branch: branchName,
      status: "creating",
      createdAt: new Date(),
    };

    this.worktrees.set(id, worktree);

    try {
      // Ensure worktrees directory exists
      await fs.mkdir(path.join(this.projectRoot, WORKTREES_DIR), { recursive: true });

      // Determine base branch
      const baseBranch = options.baseBranch ?? "HEAD";

      // Create worktree with a new branch
      await this.git(["worktree", "add", "-b", branchName, worktreePath, baseBranch]);

      worktree.status = "active";
      this.logger.info(`Created worktree: ${name} at ${worktreePath}`, { id, branch: branchName });
    } catch (error) {
      worktree.status = "error";
      worktree.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create worktree: ${name}`, { error: worktree.error });
      throw error;
    }

    return worktree;
  }

  /**
   * Remove a worktree and optionally delete its branch
   *
   * @param id - Worktree ID
   * @param force - Force removal even if there are uncommitted changes
   */
  async remove(id: string, force = false): Promise<void> {
    const worktree = this.worktrees.get(id);
    if (!worktree) {
      throw new Error(`Worktree not found: ${id}`);
    }

    if (worktree.status === "removed") {
      return; // Already removed
    }

    worktree.status = "removing";

    try {
      // Remove the worktree
      const args = ["worktree", "remove", worktree.path];
      if (force) args.push("--force");
      await this.git(args);

      // Delete the branch
      try {
        await this.git(["branch", "-D", worktree.branch]);
      } catch {
        // Branch may already be deleted or never existed
      }

      worktree.status = "removed";
      worktree.removedAt = new Date();
      this.logger.info(`Removed worktree: ${worktree.name}`, { id });
    } catch (error) {
      worktree.status = "error";
      worktree.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to remove worktree: ${worktree.name}`, { error: worktree.error });
      throw error;
    }
  }

  /**
   * List all worktrees (both from git and tracked by manager)
   */
  async list(): Promise<Worktree[]> {
    return Array.from(this.worktrees.values());
  }

  /**
   * List git worktrees from the git CLI
   */
  async listGit(): Promise<Array<{ path: string; branch: string; head: string }>> {
    try {
      const { stdout } = await this.git(["worktree", "list", "--porcelain"]);
      const entries: Array<{ path: string; branch: string; head: string }> = [];
      let current: { path: string; branch: string; head: string } = {
        path: "",
        branch: "",
        head: "",
      };

      for (const line of stdout.split("\n")) {
        if (line.startsWith("worktree ")) {
          if (current.path) entries.push(current);
          current = { path: line.slice(9), branch: "", head: "" };
        } else if (line.startsWith("HEAD ")) {
          current.head = line.slice(5);
        } else if (line.startsWith("branch ")) {
          current.branch = line.slice(7).replace("refs/heads/", "");
        }
      }
      if (current.path) entries.push(current);

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Merge a worktree's changes back to the target branch
   */
  async merge(id: string, options: MergeWorktreeOptions): Promise<MergeResult> {
    const worktree = this.worktrees.get(id);
    if (!worktree) {
      return { success: false, strategy: options.strategy, error: `Worktree not found: ${id}` };
    }

    if (worktree.status !== "active") {
      return {
        success: false,
        strategy: options.strategy,
        error: `Worktree is not active (status: ${worktree.status})`,
      };
    }

    worktree.status = "merging";

    try {
      let result: MergeResult;

      switch (options.strategy) {
        case "merge":
          result = await this.mergeViaMerge(worktree, options);
          break;
        case "rebase":
          result = await this.mergeViaRebase(worktree, options);
          break;
        case "pr":
          result = await this.mergeViaPR(worktree, options);
          break;
        default:
          result = {
            success: false,
            strategy: options.strategy,
            error: `Unknown merge strategy: ${options.strategy}`,
          };
      }

      if (result.success && options.cleanup !== false) {
        await this.remove(id);
      } else {
        worktree.status = result.success ? "active" : "error";
        if (!result.success) worktree.error = result.error;
      }

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      worktree.status = "error";
      worktree.error = errorMsg;
      return { success: false, strategy: options.strategy, error: errorMsg };
    }
  }

  /**
   * Get a worktree by ID
   */
  get(id: string): Worktree | undefined {
    return this.worktrees.get(id);
  }

  /**
   * Get the number of active worktrees
   */
  getActiveCount(): number {
    return Array.from(this.worktrees.values()).filter((w) => w.status === "active").length;
  }

  /**
   * Cleanup all worktrees (for shutdown)
   */
  async cleanupAll(): Promise<void> {
    const activeWorktrees = Array.from(this.worktrees.values()).filter(
      (w) => w.status === "active" || w.status === "error",
    );

    for (const worktree of activeWorktrees) {
      try {
        await this.remove(worktree.id, true);
      } catch {
        // Best effort cleanup
      }
    }
  }

  // ── Private merge strategies ─────────────────────────────────────

  private async mergeViaMerge(
    worktree: Worktree,
    options: MergeWorktreeOptions,
  ): Promise<MergeResult> {
    const message = options.message ?? `Merge ${worktree.branch} (agent: ${worktree.name})`;

    try {
      await this.git(["merge", worktree.branch, "--no-ff", "-m", message]);

      const filesChanged = await this.countChangedFiles(worktree.branch);
      return { success: true, strategy: "merge", filesChanged };
    } catch (error) {
      // Abort failed merge
      try {
        await this.git(["merge", "--abort"]);
      } catch {
        // May not be in a merge state
      }
      return {
        success: false,
        strategy: "merge",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async mergeViaRebase(
    worktree: Worktree,
    _options: MergeWorktreeOptions,
  ): Promise<MergeResult> {
    try {
      // Get current branch
      const { stdout: currentBranch } = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);

      // Rebase worktree branch onto current
      await this.gitIn(worktree.path, ["rebase", currentBranch.trim()]);

      // Fast-forward merge the rebased branch
      await this.git(["merge", "--ff-only", worktree.branch]);

      const filesChanged = await this.countChangedFiles(worktree.branch);
      return { success: true, strategy: "rebase", filesChanged };
    } catch (error) {
      return {
        success: false,
        strategy: "rebase",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async mergeViaPR(
    worktree: Worktree,
    options: MergeWorktreeOptions,
  ): Promise<MergeResult> {
    try {
      // Push the branch
      await this.git(["push", "-u", "origin", worktree.branch]);

      // Create PR using gh CLI
      const title = options.message ?? `Agent: ${worktree.name}`;
      const { stdout } = await execFileAsync(
        "gh",
        [
          "pr",
          "create",
          "--title",
          title,
          "--body",
          `Automated PR from Coco agent worktree: ${worktree.name}`,
          "--head",
          worktree.branch,
        ],
        { cwd: this.projectRoot },
      );

      const prUrl = stdout.trim();
      return { success: true, strategy: "pr", prUrl };
    } catch (error) {
      return {
        success: false,
        strategy: "pr",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private async git(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", args, { cwd: this.projectRoot });
  }

  private async gitIn(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", args, { cwd });
  }

  private async countChangedFiles(branch: string): Promise<number> {
    try {
      const { stdout } = await this.git(["diff", "--name-only", `${branch}~1..${branch}`]);
      return stdout.trim().split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  }
}

/**
 * Create a WorktreeManager instance
 */
export function createWorktreeManager(projectRoot: string): WorktreeManager {
  return new WorktreeManager(projectRoot);
}
