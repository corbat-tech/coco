/**
 * Git tools for Corbat-Coco
 * Version control operations
 */

import { z } from "zod";
import { simpleGit, type SimpleGit, type StatusResult, type LogResult } from "simple-git";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";

/**
 * Get git instance for a directory.
 *
 * Uses the `baseDir` option object so simple-git resolves the repo root
 * by walking up from the given directory — matching native `git` behavior.
 * The string-only overload `simpleGit(path)` can misbehave on macOS when
 * the binary is installed globally via npm.
 */
function getGit(cwd?: string): SimpleGit {
  const baseDir = cwd ?? process.cwd();
  return simpleGit({ baseDir });
}

/**
 * Git status tool
 */
export const gitStatusTool: ToolDefinition<
  { cwd?: string },
  {
    branch: string;
    tracking?: string;
    ahead: number;
    behind: number;
    staged: string[];
    modified: string[];
    untracked: string[];
    conflicted: string[];
    isClean: boolean;
  }
> = defineTool({
  name: "git_status",
  description: `Get the current git repository status including branch, staged, modified, and untracked files.

Examples:
- Current dir: {} → { "branch": "main", "isClean": false, "modified": ["src/app.ts"] }
- Specific repo: { "cwd": "/path/to/repo" }`,
  category: "git",
  parameters: z.object({
    cwd: z.string().optional().describe("Repository directory"),
  }),
  async execute({ cwd }) {
    try {
      const git = getGit(cwd);
      const status: StatusResult = await git.status();

      return {
        branch: status.current ?? "HEAD",
        tracking: status.tracking ?? undefined,
        ahead: status.ahead,
        behind: status.behind,
        staged: status.staged,
        modified: status.modified,
        untracked: status.not_added,
        conflicted: status.conflicted,
        isClean: status.isClean(),
      };
    } catch (error) {
      throw new ToolError(
        `Git status failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "git_status", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Git diff tool
 */
export const gitDiffTool: ToolDefinition<
  { cwd?: string; staged?: boolean; files?: string[] },
  { diff: string; filesChanged: number; insertions: number; deletions: number }
> = defineTool({
  name: "git_diff",
  description: `Get git diff showing file changes.

Examples:
- All changes: {} → { "diff": "...", "filesChanged": 3, "insertions": 42, "deletions": 10 }
- Staged only: { "staged": true }
- Specific files: { "files": ["src/app.ts", "package.json"] }`,
  category: "git",
  parameters: z.object({
    cwd: z.string().optional().describe("Repository directory"),
    staged: z.boolean().optional().default(false).describe("Show staged changes"),
    files: z.array(z.string()).optional().describe("Specific files to diff"),
  }),
  async execute({ cwd, staged, files }) {
    try {
      const git = getGit(cwd);
      const args = staged ? ["--staged"] : [];

      if (files && files.length > 0) {
        args.push("--", ...files);
      }

      const diff = await git.diff(args);

      // Parse diffstat
      const diffStat = await git.diffSummary(args);

      return {
        diff,
        filesChanged: diffStat.changed,
        insertions: diffStat.insertions,
        deletions: diffStat.deletions,
      };
    } catch (error) {
      throw new ToolError(
        `Git diff failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "git_diff", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Git add tool
 */
export const gitAddTool: ToolDefinition<{ cwd?: string; files: string[] }, { added: string[] }> =
  defineTool({
    name: "git_add",
    description: `Stage files for commit.

Examples:
- Stage all: { "files": ["."] }
- Specific files: { "files": ["src/app.ts", "package.json"] }
- Pattern: { "files": ["src/*.ts"] }`,
    category: "git",
    parameters: z.object({
      cwd: z.string().optional().describe("Repository directory"),
      files: z.array(z.string()).describe("Files to stage (use '.' for all)"),
    }),
    async execute({ cwd, files }) {
      try {
        const git = getGit(cwd);
        await git.add(files);

        return { added: files };
      } catch (error) {
        throw new ToolError(
          `Git add failed: ${error instanceof Error ? error.message : String(error)}`,
          { tool: "git_add", cause: error instanceof Error ? error : undefined },
        );
      }
    },
  });

/**
 * Git commit tool
 */
export const gitCommitTool: ToolDefinition<
  { cwd?: string; message: string; author?: string },
  { hash: string; summary: string }
> = defineTool({
  name: "git_commit",
  description: `Create a git commit with the staged changes.

Examples:
- Simple commit: { "message": "fix: resolve auth bug" }
- With author: { "message": "feat: add login", "author": "Bot <bot@example.com>" }`,
  category: "git",
  parameters: z.object({
    cwd: z.string().optional().describe("Repository directory"),
    message: z.string().describe("Commit message"),
    author: z.string().optional().describe("Author (format: 'Name <email>')"),
  }),
  async execute({ cwd, message, author }) {
    try {
      const git = getGit(cwd);
      const options: Record<string, string> = {};

      if (author) {
        options["--author"] = author;
      }

      const result = await git.commit(message, undefined, options);

      return {
        hash: result.commit,
        summary: result.summary.changes
          ? `${result.summary.insertions} insertions, ${result.summary.deletions} deletions`
          : "No changes",
      };
    } catch (error) {
      throw new ToolError(
        `Git commit failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "git_commit", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Git log tool
 */
export const gitLogTool: ToolDefinition<
  { cwd?: string; maxCount?: number; file?: string },
  {
    commits: Array<{
      hash: string;
      message: string;
      author: string;
      date: string;
    }>;
  }
> = defineTool({
  name: "git_log",
  description: `Get git commit history.

Examples:
- Last 10 commits: {} (default)
- Last 5: { "maxCount": 5 }
- File history: { "file": "src/app.ts", "maxCount": 20 }`,
  category: "git",
  parameters: z.object({
    cwd: z.string().optional().describe("Repository directory"),
    maxCount: z.number().optional().default(10).describe("Maximum commits to return"),
    file: z.string().optional().describe("Filter by file path"),
  }),
  async execute({ cwd, maxCount, file }) {
    try {
      const git = getGit(cwd);
      const options: Record<string, unknown> = {
        maxCount,
      };

      if (file) {
        options.file = file;
      }

      const log: LogResult = await git.log(options);

      return {
        commits: log.all.map((commit) => ({
          hash: commit.hash,
          message: commit.message,
          author: commit.author_name,
          date: commit.date,
        })),
      };
    } catch (error) {
      throw new ToolError(
        `Git log failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "git_log", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Git branch tool
 */
export const gitBranchTool: ToolDefinition<
  { cwd?: string; create?: string; delete?: string; list?: boolean },
  { branches: string[]; current: string }
> = defineTool({
  name: "git_branch",
  description: `Manage git branches (list, create, delete).

Examples:
- List branches: {} → { "branches": ["main", "feature/x"], "current": "main" }
- Create branch: { "create": "feature/new-feature" }
- Delete branch: { "delete": "old-branch" }`,
  category: "git",
  parameters: z.object({
    cwd: z.string().optional().describe("Repository directory"),
    create: z.string().optional().describe("Create a new branch"),
    delete: z.string().optional().describe("Delete a branch"),
    list: z.boolean().optional().default(true).describe("List branches"),
  }),
  async execute({ cwd, create, delete: deleteBranch, list }) {
    try {
      const git = getGit(cwd);

      if (create) {
        await git.checkoutLocalBranch(create);
      }

      if (deleteBranch) {
        await git.deleteLocalBranch(deleteBranch);
      }

      if (list || (!create && !deleteBranch)) {
        const branchSummary = await git.branchLocal();
        return {
          branches: branchSummary.all,
          current: branchSummary.current,
        };
      }

      const status = await git.status();
      return {
        branches: [],
        current: status.current ?? "HEAD",
      };
    } catch (error) {
      throw new ToolError(
        `Git branch failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "git_branch", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Git checkout tool
 */
export const gitCheckoutTool: ToolDefinition<
  { cwd?: string; branch: string; create?: boolean },
  { branch: string }
> = defineTool({
  name: "git_checkout",
  description: `Switch branches or create and switch to a new branch.

Examples:
- Switch branch: { "branch": "main" }
- Create and switch: { "branch": "feature/new", "create": true }`,
  category: "git",
  parameters: z.object({
    cwd: z.string().optional().describe("Repository directory"),
    branch: z.string().describe("Branch to checkout"),
    create: z.boolean().optional().default(false).describe("Create branch if it doesn't exist"),
  }),
  async execute({ cwd, branch, create }) {
    try {
      const git = getGit(cwd);

      if (create) {
        await git.checkoutLocalBranch(branch);
      } else {
        await git.checkout(branch);
      }

      return { branch };
    } catch (error) {
      throw new ToolError(
        `Git checkout failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "git_checkout", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Git push tool
 */
export const gitPushTool: ToolDefinition<
  { cwd?: string; remote?: string; branch?: string; setUpstream?: boolean },
  { pushed: boolean; remote: string; branch: string }
> = defineTool({
  name: "git_push",
  description: `Push commits to remote repository.

Examples:
- Push current: {} → pushes to origin
- Set upstream: { "setUpstream": true }
- Specific remote: { "remote": "upstream", "branch": "main" }`,
  category: "git",
  parameters: z.object({
    cwd: z.string().optional().describe("Repository directory"),
    remote: z.string().optional().default("origin").describe("Remote name"),
    branch: z.string().optional().describe("Branch to push"),
    setUpstream: z.boolean().optional().default(false).describe("Set upstream tracking"),
  }),
  async execute({ cwd, remote, branch, setUpstream }) {
    try {
      const git = getGit(cwd);
      const status = await git.status();
      const pushBranch = branch ?? status.current ?? "main";

      const options: string[] = [];
      if (setUpstream) {
        options.push("-u");
      }

      await git.push(remote, pushBranch, options);

      return {
        pushed: true,
        remote: remote ?? "origin",
        branch: pushBranch,
      };
    } catch (error) {
      throw new ToolError(
        `Git push failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "git_push", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Git pull tool
 */
export const gitPullTool: ToolDefinition<
  { cwd?: string; remote?: string; branch?: string; rebase?: boolean },
  { updated: boolean; summary: string }
> = defineTool({
  name: "git_pull",
  description: `Pull changes from remote repository.

Examples:
- Pull current: {} → pulls from origin
- With rebase: { "rebase": true }
- Specific branch: { "remote": "origin", "branch": "develop" }`,
  category: "git",
  parameters: z.object({
    cwd: z.string().optional().describe("Repository directory"),
    remote: z.string().optional().default("origin").describe("Remote name"),
    branch: z.string().optional().describe("Branch to pull"),
    rebase: z.boolean().optional().default(false).describe("Use rebase instead of merge"),
  }),
  async execute({ cwd, remote, branch, rebase }) {
    try {
      const git = getGit(cwd);
      const options: Record<string, null> = {};

      if (rebase) {
        options["--rebase"] = null;
      }

      const result = await git.pull(remote, branch, options);

      return {
        updated: (result.files?.length ?? 0) > 0,
        summary: result.summary
          ? `${result.summary.insertions} insertions, ${result.summary.deletions} deletions`
          : "Already up to date",
      };
    } catch (error) {
      throw new ToolError(
        `Git pull failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "git_pull", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Git init tool
 */
export const gitInitTool: ToolDefinition<
  { cwd?: string; bare?: boolean },
  { initialized: boolean; path: string }
> = defineTool({
  name: "git_init",
  description: `Initialize a new git repository.

Examples:
- Init current dir: {}
- Specific directory: { "cwd": "/path/to/project" }
- Bare repository: { "bare": true }`,
  category: "git",
  parameters: z.object({
    cwd: z.string().optional().describe("Directory to initialize"),
    bare: z.boolean().optional().default(false).describe("Create a bare repository"),
  }),
  async execute({ cwd, bare }) {
    try {
      const git = getGit(cwd);
      await git.init(bare ? ["--bare"] : []);

      return {
        initialized: true,
        path: cwd ?? process.cwd(),
      };
    } catch (error) {
      throw new ToolError(
        `Git init failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "git_init", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * All git tools
 */
export const gitTools = [
  gitStatusTool,
  gitDiffTool,
  gitAddTool,
  gitCommitTool,
  gitLogTool,
  gitBranchTool,
  gitCheckoutTool,
  gitPushTool,
  gitPullTool,
  gitInitTool,
];
