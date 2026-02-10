/**
 * GitHub CLI Tools for Corbat-Coco
 *
 * Wraps the `gh` CLI to provide structured access to
 * GitHub operations: PRs, releases, checks, repo info.
 */

import { z } from "zod";
import { execa } from "execa";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";

// ============================================================================
// Helpers
// ============================================================================

async function ghExec(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execa("gh", args, {
      cwd: cwd ?? process.cwd(),
      timeout: 60_000,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ToolError(`gh command failed: ${message}`, {
      tool: "github",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

// ============================================================================
// gh_check_auth
// ============================================================================

export const ghCheckAuthTool: ToolDefinition<
  { cwd?: string },
  { authenticated: boolean; user?: string; error?: string }
> = defineTool({
  name: "gh_check_auth",
  description: "Check if the GitHub CLI is installed and authenticated.",
  category: "git",
  parameters: z.object({
    cwd: z.string().optional(),
  }),
  async execute({ cwd }) {
    try {
      const { stdout } = await ghExec(["auth", "status"], cwd);
      const userMatch = stdout.match(/Logged in to .+ as (\S+)/);
      return {
        authenticated: true,
        user: userMatch?.[1],
      };
    } catch {
      return { authenticated: false, error: "gh CLI not authenticated. Run: gh auth login" };
    }
  },
});

// ============================================================================
// gh_repo_info
// ============================================================================

export const ghRepoInfoTool: ToolDefinition<
  { cwd?: string },
  {
    name: string;
    fullName: string;
    defaultBranch: string;
    url: string;
    private: boolean;
  }
> = defineTool({
  name: "gh_repo_info",
  description: "Get GitHub repository information (name, default branch, URL).",
  category: "git",
  parameters: z.object({
    cwd: z.string().optional(),
  }),
  async execute({ cwd }) {
    const { stdout } = await ghExec(
      ["repo", "view", "--json", "name,nameWithOwner,defaultBranchRef,url,isPrivate"],
      cwd,
    );
    const data = JSON.parse(stdout) as {
      name: string;
      nameWithOwner: string;
      defaultBranchRef: { name: string };
      url: string;
      isPrivate: boolean;
    };
    return {
      name: data.name,
      fullName: data.nameWithOwner,
      defaultBranch: data.defaultBranchRef.name,
      url: data.url,
      private: data.isPrivate,
    };
  },
});

// ============================================================================
// gh_pr_create
// ============================================================================

export const ghPrCreateTool: ToolDefinition<
  {
    title: string;
    body: string;
    base?: string;
    draft?: boolean;
    cwd?: string;
  },
  { number: number; url: string }
> = defineTool({
  name: "gh_pr_create",
  description: "Create a GitHub pull request.",
  category: "git",
  parameters: z.object({
    title: z.string().describe("PR title"),
    body: z.string().describe("PR body (markdown)"),
    base: z.string().optional().describe("Base branch (default: repo default)"),
    draft: z.boolean().optional().default(false),
    cwd: z.string().optional(),
  }),
  async execute({ title, body, base, draft, cwd }) {
    const args = ["pr", "create", "--title", title, "--body", body];
    if (base) args.push("--base", base);
    if (draft) args.push("--draft");

    const { stdout } = await ghExec(args, cwd);
    // gh pr create outputs the PR URL
    const url = stdout.trim();
    const numberMatch = url.match(/\/pull\/(\d+)/);
    return {
      number: numberMatch ? parseInt(numberMatch[1]!, 10) : 0,
      url,
    };
  },
});

// ============================================================================
// gh_pr_merge
// ============================================================================

export const ghPrMergeTool: ToolDefinition<
  {
    number: number;
    method?: "squash" | "merge" | "rebase";
    deleteBranch?: boolean;
    subject?: string;
    body?: string;
    cwd?: string;
  },
  { merged: boolean; method: string }
> = defineTool({
  name: "gh_pr_merge",
  description: "Merge a GitHub pull request.",
  category: "git",
  parameters: z.object({
    number: z.number().describe("PR number"),
    method: z.enum(["squash", "merge", "rebase"]).optional().default("squash"),
    deleteBranch: z.boolean().optional().default(true),
    subject: z.string().optional().describe("Merge commit subject line"),
    body: z.string().optional().describe("Merge commit body"),
    cwd: z.string().optional(),
  }),
  async execute({ number, method, deleteBranch, subject, body, cwd }) {
    const args = ["pr", "merge", String(number), `--${method}`];
    if (deleteBranch) args.push("--delete-branch");
    if (subject) args.push("--subject", subject);
    if (body) args.push("--body", body);

    await ghExec(args, cwd);
    return { merged: true, method: method! };
  },
});

// ============================================================================
// gh_pr_checks
// ============================================================================

export interface PRCheck {
  name: string;
  status: "pass" | "fail" | "pending" | "skipping";
  conclusion: string;
  url: string;
}

export const ghPrChecksTool: ToolDefinition<
  { number: number; cwd?: string },
  { checks: PRCheck[]; allPassed: boolean; anyFailed: boolean; anyPending: boolean }
> = defineTool({
  name: "gh_pr_checks",
  description: "Get CI check statuses for a pull request.",
  category: "git",
  parameters: z.object({
    number: z.number().describe("PR number"),
    cwd: z.string().optional(),
  }),
  async execute({ number, cwd }) {
    const { stdout } = await ghExec(
      ["pr", "checks", String(number), "--json", "name,state,conclusion,detailsUrl"],
      cwd,
    );
    const raw = JSON.parse(stdout) as Array<{
      name: string;
      state: string;
      conclusion: string;
      detailsUrl: string;
    }>;

    const checks: PRCheck[] = raw.map((c) => {
      let status: PRCheck["status"] = "pending";
      if (c.state === "SUCCESS" || c.conclusion === "SUCCESS") status = "pass";
      else if (c.state === "FAILURE" || c.conclusion === "FAILURE") status = "fail";
      else if (c.state === "SKIPPED" || c.conclusion === "SKIPPED") status = "skipping";

      return {
        name: c.name,
        status,
        conclusion: c.conclusion || c.state,
        url: c.detailsUrl,
      };
    });

    return {
      checks,
      allPassed:
        checks.length > 0 && checks.every((c) => c.status === "pass" || c.status === "skipping"),
      anyFailed: checks.some((c) => c.status === "fail"),
      anyPending: checks.some((c) => c.status === "pending"),
    };
  },
});

// ============================================================================
// gh_pr_list
// ============================================================================

export const ghPrListTool: ToolDefinition<
  { head?: string; state?: string; cwd?: string },
  { prs: Array<{ number: number; title: string; url: string; state: string }> }
> = defineTool({
  name: "gh_pr_list",
  description: "List pull requests, optionally filtered by head branch.",
  category: "git",
  parameters: z.object({
    head: z.string().optional().describe("Filter by head branch name"),
    state: z.string().optional().default("open"),
    cwd: z.string().optional(),
  }),
  async execute({ head, state, cwd }) {
    const args = ["pr", "list", "--json", "number,title,url,state", "--state", state!];
    if (head) args.push("--head", head);

    const { stdout } = await ghExec(args, cwd);
    const raw = JSON.parse(stdout) as Array<{
      number: number;
      title: string;
      url: string;
      state: string;
    }>;

    return { prs: raw };
  },
});

// ============================================================================
// gh_release_create
// ============================================================================

export const ghReleaseCreateTool: ToolDefinition<
  {
    tag: string;
    title?: string;
    notes?: string;
    draft?: boolean;
    prerelease?: boolean;
    cwd?: string;
  },
  { url: string; tag: string }
> = defineTool({
  name: "gh_release_create",
  description: "Create a GitHub release with notes.",
  category: "git",
  parameters: z.object({
    tag: z.string().describe("Tag name (e.g., v1.2.3)"),
    title: z.string().optional().describe("Release title"),
    notes: z.string().optional().describe("Release notes (markdown)"),
    draft: z.boolean().optional().default(false),
    prerelease: z.boolean().optional().default(false),
    cwd: z.string().optional(),
  }),
  async execute({ tag, title, notes, draft, prerelease, cwd }) {
    const args = ["release", "create", tag];
    if (title) args.push("--title", title);
    if (notes) args.push("--notes", notes);
    if (draft) args.push("--draft");
    if (prerelease) args.push("--prerelease");

    const { stdout } = await ghExec(args, cwd);
    return { url: stdout.trim(), tag };
  },
});

// ============================================================================
// Exports
// ============================================================================

export const githubTools = [
  ghCheckAuthTool,
  ghRepoInfoTool,
  ghPrCreateTool,
  ghPrMergeTool,
  ghPrChecksTool,
  ghPrListTool,
  ghReleaseCreateTool,
];
